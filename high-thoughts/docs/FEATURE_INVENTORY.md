# Feature inventory

Classification per feature. **"Verified" means exercised against the running
system on 2026-10-26, not that source code exists.**

Legend: **1** working & verified · **2** implemented, under-tested · **3** partial ·
**4** planned only · **5** broken/blocked · **6** obsolete

---

## Capture

| Feature | # | Evidence |
| --- | --- | --- |
| Text capture, 4,000 char cap | **1** | `public/index.html:textarea`, `validate.ts:28` · driven in browser |
| Voice dictation | **2** | `app.js:296-360` — Web Speech API, feature-detected, hides when absent. **Never tested with a real microphone.** No automated test exists or can easily exist. |
| Thought saved before the model is called | **1** | `store.js:capture()` — a dropped connection loses the answer, never the idea |
| Original text preserved verbatim | **1** | `store.js` never rewrites `thought` |

## Conversation

| Feature | # | Evidence |
| --- | --- | --- |
| Four modes (Riff/Build/Sober/Deep) | **1** | `modes.ts` · all four run live; Sober returned "Let it go" on a real idea |
| Per-mode reasoning effort | **1** | `modes.ts:effort` — low for Riff, high for Sober/Deep |
| Streaming + summarised thinking ghost line | **1** | `claude.ts:46`, `app.js` |
| Follow-ups replay history | **1** | `prompts.ts:buildDevelopPrompt` · 10 tests |
| Keep/kill line marking | **1** | `app.js:toggleMark` · browser-verified; marks reach the server with text |
| Cross-idea profile | **1** | `profile.js` + `prompts.ts:renderProfile` · 12 tests; verified silent for <2 thoughts, present on the 3rd |
| Non-terminating answers / one-tap continuations | **4** | Designed in conversation. **Not built.** Modes still end on a closer. |

## Interview (new direction)

| Feature | # | Evidence |
| --- | --- | --- |
| Mechanism question generation | **3** | `interview.ts` — excellent output, verified by script: 3 questions on "i want a flying car", correctly classified `simulation`. **No route, no UI, no tests.** |
| Four-question ceiling enforced in code | **2** | `interview.ts:101` — logic present, not unit-tested |
| Ghost-text example answers | **3** | Produced correctly; never displayed to a user |

## Artifact generation

| Feature | # | Evidence |
| --- | --- | --- |
| Prototype generator | **3** | `prototype.ts`. **Generality verified** — 3 ideas across all 3 kinds produced working pages: flying car (simulation), argue-with-your-alarm (app), sad cereal box (design). All animated, 0 external resources, 0 console errors. **No route, no UI, no tests.** |
| Prototype rendering in the app | **4** | **Nothing exists.** No iframe, no sandbox, no CSP anywhere in the repo. |
| Textbook generator | **6** | `textbook.ts` — fully working and fully wired, but the direction is discontinued. Costs ~$1.20 vs the prototype's ~$0.50. |
| Brief / log reader | **1** | `brief.ts` · verified: a line killed by hand landed in `ruledOut` |

## Library & persistence

| Feature | # | Evidence |
| --- | --- | --- |
| Thought log, newest first | **1** | `store.js:list()`, `app.js:renderLog` |
| Tree/branch view | **4** | Flat list only |
| Idea Library (chronological life of one idea) | **4** | **Not started.** Current "Library" screen lists books. |
| Version history | **4** | Not started |
| Export | **4** | Not started |
| Sharing | **4** | Not started; blocked by local-only storage |
| Offline shell | **2** | `sw.js` — registers, never tested after a real deploy |

## Money & limits

| Feature | # | Evidence |
| --- | --- | --- |
| Credit ledger | **1** | `credits.ts` · 20 tests incl. double-spend and leaked-ledger |
| Paywall enforcement on books | **1** | Verified live: no token → 402, fake → 402, real → works then 402 |
| Refund on failure | **2** | `server.ts` settle hook — logic present; **failure path never exercised end-to-end** |
| Cross-process ledger reload | **1** | Verified live: granted while running, seen on the next request |
| Free first creation | **4** | Not implemented; no free allowance exists |
| Stripe / any payment provider | **4** | **Nothing.** Only comments mention Stripe. Codes are issued by `npm run credits`. |
| Per-IP rate limit | **1** | `ratelimit.ts` · 5 tests |
| Per-request token caps | **1** | `max_tokens` set on every call |
| Dollar budget per request/session | **4** | Not implemented. A prototype's cost is bounded only by `max_tokens`. |
| **Conversation endpoints are unmetered** | **5** | `/api/develop` and `/api/brief` take **no credit**. Anyone reaching the server can spend the operator's money, limited only by 30 req/min/IP. Acceptable locally; **not acceptable once hosted.** |

## Platform

| Feature | # | Evidence |
| --- | --- | --- |
| Authentication | **4** | None of any kind. No sessions, cookies, or users. |
| Deployment config | **4** | No Dockerfile, fly.toml, Procfile, or CI workflow |
| Public hosting | **4** | Never deployed |
| `start.sh` one-command local run | **2** | Written and pushed; **not executed end-to-end on a clean machine** |
| Demo builder | **1** | `scripts/build-demo.mjs` · browser-verified |
| PWA install | **2** | manifest + icons present; install flow never tested on a real phone |

---

## Recurring defect found during the audit

**SVG text overflows its container.** Visible in two of three generated
prototypes: the flying car's labels collide under the vehicle, and the cereal
box's "SITUATIONS" title is clipped at both edges. This is a generator-quality
issue, not a one-off, and should be addressed in the prototype system prompt
(constrain text to measured boxes, or wrap).
