# High Thoughts — project status

**Audited:** 2026-10-26 · **Commit:** `05fad15` · **Branch:** `claude/high-thoughts-mobile-app-9sqlz0` · **PR:** [#2](https://github.com/Zenni-AI/Agent-Dashboard/pull/2) (open, mergeable, unreviewed)

Every claim below was checked against the running code on the date above. Where
something was not verified, it says so.

## One-line summary

**Milestone 1 is delivered.** The loop runs end to end: catch an idea, answer
two or three questions about how it works, get an interactive creation in a
hardened sandbox, and find it again in the Idea Library next to what you
originally typed. Verified live across three idea types.

**Public deployment remains blocked** — see `SECURITY_RISKS.md`. The product is
built; the abuse protections a public service needs are not.

## Milestone 1 — verified end to end (2026-10-26)

| Idea | Questions asked | Result |
| --- | --- | --- |
| "a backpack that turns into a chair when you sit down" | 2 | rendered, timeline complete |
| "an app that only lets you text people you havent spoken to in a year" | 3 | rendered, timeline complete |
| "a poster for a jazz night that doesnt look like a jazz poster" | 2 | rendered, 12.7 KB, clipped-text detector fired correctly |

Every creation rendered with `sandbox="allow-scripts"` and the injected CSP
present. Every idea survived a reload. Every timeline showed the original text
verbatim.

A fourth generation hit `max_tokens` exactly (32,000 out) and was therefore
truncated mid-document. That is now caught and reported as "this one got too
big", rather than rendering a half-drawn page.

## Build health

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | pass — 149 tests, 11 files |
| `npm run build` | pass — 16 JS files emitted |
| Server boots and serves | yes, verified `/api/health` and `/` |

Test output includes an expected stack trace from `jobs.test.ts`, which
deliberately throws inside a generator to prove the job store converts it to an
error event. It is not a failure.

## The gap that matters

`src/interview.ts` and `src/prototype.ts` exist, typecheck, and produce
excellent output when driven by a script. **Neither is reachable from the
application.** There is no route, no UI, and no test:

```
$ grep -rl "interview\|prototype" src/ public/ tests/ | grep -v "src/(interview|prototype).ts"
  (no matches)
```

Meanwhile `src/textbook.ts` — the discontinued direction — is fully wired, paid
for, and is what a user of the app today receives.

## Where the product vision stands

| Vision item | State |
| --- | --- |
| One-tap capture | working (text + dictation) |
| Original idea preserved | working — stored verbatim, never overwritten |
| Mechanism interview | working — wired, capped at four questions |
| Visual/interactive artifact | working — generated and displayed in a hardened sandbox |
| Idea Library with history | working — diagram, original text, and the timeline that led to it |
| Revisit and evolve | working — a creation can be re-made with feedback, and keeps a version number |
| Version history | partial — versions are numbered and stored; nothing in the UI compares them |
| Private storage | working — `localStorage` only, server stores no ideas |
| Export | partial — `store.exportAll()` exists; no UI calls it |
| Sharing | **not started**, and architecturally blocked by local-only storage |
| Free first creation | mechanism built and server-enforced (`POST /api/claim`), **off by default** and keyed only on an address hash — see `SECURITY_RISKS.md` |
| Durable credit ledger | built — Postgres behind the same interface as the JSON file, SQL verified against a real PostgreSQL; **not yet pointed at a project** |
| Usage-based monetization | ledger + enforcement working; **no payment provider** |

## Known costs (measured, not estimated)

| Action | Tokens | Cost |
| --- | --- | --- |
| Develop a thought (Riff, low effort) | 943 in / 619 out | ~$0.02 |
| Develop a thought (Sober, high effort) | 1,699 in / 1,268 out | ~$0.03 |
| Interview question | ~700 in / ~400 out | ~$0.01 |
| **Prototype** | ~1,100 in / **17k–24k out** | **$0.43–$0.61** |
| Textbook (discontinued) | 102k in / 17.5k out | ~$1.20 |

A free creation therefore costs $0.43–$0.61 of real spend, which is why the
free allowance is a server decision and defaults to off.

The prototype is **roughly half the cost of the book** and a far better artifact.
Three generations were measured: 22,000 / 16,893 / 24,381 output tokens.

## Unresolved product decisions

These block implementation and need a human answer — see `NEXT_MILESTONES.md`.

1. Does a prototype have to leave the device to be shared? (Sharing vs. the
   local-only privacy guarantee are in direct conflict.)
2. ~~Is the first prototype free?~~ Decided: one free, server-enforced, and
   switched off until somebody chooses to spend the money. Still open: whether
   an address hash is a good enough identity to hand money to, or whether this
   waits for accounts.
3. Do the four conversation modes survive alongside the interview, or does the
   interview replace them?
4. Is the textbook deleted, or kept as a secondary artifact?
