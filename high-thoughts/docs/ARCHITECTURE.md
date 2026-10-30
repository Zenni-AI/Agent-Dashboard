# Architecture

**As built on `05fad15`.** Nothing here is aspirational.

## Stack

- **Server** — Node 20+, TypeScript, `node:http` directly. No Express, no framework.
- **Client** — plain ES modules served as written. **No build step, no bundler, no framework.** The file you read is the file that runs.
- **Model** — `@anthropic-ai/sdk`, `claude-opus-5`, streaming over SSE.
- **Storage** — the browser's `localStorage`. No database.
- **Tests** — Vitest, 149 tests.

The absence of a frontend build is deliberate and worth preserving: it removes
a whole class of deploy problem and keeps the client auditable.

## Request flow

```
phone ──POST /api/develop──> server ──> Anthropic ──stream──> SSE ──> phone
                               │
                               ├─ validate.ts   every field capped; client input is untrusted
                               ├─ ratelimit.ts  fixed window, per IP, in memory
                               ├─ prompts.ts    system prompt + profile + mode brief
                               └─ claude.ts     stream, translate failures
```

### Long work: jobs, not requests

`jobs.ts` decouples generation from the connection that asked for it. A
prototype or book takes minutes; phones lock. The job runs to completion
regardless, accumulating events, and a client may attach, drop and re-attach —
receiving everything produced so far, then the rest live. In-memory, per
process; a restart loses in-flight jobs.

### Paid work: the credit ledger

Every paid endpoint spends a credit *before* anything reaches the model. The
token is a bearer secret, stored only as a SHA-256 hash, so neither store ever
holds something spendable.

There are two stores behind one interface (`ledger.ts`), picked by config
(`ledger-factory.ts`), and nothing above that line knows which one it got:

| | `CreditStore` (`credits.ts`) | `SupabaseLedger` (`ledger-supabase.ts`) |
| --- | --- | --- |
| Where | `.high-thoughts/credits.json` | Postgres, over PostgREST |
| Right for | one machine | anything other people can reach |
| Survives a redeploy | no — container disk | yes |
| Two server instances | **unsafe**, will double-spend | safe |
| Dependencies | none | none (one `fetch` per call) |

Properties the file ledger is tested for:

- a leaked ledger yields no usable token
- concurrent spends are serialised (10 requests against 3 credits → exactly 3)
- the file is written by rename, so a crash cannot truncate it
- an unreadable ledger starts **empty** — the safe failure is "nobody gets one"
- the ledger reloads when another process writes it (how a payment webhook will work)

The Postgres ledger keeps the rules in SQL (`supabase/migrations/`), because a
mocked test cannot reach the thing that decides whether somebody is charged
twice. `npm run ledger:sql` stands up a throwaway PostgreSQL, applies the
migration as Supabase would, and asserts:

- a spend is one conditional `UPDATE`, so two overlapping transactions racing
  for the last credit produce one success and one refusal — verified by holding
  the row in an open transaction while the other side tries
- a claim key gets exactly one free creation, and the loser leaves no orphan
  account behind
- `anon` and `authenticated` — the roles a leaked publishable key maps to — are
  refused all eight ways in, while `service_role` can still do everything
- the argument names the TypeScript client sends actually resolve

A ledger that cannot be reached **fails closed**: the request is refused with
503 and nothing is charged. An outage must never be the cheapest route to free
work.

### The free first creation

`POST /api/claim` is the only way to get one, and the ledger — not the phone —
decides. It is **off by default** (`HIGH_THOUGHTS_FREE_CLAIMS`), and refuses to
switch on without a salt. What the claim key is worth is covered honestly in
`SECURITY_RISKS.md`; short version: it stops clearing site data, it does not
stop a VPN, and two people behind one router share one.

## Modules

| File | Role | Wired? |
| --- | --- | --- |
| `server.ts` | routing, static files, SSE, job streaming | yes |
| `claude.ts` | develop-a-thought stream; failure translation | yes |
| `prompts.ts` | shared system prompt, profile rendering, follow-ups | yes |
| `modes.ts` | the four modes: sections, effort, instructions | yes |
| `brief.ts` | reads a thought's log into structured decisions | yes |
| `textbook.ts` | the discontinued book | yes — **should be retired** |
| `jobs.ts` | background work with replayable streams | yes |
| `ledger.ts` | what the paywall talks to: the interface both stores implement | yes |
| `credits.ts` | the ledger as a JSON file — one machine | yes |
| `ledger-supabase.ts` | the ledger in Postgres — anything public | yes (when configured) |
| `ledger-factory.ts` | picks the store the config asks for | yes |
| `token.ts` | issuing, hashing and shape-checking credit tokens | yes |
| `validate.ts` | every untrusted input | yes |
| `ratelimit.ts` | per-IP throttle | yes |
| `cli.ts` | issue/top up credits, against whichever ledger is configured | yes (shell) |
| **`interview.ts`** | **asks how the thing works** | **NO — orphan** |
| **`prototype.ts`** | **generates the artifact** | **NO — orphan** |

## Client

| File | Role |
| --- | --- |
| `app.js` (1,237 lines) | screens, streaming, marking, dictation, offer, credits |
| `store.js` | localStorage: thoughts, turns, marks, books |
| `markdown.js` | escape-first renderer; tables, citations, mark indices |
| `profile.js` | derives the cross-idea profile locally |
| `offer.js` | pure rules for when to show the upgrade modal |
| `sw.js` | offline shell |

Screens: **catch → result → brief → book → log → library**, plus a modal.

## Data model (localStorage)

```js
// high-thoughts/v1
{ id, thought, title, createdAt,
  turns: [{ mode, text, title, at, marks: [{index, state, text}] }] }

// high-thoughts/books/v1
{ id, thoughtId, title, building, text, sources, status, createdAt }

// high-thoughts/token/v1   bearer token (string)
// high-thoughts/offer/v1   { offered[], dismissed, lastOfferAt }
```

**There is no `prototypes` collection and no version history.** Both are
required by the new vision and are additive — no migration needed.

## What the new direction needs architecturally

1. **A prototypes store** — same shape as books, holding HTML instead of markdown.
2. **A sandboxed renderer** — does not exist in any form. See `SECURITY_RISKS.md`.
3. **An interview screen** — one question at a time, answers kept on the thought.
4. **Idea Library** — a chronological read of one idea: what was typed, what was
   asked, what was answered, what was built.
5. **Sharing (if wanted)** — the only item that forces server-side storage and
   breaks the current privacy guarantee. Decide before building.

Items 1, 3 and 4 reuse existing infrastructure unchanged. Item 2 is new code.
Item 5 is an architectural change.
