# High Thoughts — project status

**Audited:** 2026-10-26 · **Commit:** `05fad15` · **Branch:** `claude/high-thoughts-mobile-app-9sqlz0` · **PR:** [#2](https://github.com/Zenni-AI/Agent-Dashboard/pull/2) (open, mergeable, unreviewed)

Every claim below was checked against the running code on the date above. Where
something was not verified, it says so.

## One-line summary

The **thought → conversation → book** product is complete and working. The
**thought → interview → prototype** product that replaces it is proven at the
model layer and **not connected to the app at all**. The repository currently
ships the discontinued product.

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
| Mechanism interview | model layer proven, **not in the app** |
| Visual/interactive artifact | model layer proven, **not in the app, cannot be displayed** |
| Idea Library with history | **not started** — current Library lists books only |
| Revisit and evolve | partially — re-developing a thought works; no versioning |
| Version history | **not started** |
| Private storage | working — `localStorage` only, server stores nothing |
| Export | **not started** |
| Sharing | **not started**, and architecturally blocked by local-only storage |
| Free first creation | **not started** — the paywall currently has no free allowance |
| Usage-based monetization | ledger + enforcement working; **no payment provider** |

## Known costs (measured, not estimated)

| Action | Tokens | Cost |
| --- | --- | --- |
| Develop a thought (Riff, low effort) | 943 in / 619 out | ~$0.02 |
| Develop a thought (Sober, high effort) | 1,699 in / 1,268 out | ~$0.03 |
| Interview question | ~700 in / ~400 out | ~$0.01 |
| **Prototype** | ~1,100 in / **17k–24k out** | **$0.43–$0.61** |
| Textbook (discontinued) | 102k in / 17.5k out | ~$1.20 |

The prototype is **roughly half the cost of the book** and a far better artifact.
Three generations were measured: 22,000 / 16,893 / 24,381 output tokens.

## Unresolved product decisions

These block implementation and need a human answer — see `NEXT_MILESTONES.md`.

1. Does a prototype have to leave the device to be shared? (Sharing vs. the
   local-only privacy guarantee are in direct conflict.)
2. Is the first prototype free? The offer modal and credit ledger assume not.
3. Do the four conversation modes survive alongside the interview, or does the
   interview replace them?
4. Is the textbook deleted, or kept as a secondary artifact?
