# Next milestones

> **Milestone 1 is implemented.** What follows is kept for the record; the
> acceptance criteria below were the targets and are now met except where
> noted. See `PROJECT_STATUS.md` for verified results and
> `docs/SECURITY_RISKS.md` for why public deployment remains blocked.

## Milestone 2 — recommended next

**Make it safe to put in front of strangers.** Milestone 1 built the product;
none of it is abuse-resistant. In priority order:

1. ~~**Server-enforced free allowance.**~~ **Done, with a caveat.**
   `POST /api/claim` is server-decided and recorded in the ledger, so clearing
   site data no longer gets a second one. It is keyed on a salted hash of the
   caller's address, which a VPN defeats and which makes two people behind one
   router share a single free creation. Off by default. The honest fix is an
   account to attach the allowance to — see item 6.
2. **Persistent throttling.** `ratelimit.ts` is in-memory and per-process. The
   ledger now has a durable home; the limiter should move into it, keyed on the
   same claim hash so a restart does not reset anybody's quota.
3. **Spend monitoring with a ceiling.** Per-request usage is already logged;
   nothing aggregates it or stops.
4. **Meter `/api/develop`, `/api/brief`, `/api/interview`.** All three spend
   the operator's money with no credit.
5. Fix the SVG clipping defect at the prompt level (the detector now reports
   it; the generator should stop causing it).

6. **Accounts.** Everything above is tuning a leak that only an identity
   closes, and it is also the only way somebody keeps their library after
   clearing site data or picks it up on a second device.

Only after those: deployment config, a host, and a Stripe payment link.

### What landed toward Milestone 2 already

The ledger is no longer tied to a JSON file. `ledger.ts` is the interface,
`credits.ts` is the file store, `ledger-supabase.ts` is Postgres, and
`ledger-factory.ts` picks between them from config — so moving a running app
onto a durable ledger is two environment variables and a migration, with
existing tokens working unchanged on either side. `supabase/migrations/` holds
the schema; `npm run ledger:sql` verifies it against a real PostgreSQL.

Still outstanding before a public host: items 2–5, a decision on which
Supabase project to use, and a host that can hold a 2–4 minute streaming
request (which rules out the usual serverless defaults).

---

# Original Milestone 1 plan (delivered)

**Principle:** finish the idea → library loop before anything else. No new
infrastructure, no accounts, no external services until the loop is whole.

---

## Milestone 1 — Close the loop (the only milestone that matters now)

Today a user can capture a thought and talk about it. They cannot get a
prototype, because the two modules that make one are orphans. This milestone
connects them and nothing else.

### M1.1 — Sandboxed prototype renderer

The security-critical piece. One module, no options, no call-site choices.

**Acceptance criteria**
- `renderPrototype(html)` returns an `<iframe sandbox="allow-scripts">` using
  `srcdoc`, with `allow-same-origin` **absent**
- A CSP meta is injected into the frame content with `default-src 'none'`,
  `connect-src 'none'`, `img-src data:`, `script-src 'unsafe-inline'`
- A test proves a frame containing `localStorage.getItem('high-thoughts/v1')`
  throws or returns null rather than the user's thoughts
- A test proves a frame containing `fetch('https://example.com')` is blocked
- External `<script src>` / `<link href>` are stripped before render, with a test
- A visible **Stop** control removes the frame

### M1.2 — Interview screen

**Acceptance criteria**
- `POST /api/interview` → `{question, placeholder, ready, understanding, buildKind}`
- One question on screen at a time, with the ghost text as the input placeholder
- Answers stored on the thought; the original text is never modified
- Hard stop after 4 questions, enforced server-side (already in `interview.ts:101`)
- A "just build it" control that skips remaining questions
- Validation tests for the route mirroring `validate.test.ts`

### M1.3 — Prototype generation and storage

**Acceptance criteria**
- `POST /api/prototype` starts a **job** (reuses `jobs.ts` unchanged)
- `GET /api/prototype/:id` streams and replays, like the textbook route
- Saved to a new `high-thoughts/prototypes/v1` store the moment the job starts
- Re-attaching after closing the app resumes the same prototype
- Markdown fences stripped server-side, not in the client

### M1.4 — Idea Library

The product's centre of gravity.

**Acceptance criteria**
- Tap an idea → one chronological page: what you typed → each question and your
  answer → the prototype (rendered inline, sandboxed) → any conversation passes
- The original text is always visible and visually distinct from generated content
- Prototypes appear as thumbnails/cards, not a list of filenames
- Works with zero prototypes (an idea that was only talked about)

### M1.5 — Retire the textbook

**Acceptance criteria**
- `textbook.ts`, its routes, its client screens and its tests removed
- `brief.ts` **kept** — it reads a log into decisions and is reusable for prototypes
- The credit ledger re-pointed at prototypes
- Test count drops only by the textbook's own tests; everything else still passes

**Milestone 1 is done when:** a person opens the app, types an idea, answers two
questions, gets a prototype they can poke, and finds it again tomorrow in their
Library next to what they originally typed.

---

## Milestone 2 — Make it good (after the loop closes)

- **Fix SVG text overflow** in the generator prompt — a confirmed defect in 2 of
  3 generated prototypes
- **Free first prototype** — product decision pending (see below)
- Version history: regenerate a prototype, keep the old one
- Export: download the HTML; "save all my ideas" as JSON
- Idea Library as a tree, not a list

## Milestone 3 — Leave the laptop (needs approval)

Everything here costs money or changes the privacy model. **None of it should
start before Milestone 1 is done.**

- Metering `/api/develop` and `/api/brief` (**blocks hosting** — see R2)
- Deployment config and a host
- Stripe payment link → emailed codes (no webhook needed to launch)
- Sharing — **the only item that forces server-side storage**

---

## Decisions needed before Milestone 1 can finish

| # | Decision | Why it blocks |
| --- | --- | --- |
| D1 | Is the first prototype free? | Changes M1.3's paywall and the offer modal |
| D2 | Do the four modes survive alongside the interview? | Changes M1.4's Library layout and the catch screen |
| D3 | Is sharing in scope? | If yes, local-only storage is wrong and M1.3 must store server-side instead |
| D4 | Delete the textbook or keep it as a secondary artifact? | M1.5 is a deletion; reversing it later is expensive |

My recommendations: **D1 yes** (the artifact is the marketing), **D2 keep modes
free** (they are the cheap top of the funnel), **D3 defer** (do not let it
reshape storage before the loop works), **D4 delete** (it is wired, paid for,
and contradicts the stated direction).
