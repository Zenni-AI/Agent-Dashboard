import Anthropic from "@anthropic-ai/sdk";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readTheLog } from "./brief.js";
import { describeFailure, developThought } from "./claude.js";
import { loadConfig, MissingKeyError, type Config } from "./config.js";
import { JobStore, newJobId } from "./jobs.js";
import { publicModes, resolveMode } from "./modes.js";
import { RateLimiter } from "./ratelimit.js";
import { closeStream, openStream, sendEvent } from "./sse.js";
import { CHAPTERS, writeTextbook } from "./textbook.js";
import {
  validateBrief,
  validateChainsRequest,
  validateDevelopRequest,
  ValidationError,
} from "./validate.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** Works from both `src/` under tsx and `dist/` after a build. */
const PUBLIC_DIR = resolve(HERE, "..", "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function start(config: Config): void {
  const client = new Anthropic({ apiKey: config.apiKey });
  const limiter = new RateLimiter(config.rateLimit, config.rateWindowMs);
  const jobs = new JobStore();

  const server = createServer((req, res) => {
    handle(req, res, config, client, limiter, jobs).catch((error) => {
      console.error("unhandled request failure:", error);
      if (!res.headersSent) sendJson(res, 500, { error: "Something broke." });
      closeStream(res);
    });
  });

  // A development can outlive the default 2-minute socket timeout on the
  // slower modes, and a dropped socket mid-answer is worse than a slow one.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;

  server.listen(config.port, config.host, () => {
    console.log(`HIGH THOUGHTS on http://${config.host}:${config.port}  (${config.model})`);
    console.log("On your phone: open the same port on this machine's LAN address.");
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  client: Anthropic,
  limiter: RateLimiter,
  jobs: JobStore,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, model: config.model });
  }

  if (url.pathname === "/api/modes") {
    return sendJson(res, 200, { modes: publicModes(), chapters: CHAPTERS });
  }

  // Read the log and report where the idea stands. Cheap, and it runs before
  // the person has committed to anything — its whole job is to be checked.
  if (url.pathname === "/api/brief") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only." });
    return brief(req, res, config, client, limiter);
  }

  // Start writing a textbook. Returns a job id; the work continues whether or
  // not anyone is still listening.
  if (url.pathname === "/api/textbook") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only." });
    return startTextbook(req, res, config, client, limiter, jobs);
  }

  // Attach to a running or finished textbook. Replays from the start, so a
  // phone that locked mid-generation loses nothing by coming back.
  if (url.pathname.startsWith("/api/textbook/")) {
    const id = url.pathname.slice("/api/textbook/".length);
    return streamJob(res, jobs, id);
  }

  if (url.pathname === "/api/develop") {
    if (req.method !== "POST") return sendJson(res, 405, { error: "POST only." });
    return develop(req, res, config, client, limiter);
  }

  if (url.pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "No such endpoint." });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "GET only." });
  }

  return serveStatic(url.pathname, res);
}

async function develop(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  client: Anthropic,
  limiter: RateLimiter,
): Promise<void> {
  const limit = limiter.check(clientKey(req));
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return sendJson(res, 429, {
      error: `Slow down — ${limit.retryAfter}s.`,
      retryAfter: limit.retryAfter,
    });
  }

  let payload: unknown;
  try {
    payload = await readJson(req, config.maxThoughtChars * 8);
  } catch (error) {
    return sendJson(res, 400, { error: (error as Error).message });
  }

  let request;
  try {
    request = validateDevelopRequest(payload, {
      maxThoughtChars: config.maxThoughtChars,
      maxHistoryTurns: config.maxHistoryTurns,
    });
  } catch (error) {
    if (error instanceof ValidationError) return sendJson(res, 400, { error: error.message });
    throw error;
  }

  // Stop billing for an answer nobody is waiting for any more.
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  openStream(res);

  const events = developThought({
    client,
    model: config.model,
    thought: request.thought,
    mode: resolveMode(request.mode),
    history: request.history,
    signal: abort.signal,
  });

  for await (const event of events) {
    if (res.writableEnded) break;
    sendEvent(res, event);
  }

  closeStream(res);
}

