# LITIX

**Read a YouTube channel's analytics, work out what is actually working on it, and price what that audience is worth — as a ranked set of monetization plays with the arithmetic shown.**

Most creator "analytics" tools stop at a dashboard: here are your views, here is your watch time, good luck. Most creator revenue calculators do the opposite — they multiply subscribers by an invented conversion rate and produce a number nobody should act on.

LITIX does the part in between. It learns the channel's own patterns from its own data, benchmarks them against operators who have already solved the same problem, and turns that into costed options: what to sell, at what price, to how many people, with what it would take to get there and what would tell you to stop.

---

## What it actually does

**1. Ingests.** Public channel and video data via the YouTube Data API. Optionally, with your authorisation, your own retention curves, impressions and traffic sources via the YouTube Analytics API.

**2. Analyses.** Splits Shorts from long-form and scores each against its own baseline. Finds the uploads that beat that baseline and the packaging patterns behind them — measured on your channel, not borrowed from general advice. Reads retention where it can: how much of the audience survives the hook, and how much reaches the payoff.

**3. Benchmarks.** Compares format mix, cadence, packaging and reach-per-subscriber against reference operators in the same niche, and reports which of their patterns you are not using.

**4. Prices the audience.** Translates views into reach, reach into the slice that would actually consider buying, and that slice into revenue across eleven product archetypes — each with three scenarios, a sensitivity table, and every assumption named.

**5. Ranks the plays.** Orders them by return relative to what it costs to reach — money, effort, time to the first dollar, and whether you can actually execute it. Then Claude turns the top of that ranking into offers, titles and a 30-day plan, using only the numbers already computed.

---

## Install

```bash
git clone <this repo>
cd litix
npm install
cp .env.example .env      # add at minimum YOUTUBE_API_KEY
npm run build
```

Node 20 or newer.

---

## Use

```bash
# What is working on this channel?
npx litix profile @SomeChannel

# What is the audience worth, and what should be sold to it?
npx litix money @SomeChannel --skills "welding,teaching" --hours 15 --capital 2000

# Everything: analysis, benchmark, projections and strategy
npx litix run @SomeChannel --benchmark --out report.md

# Your own channel, including retention data
npx litix auth
npx litix run @YourChannel --owner --benchmark --out report.md
```

During development, `npm run litix -- <args>` runs the CLI straight from source.

### Commands

| Command | What it does |
| --- | --- |
| `profile <channel>` | Analysis only: formats, outliers, hooks, cadence, niche. |
| `money <channel>` | Audience model plus the ranked plays. |
| `run <channel>` | The full pipeline, including the Claude strategy layer. |
| `auth` | Authorise LITIX to read your own YouTube Analytics. |
| `quota <videos>` | Estimate Data API quota before spending it. |
| `cache clear` | Empty the on-disk API cache. |
| `earn rank` | The Earner: rank every legal income play for your situation and build the stack. No key needed. |
| `earn plan` | The Earner: the next 24 hours, hour by hour, from Claude. |
| `earn log` / `earn status` | Record income and see net, rate and the tax reserve. |
| `earn plays` / `earn screen` | List the catalogue; check an idea against the legal and ethical charter. |

### Options worth knowing

| Option | Effect |
| --- | --- |
| `--owner` | Pull retention, impressions and traffic sources. Requires `litix auth`. |
| `--benchmark` | Compare against reference operators in the same niche. |
| `--no-advise` | Skip the Claude layer; emit the computed report only. No Anthropic key needed. |
| `--skills`, `--hours`, `--capital`, `--list-size` | Operator constraints. These change the ranking, not just the commentary. |
| `-n, --max-videos` | Uploads to analyse, newest first. Default 200. |
| `-s, --since <days>` | Ignore uploads older than this. |
| `--json`, `-o <file>` | Machine-readable output, or write to a file. |

Channels can be given as `@handle`, a channel URL, or a `UC...` id.

---

## What is public and what is not

This distinction shapes everything, so it is worth being blunt about:

