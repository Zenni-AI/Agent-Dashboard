import type { ServerResponse } from "node:http";
import type { StreamEvent } from "./types.js";

/**
 * Server-sent events, one JSON object per frame.
 *
 * `X-Accel-Buffering: no` matters more than it looks: behind nginx or most
 * PaaS proxies the default is to buffer the response, which turns a stream
 * into a long pause followed by the whole answer at once — exactly the thing
 * this app exists to avoid.
 */
export function openStream(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  // Flush headers so the phone sees the connection open immediately.
  res.write(":ok\n\n");
}

export function sendEvent(res: ServerResponse, event: StreamEvent): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function closeStream(res: ServerResponse): void {
  if (!res.writableEnded) res.end();
}

/** Frame a single event for a raw SSE body. Exposed for tests. */
export function formatEvent(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
