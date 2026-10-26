# Security risks

Audited 2026-10-26 against `05fad15`.

## The headline

**Generated HTML is never rendered today, because no renderer exists.** There
is no `<iframe>`, no `sandbox` attribute and no CSP header anywhere in the
repository — verified by grep across `src/` and `public/`. So there is no
current execution vulnerability. There is also no mitigation to inherit: the
renderer must be built correctly from nothing.

---

## R1 — Rendering generated HTML (CRITICAL, before any prototype UI ships)

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

## R2 — Unmetered model endpoints (HIGH, blocks hosting)

`/api/develop` and `/api/brief` require **no credit and no authentication**.
Anyone who can reach the server spends the operator's API budget, throttled
only by 30 requests/minute/IP (`ratelimit.ts`), which is per-process and
in-memory. Trivially bypassed with multiple IPs.

Fine on `localhost`. **Must be resolved before any public deployment.**

## R3 — No authentication anywhere (HIGH for hosting, by design today)

No sessions, cookies, accounts or identity. Today this is a privacy *feature* —
no signup means nothing to breach. But it means:
- the credit token is the only identity, and it is a bearer secret in `localStorage`
- a user who clears site data loses every idea, irrecoverably
- there is no way to serve a user on two devices

## R4 — Credit token handling (MEDIUM)

Mitigated well: tokens are stored server-side as SHA-256 hashes, and a test
proves a leaked ledger yields nothing usable. Remaining issues:
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