| Signal | Your channel | Anyone else's |
| --- | --- | --- |
| Views, likes, comments, duration, titles, tags | ✅ | ✅ |
| Format mix, cadence, packaging patterns, outliers | ✅ | ✅ |
| **Audience retention curves** | ✅ with `--owner` | ❌ never |
| **Impressions and click-through rate** | ✅ with `--owner` | ❌ never |
| **Traffic sources, unique viewers, revenue** | ✅ with `--owner` | ❌ never |

No tool can read another channel's retention. Anything claiming to is inferring it. LITIX benchmarks only what is genuinely observable and says so in the report.

---

## How the money model works

The chain from views to revenue loses people at every step, and LITIX makes each loss explicit.

```
monthly views
  ÷ views-per-viewer          → monthly reach        (a view is not a person)
  × engaged share (1-8%)      → engaged audience     (most of the reach felt nothing)
  × monthly offer exposure    → convertible audience (the rest already saw it and passed)
  × conversion × intent       → buyers
  × price                     → gross
  × (1 - delivery) × (1 - refunds) → net
  capped by delivery capacity → what you can actually fulfil
```

Four choices in there do most of the work:

**The engaged audience, not the subscriber count.** Conversion is applied to the slice of monthly reach that is plausibly reachable commercially — between 1% and 8%, scaled by a quality score built from engagement, retention, subscriber conversion and consistency. This is set deliberately low. It is the main reason LITIX produces smaller numbers than most revenue calculators, and the main reason they are worth acting on.

**Monthly, not launch, conversion.** Published conversion rates are launch figures — what converts the first time an audience sees an offer. Applying that every month assumes an audience with no memory. LITIX assumes roughly a third of the engaged audience is newly exposed in any given month.

**Price is held constant across scenarios.** Scenarios vary conversion only. Pairing the lowest price with the lowest conversion and the highest with the highest manufactures a range several times wider than the real uncertainty. Price is a decision; its effect appears in the sensitivity table instead.

**Delivery capacity caps one-to-one work.** Consulting and done-for-you services are bounded by hours, not demand. Without that ceiling the model cheerfully projects a hundred consulting clients a month for one person.

**Commercial intent varies by niche.** A million views of a montage and a hundred thousand views of "how I price a roof wash" are not the same asset. Each niche carries an intent figure that scales conversion, capped at 0.4x–1.6x so no niche is written off or waved through.

Every derived figure in the report carries its assumption. If you disagree with one — and you should, once you have your own numbers — the report tells you exactly which lever to move.

---

## Ranking: the path of least resistance

Ranking on revenue alone always crowns the same option: build software, sell it forever. Correct arithmetic, useless advice for someone with ten hours a week and no runway.

A play's score blends its 90-day expected value (ramped for build time, so slow options stop looking free), the effort it demands, how fast the first dollar arrives, and how well it matches the skills you actually have — then multiplies by structural fit with the channel: niche, audience scale, whether there is enough long-form to sell anything above $200, and whether output is consistent enough to support recurring revenue.

Plays you cannot resource today are marked with their blockers rather than hidden, so the trade-off stays visible.

---

## The Earner

A second agent lives alongside the channel engine, for a different person: someone in New Jersey who needs real income fast and will only do it legally.

```bash
# What should I do, today, with what I have? No API key needed.
npx litix earn rank --days 10 --hours 6 --cash 50 --has all --skills teaching

# The next 24 hours, hour by hour, from Claude. Needs ANTHROPIC_API_KEY.
npx litix earn plan --days 10 --hours 6 --cash 50 --has age-18,smartphone,internet,car,drivers-license,can-leave-home,physical-work,bank-account,work-authorization \
  --propose "sell my old bike" "sports betting with a system" --out today.md

# Record the money as it arrives; the next brief re-plans from it.
npx litix earn log sell-belongings 140 --hours 1.5 --note "PS5 and the bike"
npx litix earn status

# Check an idea before spending a minute on it.
npx litix earn screen resell concert tickets above face value
```