async function brief(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  client: Anthropic,
  limiter: RateLimiter,
): Promise<void> {
  const limit = limiter.check(clientKey(req));
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return sendJson(res, 429, { error: `Slow down — ${limit.retryAfter}s.` });
  }

  let chains;
  try {
    const payload = await readJson(req, config.maxThoughtChars * 8 * config.maxChains);
    chains = validateChainsRequest(payload, {
      maxThoughtChars: config.maxThoughtChars,
      maxHistoryTurns: config.maxHistoryTurns,
      maxChains: config.maxChains,
    });
  } catch (error) {
    if (error instanceof ValidationError) return sendJson(res, 400, { error: error.message });
    return sendJson(res, 400, { error: (error as Error).message });
  }

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  try {
    const result = await readTheLog({
      client,
      model: config.model,
      chains,
      signal: abort.signal,
    });
    if (res.writableEnded) return;
    return sendJson(res, 200, { brief: result });
  } catch (error) {
    if (res.writableEnded) return;
    const { message } = describeFailure(error);
    return sendJson(res, 502, { error: message });
  }
}

async function startTextbook(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  client: Anthropic,
  limiter: RateLimiter,
  jobs: JobStore,
): Promise<void> {
  const limit = limiter.check(clientKey(req));
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfter));
    return sendJson(res, 429, { error: `Slow down — ${limit.retryAfter}s.` });
  }

  let confirmed;
  try {
    const payload = await readJson(req, 64_000);
    confirmed = validateBrief(payload);
  } catch (error) {
    if (error instanceof ValidationError) return sendJson(res, 400, { error: error.message });
    return sendJson(res, 400, { error: (error as Error).message });
  }

  // Deliberately not tied to this request's lifetime: the person is expected
  // to put the phone down while it writes.
  const id = newJobId();
  jobs.start(id, () => writeTextbook({ client, model: config.model, brief: confirmed }));

  return sendJson(res, 202, { id });
}

async function streamJob(res: ServerResponse, jobs: JobStore, id: string): Promise<void> {
  if (!jobs.get(id)) {
    return sendJson(res, 404, { error: "That book has expired. Make it again." });
  }

  const abort = new AbortController();
  res.on("close", () => abort.abort());

  openStream(res);
  for await (const event of jobs.subscribe(id, abort.signal)) {
    if (res.writableEnded) break;
    sendEvent(res, event);
  }
  closeStream(res);
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const requested = pathname === "/" ? "/index.html" : pathname;

  // Resolve, then confirm the result is still inside PUBLIC_DIR — normalize
  // alone does not stop `/..%2f` style escapes once decoded.
  const decoded = safeDecode(requested);
  if (decoded === null) return sendText(res, 400, "Bad path.");

  const target = resolve(join(PUBLIC_DIR, normalize(decoded)));
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    return sendText(res, 403, "Nope.");
  }

  let size: number;
  try {
    const info = await stat(target);
    if (!info.isFile()) return sendText(res, 404, "Not found.");
    size = info.size;
  } catch {
    return sendText(res, 404, "Not found.");
  }

  const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
  // The shell is versioned by the service worker, so it must not be cached by
  // the browser as well — a stale index.html strands the app on an old build.
  const cacheable = type.startsWith("image/") || extname(target) === ".webmanifest";

  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": size,
    "Cache-Control": cacheable ? "public, max-age=86400" : "no-cache",
  });
  createReadStream(target).pipe(res);
}

function safeDecode(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes("\0") ? null : decoded;
  } catch {
    return null;
  }
}

async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBytes) throw new Error("That is too much text.");
    chunks.push(buffer);
  }

  if (total === 0) throw new Error("Empty request.");

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Malformed JSON.");
  }
}

/**
 * Rate-limit key. Behind a proxy the socket address is the proxy, so the first
 * hop in X-Forwarded-For is used when present. It is spoofable by a direct
 * client — acceptable, because this limiter exists to stop accidental
 * hammering, not a determined attacker.
 */
function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return first?.trim() || req.socket.remoteAddress || "unknown";
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

try {
  start(loadConfig());
} catch (error) {
  if (error instanceof MissingKeyError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
