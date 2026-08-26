# HIGH THOUGHTS

**An idea arrives and will not leave you alone. You pull your phone out, dump it in one box, and press one button. It comes back as something you could actually do something about — and it is still there in the morning.**

That is the entire app. No account, no folders, no tagging, no onboarding. One box, four buttons, and a log that lives on your phone.

The name is about *the kind of thought*, not the state you are in — the expansive, slightly unreasonable one that shows up at 2am, on a walk, in the shower, halfway through something else. The ones that are usually gone by the time you have found something to write on.

---

## Why it is built this way

The obvious version of this app is a chat window pointed at a model, and the obvious version does not work. Three decisions carry the product:

**The mode is the whole interface.** A half-formed idea does not want the same thing every time. Sometimes it wants fuel, sometimes a plan, sometimes an honest friend, sometimes to be followed all the way down. So the only control in the app is which of those four you want, and the model gets a genuinely different brief — and a different reasoning budget — for each. Riff runs at low effort because the value is in the associative leap, which does not improve with deliberation. Sober runs at high effort because it is being asked to make a judgement.

**The answer has a fixed shape.** Every mode names its four sections up front, and the model is told to emit those and stop. A phone screen at night is not a place for an essay. You get a title, four short sections, 200–350 words, and the parts that carry weight in bold so it survives being skimmed.

**Nothing is stored on the server.** Your thoughts live in your browser's own storage and nowhere else. The server sees a thought for exactly as long as it takes to answer it, and never writes it down. That is the correct arrangement for people's half-formed ideas.

The rest of the prompt is scar tissue. It bans opening flattery, because "What a fascinating idea!" tells you nothing you did not already know. It bans clarifying questions, because you are standing outside somewhere and you are not going to answer one. It bans vagueness, on the theory that being specific enough to be wrong is the only way to be useful.

---

## The four modes

| Mode | What it does | Sections you get back |
| --- | --- | --- |
| **Riff** | Runs with it. Three escalations and one that goes too far. | The idea · Take it further · The weird one · Keep this bit |
| **Build** | Makes it real. Named parts, and a first move you can do from a phone tonight. | What it is · How it works · The first move · What kills it |
| **Sober** | The honest read. Ends on **Worth it** / **Worth a night** / **Let it go** — it has to pick one. | What you said · Does this exist · The honest read · Verdict |
| **Deep** | Follows the thought past where you stopped and takes a side. | The thought under the thought · Follow it down · Where it lands · The uncomfortable part |

Any thought can be re-run in any mode, and later runs see the earlier ones. The intended move is to catch something in **Riff** at night and open it in **Sober** the next morning — the model is told explicitly that it is the morning after, and to say so if the excitement was doing all the work.

---

## Run it

```bash
cd high-thoughts
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY
npm run dev               # http://localhost:8080
```

Node 20 or newer. `npm run build && npm start` for the compiled server.

### On your actual phone

The server binds `0.0.0.0`, so from a phone on the same network open `http://<your-machine's-LAN-ip>:8080`. Then use **Add to Home Screen** — there is a manifest and a service worker, so it installs as a standalone app with its own icon, opens without browser chrome, and starts instantly.

Dictation is wired to the browser's speech recognition where it exists (the mic button hides itself where it does not). On iOS the keyboard's own dictation works regardless, which is usually what you want anyway.

If you deploy it somewhere public, put it behind HTTPS — the microphone and the service worker both require a secure context away from localhost.

---

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required. Stays on the server; the phone never sees it. |
| `HIGH_THOUGHTS_MODEL` | `claude-opus-5` | The model behind every mode. |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Where the server listens. |
| `HIGH_THOUGHTS_RATE_LIMIT` | `30` | Requests per IP per window. |
| `HIGH_THOUGHTS_RATE_WINDOW_MS` | `60000` | The window. |
| `HIGH_THOUGHTS_MAX_CHARS` | `4000` | Longest thought accepted. |
| `HIGH_THOUGHTS_MAX_HISTORY` | `6` | Earlier turns replayed as context on a follow-up. |

The rate limiter is in-memory and per-process. It is there to stop one person holding the button down, not to replace a real gateway on a public deploy.

---

## How it is put together

```
src/
  server.ts     Node http — static files, /api/develop, /api/modes, /api/health
  claude.ts     The streaming call, and every failure translated into a sentence
  prompts.ts    The shared brief, plus how a follow-up is framed
  modes.ts      The four modes: sections, effort, instructions
  validate.ts   Everything the phone sends, treated as untrusted
  ratelimit.ts  Fixed-window per-IP counter
  sse.ts        Server-sent event framing
public/
  app.js        Screens, streaming, dictation
  markdown.js   A tiny escape-first renderer
  store.js      localStorage — the only place thoughts exist
  sw.js         Offline shell
```

No frontend build step. The client is plain ES modules served as written, which means the file you read is the file that runs.

**Streaming.** `/api/develop` returns server-sent events. Text arrives as it is generated; the model's own summarised reasoning arrives alongside it as a ghost line, so the several seconds before the first word look like work rather than a hang. Closing the page aborts the request, so nothing is billed for an answer nobody is reading.

**Rendering.** The markdown renderer escapes before it emits a single tag, so a model response cannot inject markup into the page. It re-renders the whole answer each frame rather than appending, because markdown is not resumable — a `**` in one chunk has to be able to change what a previous chunk already painted.

**Failures.** Every SDK error is translated into something a person can act on, and marked retryable or not so the app knows whether to offer the button again. Raw error text never reaches the phone. If a safety classifier declines a request, the server-side fallback re-runs it on another model inside the same call rather than handing you a dead end.

---

## Tests

```bash
npm test        # 54 tests
npm run typecheck
```

Covering: request validation against hostile and stale input, the rate limiter's window arithmetic, prompt assembly and the follow-up framing, mode invariants, the markdown renderer (including escaping and half-streamed input), and error translation — including that an API key can never appear in a message sent to the phone.

---

## Known limits

- **Local storage means local.** Clear your browser data and the log is gone. There is no sync and no export yet; export is the obvious next thing.
- **The rate limiter is per-process.** Two instances behind a load balancer each get their own budget.
- **Speech recognition varies.** It is a browser feature, not ours; on some browsers it routes audio to the vendor, and on some it is simply absent.
- **`Does this exist` is unverified.** Sober mode answers from what the model knows and is told to say when it does not know, but it has no web access. Treat a named competitor as a lead, not a fact.