**What it is.** A catalogue of twenty-two ways a person in New Jersey can turn time, skills and belongings into reported income, each with its realistic hourly band after costs, the days it takes to pay, the hours it can absorb, what it needs up front, and every federal, state, municipal and platform obligation attached, with where to verify each one. A deterministic ranker scores each play for *this* person: speed to the first dollar weighted by how soon the money is needed, dollars realistically earnable inside that window, and fit with stated skills. It then builds the stack, the combination that fills the available hours by value per hour of the window, so the same-day play keeps its eight hours and the big-capacity plays fill the rest.

**What the agent does.** Claude reads the ranked stack through tools and turns it into the next 24 hours in order, with a time on each line, the legal steps sequenced by when they unblock money, the one number to check tomorrow, and the result that means change course. It also screens anything the person proposes against the charter. Every tool is read-only: the agent cannot log income, spend money, sign up for anything or contact anyone. The person does those things; the agent says which, and when.

**What it will never recommend.** Fraud or deception of any kind. Gambling. Multi-level marketing. Work that needs a licence the person does not hold. Hiding income or being paid off the books. Moving money for strangers or lending. Harvesting personal data or selling accounts. Writing students' work for them. Pirated or trademark-infringing goods. Anything that endangers anyone. Anything that starts with a loan. The full list, with reasons, is printed at the end of every plan, and `screenActivity` enforces it before the model ever sees a proposal.

**Honest limits.** The hourly bands are realistic ranges, not promises; the first week's number depends on the person showing up. The compliance notes are what a careful person would verify, not legal advice, and New Jersey municipalities differ; the plan names the clerk, the Division of Taxation and the Division of Consumer Affairs because those are where the answer lives. The agent plans and tracks; it does not earn. Nothing here can.

---

## Reference operators

`data/references.json` holds the accounts LITIX benchmarks against, keyed by niche, each with the specific mechanic it proves — not the personality, the transferable move.

**It is a seed, not a fixed list.** Edit it, or point at your own with `--references path/to/file.json`. The accounts you actually compete with are more useful than the ones shipped here. Handles that no longer resolve are skipped with a warning rather than failing the run.

---

## Quota

The Data API allows 10,000 units per project per day. A 200-upload sweep costs about 9 — LITIX walks the uploads playlist rather than calling `search.list`, which alone would cost 100 per call. Responses are cached on disk for 12 hours, so iterating on assumptions costs nothing.

```bash
npx litix quota 500     # what a 500-upload sweep will cost
```

---

## Library use

Every stage is importable on its own:

```typescript
import {
  YouTubeDataApi, buildChannelProfile, buildAudienceModel, rankPlays,
} from "litix";

const api = new YouTubeDataApi({ apiKey: process.env.YOUTUBE_API_KEY! });
const dataset = await api.sweepChannel("@SomeChannel", { maxVideos: 150 });

const profile = buildChannelProfile(dataset);
const audience = buildAudienceModel(profile, dataset);
const plays = rankPlays(profile, audience, {
  operator: { skills: ["welding"], hoursPerWeek: 12, startingCapitalUsd: 500, ownedListSize: 0 },
});

console.log(plays[0].archetype.name, plays[0].projection.scenarios.base.netMonthlyRevenue);
```

Everything from ingestion through ranking is deterministic and unit-tested. Only the advisor layer calls a model, and it is handed the computed figures rather than asked to estimate them.

---

## Development

```bash
npm test          # deterministic math, catalogue integrity, the charter and the ledger
npm run typecheck
npm run build
```

---

## Honest limits

- **Projections are modelled ranges, not forecasts.** The conversion bands come from published creator-commerce norms. Replace them with your own numbers as soon as you have any — the model is built to be argued with.
- **Monthly view volume is estimated** from how much recent uploads have accumulated, because the Data API only exposes lifetime views per video. Run with `--owner` and it is replaced with measured data.
- **Hook lift is observational**, not experimental. It is a split on one channel's back catalogue, not a controlled test, and is labelled with a confidence level that never reaches "high" on a small sample.
- **Niche classification is keyword-based.** It reports its own confidence; check it before trusting the commercial-intent figure that follows from it.
- **Uploads too young to have settled are excluded** from baselines and reported separately, rather than being scored on partial data.

## Licence

MIT.
