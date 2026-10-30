# Running High Thoughts

Everything you need to get it on your phone, in order.

---

## The API you need

**One: an Anthropic API key.** console.anthropic.com → API keys.

That is the entire list. No database, no auth provider, no storage bucket, no
YouTube key, no affiliate account. Thoughts live in the browser; the server
stores nothing and talks to exactly one service.

The book is the product, so there is nothing to send people out to — the
resources live inside the book, found and linked by the writer as it works.

## 1. Run it

```bash
cd high-thoughts
npm install
cp .env.example .env          # put your key in ANTHROPIC_API_KEY
npm run dev                   # http://localhost:8080
```

Node 20+. For production: `npm run build && npm start`.

## 2. Get it on your phone

Both devices on the same wifi:

```bash
# find your machine's LAN address
hostname -I | awk '{print $1}'        # Linux
ipconfig getifaddr en0                # macOS
```

Open `http://<that-address>:8080` on your phone → **Share → Add to Home Screen**. It installs as a standalone app with its own icon.

> Dictation and the offline shell need HTTPS anywhere other than localhost. On your LAN the app still works; the mic button just hides itself.

## 3. Deploy it (when you want it off your desk)

Any Node host — Fly, Railway, Render, a VPS. It's one process, no database.

- Set `ANTHROPIC_API_KEY` in the host's environment. **Never commit `.env`.**
- Set `PORT` if the host demands a specific one (it reads `PORT` already).
- Put it behind HTTPS. Then dictation and Add-to-Home-Screen work properly.
- Raise `HIGH_THOUGHTS_RATE_LIMIT` only when you know what you're paying.

---

## What it costs to run

Rough, per press, at Opus 5 rates ($5/$25 per MTok):

| Action | Measured |
| --- | --- |
| A thought developed (Riff, low effort) | ~$0.02 |
| A thought developed (Sober/Deep, high effort) | ~$0.03 |
| Reading the log into a brief | ~$0.04 |
| A textbook (high effort + web search, ~90 sources) | **$1–2** |

The textbook is the only expensive one, and it's the one you charge for. The
server logs `textbook done: N in, N out, N sources` for every book — price from
your own logs, not from this table.

A book runs 20k+ output tokens because it thinks hard and reads dozens of
sources. That is the product working, but it means a $9 book has real cost of
goods. Budget accordingly.

---

## Settings worth knowing

| Variable | Default | Does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required. Server-side only; the phone never sees it. |
| `HIGH_THOUGHTS_MODEL` | `claude-opus-5` | Model behind everything. |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | `0.0.0.0` is what lets your phone reach it. |
| `HIGH_THOUGHTS_RATE_LIMIT` | `30` | Requests per IP per minute. |
| `HIGH_THOUGHTS_MAX_CHARS` | `4000` | Longest thought accepted. |
| `HIGH_THOUGHTS_MAX_HISTORY` | `6` | Past turns replayed on a follow-up. |
| `HIGH_THOUGHTS_MAX_CHAINS` | `8` | Thoughts one textbook can be built from. |

---

## Book credits

Books are never free — the endpoint that makes one requires a credit, checked
server-side before anything reaches the model. Nothing the phone sends can
bypass it.

```bash
npm run credits -- new 3        # issue a token worth 3 books
npm run credits -- add <token> 5
npm run credits -- check <token>
```

Paste the token into the app under **Library → I have a code**. Tokens are
stored as hashes, so a leaked ledger yields nothing usable. A book that fails
refunds its credit automatically.

Thoughts, modes and the brief all stay free — the brief is the screen that sells
the book, so it must not sit behind the wall.

**Wiring real payments** is the next step and needs two things this repo cannot
supply: your Stripe keys, and a public HTTPS URL for the webhook. The webhook
handler calls `store.grant(token, n)` — the same function the CLI uses — and
nothing else changes.

---

## Seeing it without a key

```bash
node scripts/build-demo.mjs demo.html
```

Builds a single self-contained file from the real `public/` sources, with the
network replaced by canned model answers. Open it in any browser — every screen
and interaction works. Regenerated from source each time, so it cannot drift
from what ships.

---

## Checking it works

```bash
npm test          # 128 tests
npm run typecheck
curl localhost:8080/api/health
```

If a development returns *"The server's API key was rejected"* — the key isn't reaching the process. Check `.env` exists and sits in `high-thoughts/`, not the repo root.
