# Security risks

Audited 2026-10-26 against `05fad15`.

## The headline

**A renderer now exists and has been attacked.** `public/preview.js` is the
only path by which generated HTML reaches a screen. Twelve attack payloads and
a network-egress test were run against it in a real browser, against the real
app, with real secrets in `localStorage`.

Re-run them any time: `npm run security`.

---

## R1 — Rendering generated HTML — MITIGATED AND TESTED

### Verified results (2026-10-26, Chromium, against the live app)

| Attack | Result |
| --- | --- |
| `parent.localStorage.getItem('high-thoughts/v1')` | `SecurityError` |
| `parent.document.cookie` | `SecurityError` |
| `parent.location.href` | `SecurityError` |
| `typeof parent.fetch` | `SecurityError` |
| Remove own `sandbox` attribute from parent DOM | `SecurityError` |
| Own `localStorage` | `SecurityError` (opaque origin) |
| `top.location = …` | `SecurityError` |
| `window.open(…)` | returns `null` |
| `fetch()` to another origin | CSP-refused, **0 bytes sent** |
| `XMLHttpRequest` POST | CSP-refused, request failed `:: csp` |
| `new Image().src` | CSP-refused, request failed `:: csp` |
| `navigator.sendBeacon` | CSP-refused |
| `new WebSocket('wss://…')` | CSP-refused |
| `new EventSource(…)` | CSP-refused, request failed `:: csp` |
| `serviceWorker.register` | blocked |

**Egress measured by network observation, not by API return values.** This
matters: `sendBeacon` returned `true` and the `WebSocket` constructor did not
throw, which looks like success. Watching the network showed **zero requests
completed** — every one failed with `errorText: csp`. Had this been judged on
return values alone, two exfiltration paths would have been wrongly recorded as
open, and one as closed when it was not yet proven.

The parent's `localStorage` was re-read after every attack and was intact; the
`sandbox` attribute was still exactly `allow-scripts`.

### What provides each guarantee

- `sandbox="allow-scripts"` **alone**, never with `allow-same-origin` — together
  they let a frame remove its own sandbox.
- The opaque origin that `srcdoc` + the above produces.
- The injected CSP — **this and not the sandbox is what stops exfiltration.**
  `connect-src 'none'` is the single most load-bearing directive in the app.
- Pre-render stripping of `<script src>`, `<link>`, `<base>`, nested frames,
  `<meta refresh>` and any CSP the model wrote itself.

### Residual risk (accepted)

A sandboxed frame can still burn CPU, spin forever, or render something
unpleasant. Mitigated by a **Stop** control that removes the frame. It cannot
read, write, phone home, or navigate.

### Original analysis (retained)

## R1 (historic) — Rendering generated HTML

A prototype is model-written HTML **and JavaScript** that must execute to be
worth anything. The app's entire value — every idea the user has ever had —
sits in `localStorage` on the same origin.

**Sandboxing alone is not sufficient.** The required controls, all of them:

1. **`sandbox="allow-scripts"` and nothing else.** Critically, **never add
   `allow-same-origin` alongside `allow-scripts`** — together they let the frame
   reach out and remove its own sandbox attribute from the parent document.
2. **A null/opaque origin**, which `srcdoc` + the above gives. The frame then
   cannot read the parent's `localStorage`, cookies, or IndexedDB.
3. **A CSP on the frame content** restricting `default-src 'none'`,
   `script-src 'unsafe-inline'`, `img-src data:`, and **`connect-src 'none'`**.
   Without `connect-src 'none'` a generated page can `fetch()` anything — this
   is the exfiltration path that sandboxing does *not* close.
4. **No `allow-popups`, `allow-top-navigation`, `allow-modals`, `allow-forms`.**
   Top-navigation in particular lets a frame redirect the whole app.
5. **Strip or refuse external references before rendering.** The generator is
   told to inline everything; verify it did. Any `<script src>`, `<link href>`
   or `<img src>` pointing off-origin is both a privacy leak and a supply-chain
   hole.
6. **`referrerpolicy="no-referrer"`** and `allow="camera 'none'; microphone 'none'; geolocation 'none'"`.
7. **Treat the HTML as data in storage too.** It must never be injected into the
   parent DOM, only into `srcdoc`.

**Residual risk after all of the above:** a sandboxed frame can still consume
CPU, spawn `alert`-free busy loops, or render upsetting content. Acceptable;
mitigate with a visible "stop" control that removes the frame.

**Recommendation:** build the renderer as one reviewed module with no options.
Do not let call sites choose sandbox flags.

## R2 — Unmetered model endpoints (HIGH, **BLOCKS PUBLIC DEPLOYMENT**)

`/api/develop` and `/api/brief` require **no credit and no authentication**.
Anyone who can reach the server spends the operator's API budget, throttled
only by 30 requests/minute/IP (`ratelimit.ts`), which is per-process and
in-memory. Trivially bypassed with multiple IPs.

`/api/interview` is also unmetered and now sits on this list.

Fine on `localhost`. **Must be resolved before any public deployment.**

---

# PUBLIC DEPLOYMENT IS BLOCKED

Milestone 1 delivers the product loop, not the protections a public service
needs. **Do not host this where strangers can reach it** until all of the
following exist. None of them are built:

| Required before launch | State |
| --- | --- |
| Server-enforced generation authorization | **Partial.** The credit check is server-enforced and sound. The free first creation is now also server-decided (`POST /api/claim`, recorded against a salted hash of the caller's address), and is **off by default**. What it is worth is bounded by how hard that claim key is to change — see "What the free claim is actually worth" below. |
| Per-user usage limits | **Missing.** There are no users. |
| Throttling backed by persistent storage | **Missing.** `ratelimit.ts` is per-process and in-memory; a restart clears it and a second instance does not share it. The ledger has moved to Postgres; the limiter has not. |
| Maximum input sizes | **Present.** Every field capped in `validate.ts`. |
| Maximum output sizes | **Partial.** `max_tokens` caps each call; there is no cap on calls per person. |
| AI spending limits and monitoring | **Missing.** Usage is logged per request (`creation done: N in, N out`); nothing aggregates or stops at a threshold. |
| API credentials server-side only | **Present and verified.** The key never reaches the client; upstream errors are scrubbed of anything key-shaped. |
| Replay/abuse protection on generation | **Missing.** A captured request can be replayed; it will spend a credit each time, but nothing rate-limits per token. |

## What the free claim is actually worth

A creation costs roughly $0.50–$0.70 of API spend, so "one free" is a real
bill and worth being precise about.

What changed: the decision moved off the phone. `POST /api/claim` asks the
ledger, the ledger writes a row keyed on the claim hash, and a second claim for
the same key gets nothing. That row is in Postgres when the Supabase ledger is
in use, so it survives a redeploy, and the primary key on it means two
simultaneous claims cannot both win. `scripts/ledger-sql-check.mjs` proves
both against a real PostgreSQL.

What has **not** changed, and must not be claimed otherwise: the claim key is a
salted hash of the caller's IP address, and that is all the identity there is
without accounts. So:

- **A new network is a new free creation.** A VPN, mobile data, a coffee shop —
  each one is another $0.50. This stops the easy loop (clear site data, ask
  again); it does not stop anyone who wants to.
- **Two people behind one router share one free creation.** The second person
  is told they have had theirs when they have not. That is the cost of having
  no accounts, and it is a bad first impression.
- **It is off by default.** `HIGH_THOUGHTS_FREE_CLAIMS=0` unless somebody
  decides to spend the money, and it refuses to switch on without
  `HIGH_THOUGHTS_CLAIM_SALT` — an unsalted address hash is reversible by
  anyone holding a list of addresses.

The honest fix is an account the free creation can be attached to. Until that
exists, this is a tuned leak, not a closed one.

## R3 — No authentication anywhere (HIGH for hosting, by design today)

No sessions, cookies, accounts or identity. Today this is a privacy *feature* —
no signup means nothing to breach. But it means:
- the credit token is the only identity, and it is a bearer secret in `localStorage`
- a user who clears site data loses every idea, irrecoverably
- there is no way to serve a user on two devices

## R4 — Credit token handling (MEDIUM)

Mitigated well: tokens are stored as SHA-256 hashes in both ledgers — the
database never receives a spendable secret — and tests prove a leaked store
yields nothing usable. On the Postgres ledger the tables sit in a schema
PostgREST does not expose, and `anon`/`authenticated` (the roles a leaked
publishable key maps to) are refused every way in; the SQL check asserts all
sixteen. Remaining issues:
- the token is accepted via **query string** on `GET /api/credits` and the job
  stream, so it will appear in server logs and proxy logs
- no expiry, no revocation, no rotation
- `localStorage` on the client is readable by any XSS on the app's origin — which
  is precisely why R1 must be got right

## R5 — Prompt injection via stored content (MEDIUM)

The profile sent with every request is built from the user's own text and from
model output they marked. All fields are length-capped in
`validate.ts:normaliseProfile`, which limits blast radius, but the content is
interpolated into a system prompt. A user can therefore steer their own
assistant. Low harm in a single-tenant app; **becomes a real issue if
prototypes are ever shared and a shared artifact can seed another user's
context.**

## R6 — Physics and factual claims presented as simulation (MEDIUM, product risk)

The flying-car prototype's arithmetic was **validated and is internally
correct**: 1.2 kg / 0.8 s × 9 m/s = 13.5 N; 1,430 kg × 9.81 = 14,028 N;
1,039 bottles required; 400 bottles = 38% of weight, so it correctly does not
fly.

**But the inputs are guesses, and unmodelled terms are large** — the mass of
~1,000 filled bottles is itself comparable to the car. The page says so in
plain language ("eyeballed off bottle-rocket videos, not a lab").

Risk: marketing or UI copy that calls this a "simulation" without that framing.
**Keep the stated-assumptions block mandatory in the generator prompt.** It is
currently the only thing preventing a confident wrong number.

## R7 — Secrets (LOW, handled)

`ANTHROPIC_API_KEY` is server-side only and never sent to the client. `.env` is
gitignored, `chmod 600`, and was verified unstaged before each commit. The
credit ledger is also gitignored. `claude.ts:apiMessage` redacts anything
key-shaped from upstream errors before they reach the phone, with a test.

**Operational note:** two API keys were pasted into a chat transcript during
development and should be rotated.

## R8 — In-memory state lost on restart (LOW)

Jobs and rate-limit windows live in process memory. A restart drops in-flight
prototypes; the client sees the stream end without a `done`. Users lose time,
not money — the credit is spent but the refund hook does not fire on a crash.
**Prototype refunds should be reconciled if generation ever becomes expensive.**
