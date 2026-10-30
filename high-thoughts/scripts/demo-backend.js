/* ── Canned backend ────────────────────────────────────────────────────────
 *
 * Replaces the network for the demo. Everything below this block is the real
 * app, untouched. Answers are written out rather than generated, so what you
 * see is representative of the shape and length the prompts ask for — not of
 * what any particular model would actually say.
 */

const DEMO_MODES = [
  { id: "riff", label: "Riff", blurb: "Run with it. Further, weirder, sharper." },
  { id: "build", label: "Build", blurb: "What it'd actually take. First move included." },
  { id: "sober", label: "Sober", blurb: "The honest read. Bring it back here tomorrow." },
  { id: "deep", label: "Deep", blurb: "Follow it down. See where it lands." },
];

const DEMO_ANSWERS = {
  riff: `# Reverse Tuesday

## The idea
One bus line runs its whole route **backwards** every Tuesday. Same stops, same drivers, same fare — reversed order. A commute you could do asleep becomes somewhere you've never been.

## Take it further
1. **Unannounced.** No signage, no press release. People find out by ending up somewhere wrong and having to look up.
2. **The whole network.** Every Tuesday, printed in the timetable in normal type, as though it were ordinary.
3. **Reverse day is the cheap day.** Half fare, on the condition you accept you don't know where you're going.

## The weird one
The buses drive backwards. Actually in reverse, all day, forty minutes at a stretch. The driver faces the passengers the entire time. Nobody talks about it.

## Keep this bit
A route you know by heart is a place you have stopped looking at.`,

  build: `# Reverse Tuesday

## What it is
A scheduled weekly reversal of one bus route's stop sequence. For a transit agency with an appetite for press, or an artist with a sympathetic one.

## How it works
A route is a **directed sequence of stops** in a GTFS feed — the open format every timetable app reads. Reversing it is a data change, not an infrastructure one: no new shelters, no new vehicles, no roadworks. You publish a modified \`stop_times.txt\` for one service day.

The friction is entirely institutional. Someone signs off on the schedule, someone else answers the phones on Tuesday.

## The first move
Download your city's GTFS feed tonight — most publish it openly. Open \`stop_times.txt\`, pick one route, reverse the sequence for one day, and render both versions on a map. **Two hours.** You'll have a picture worth showing someone.

## What kills it
The timetable app. Riders trust their phone over the sign at the stop, and a feed that disagrees with reality reads as a bug, not as art. Test by pushing your modified feed to a local trip planner and seeing what it does.`,

  sober: `# Reverse Tuesday

## What you said
Run a bus route backwards one day a week so that a familiar commute becomes unfamiliar.

## Does this exist
Not as such. Transit agencies do **bus network redesigns** — occasionally rewriting a whole system overnight — and there's a tradition of transit-as-artwork. Nothing that reverses a route on a cycle. That's a genuine gap, though gaps in transit are usually gaps for a reason.

## The honest read
The idea is real and the sentence at the end of your first pass is better than the idea — *a route you know by heart is a place you have stopped looking at* — that's the thing worth keeping.

But you're proposing to make thousands of people's commutes worse, on purpose, without asking them. The people most affected are the ones with the least slack: shift workers, people making a connection, anyone who can't afford to be forty minutes late. Wonder is easy to fund when someone else absorbs the cost.

## Verdict
**Worth a night.** As a piece of writing, a short film, or a single sanctioned run on a Sunday route, it's genuinely good. As a policy it's dead, and no amount of iteration fixes who pays for it.`,

  deep: `# Reverse Tuesday

## The thought under the thought
You're not really asking about buses. You're asking whether familiarity is a form of blindness — and if it is, whether it can be deliberately broken from the outside.

## Follow it down
Repetition is how the brain buys efficiency. A route you've done four hundred times costs almost nothing to run, because you've stopped rendering it — you're not seeing the street, you're replaying it.

So the cost of competence is perception. Everything you get good at, you stop seeing.

Which means novelty isn't an indulgence, it's maintenance. And if you don't schedule it, the world quietly narrows to the parts you've automated.

But you can't surprise yourself on purpose — knowing the Tuesday is coming is exactly what defuses it. **The disruption has to come from outside your own decision.**

## Where it lands
A life you fully control is a life you'll stop being able to see. Some portion of your route has to be decided by something that isn't you.

## The uncomfortable part
Most of the people who have that — whose routes get reversed without their consent — did not choose it and would trade it back immediately for the boredom you're trying to escape.`,
};

/**
 * The interview, as it really ran. Three scripted paths keyed by what the
 * person types; anything else falls through to the generic one, so the demo
 * never dead-ends on an idea we did not anticipate.
 */
const DEMO_INTERVIEWS = [
  {
    match: /fly|car|hover|drone/i,
    creation: "flying-car",
    kind: "simulation",
    questions: [
      { question: "How does it get off the ground — what's actually pushing it up?",
        placeholder: "dunno, like four big drone propellers on the corners? maybe one on the roof" },
      { question: "How many bottles, and how are they arranged under the car?",
        placeholder: "idk like 60? in a big grid under the floor i guess" },
      { question: "When you want to go up, what drops the Mentos in — a lever, a button, something in the dashboard?",
        placeholder: "idk like a gumball machine thing on the roof with a string" },
    ],
  },
  {
    match: /app|alarm|phone|software|clock/i,
    creation: "alarm-clock",
    kind: "app",
    questions: [
      { question: "What does it argue about — what's its case for you staying asleep?",
        placeholder: "that nothing good has ever happened before 9am" },
      { question: "How do you know you've won?",
        placeholder: "it just goes quiet. no points, no streak, nothing" },
    ],
  },
  {
    match: /.*/,
    creation: "cereal-box",
    kind: "design",
    questions: [
      { question: "What's the first thing your eye lands on?",
        placeholder: "just a guy sitting down, honestly" },
      { question: "And what does the back of it say?",
        placeholder: "the nutrition facts but for feelings" },
    ],
  },
];

function interviewFor(thought) {
  return DEMO_INTERVIEWS.find((entry) => entry.match.test(thought)) ?? DEMO_INTERVIEWS.at(-1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Frame canned text as the SSE stream the app expects. */
function streamOf(events, text, { lead = 600, sources = [] } = {}) {
  const encoder = new TextEncoder();
  const frame = (event) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

  return new ReadableStream({
    async start(controller) {
      for (const event of events) controller.enqueue(frame(event));

      for (const [index, source] of sources.entries()) {
        await sleep(220 * (index + 1));
        controller.enqueue(frame({ type: "source", ...source }));
      }

      await sleep(lead);
      for (const chunk of text.match(/[\s\S]{1,10}/g) ?? []) {
        controller.enqueue(frame({ type: "text", text: chunk }));
        await sleep(6);
      }

      controller.enqueue(frame({ type: "done", stopReason: "end_turn", outputTokens: 0 }));
      controller.close();
    },
  });
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const sse = (stream) =>
  new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });

window.fetch = async (input, init = {}) => {
  const url = String(input);

  if (url.includes("/api/modes")) return json({ modes: DEMO_MODES });

  if (url.includes("/api/develop")) {
    const { mode } = JSON.parse(init.body ?? "{}");
    return sse(
      streamOf(
        [
          { type: "start", mode, model: "demo" },
          { type: "status", text: "looking for the version of this that isn't just a gimmick" },
        ],
        DEMO_ANSWERS[mode] ?? DEMO_ANSWERS.riff,
      ),
    );
  }

  if (url.includes("/api/interview")) {
    const { thought, answers = [] } = JSON.parse(init.body ?? "{}");
    const script = interviewFor(thought ?? "");
    await sleep(900);
    const next = script.questions[answers.length];
    return json(
      next
        ? { ...next, ready: false, understanding: "", buildKind: script.kind, asked: answers.length }
        : { ready: true, question: "", placeholder: "", understanding: "", buildKind: script.kind, asked: answers.length },
    );
  }

  if (url.includes("/api/creation/")) {
    const name = url.split("/api/creation/")[1].split("?")[0];
    const html = DEMO_CREATIONS[name] ?? DEMO_CREATIONS["cereal-box"];
    return sse(
      streamOf(
        [
          { type: "start", mode: "prototype", model: "demo" },
          { type: "status", text: "working out what to draw" },
        ],
        html,
        { lead: 1600 },
      ),
    );
  }

  if (url.includes("/api/creation")) {
    const { thought } = JSON.parse(init.body ?? "{}");
    await sleep(500);
    return json({ id: interviewFor(thought ?? "").creation, creditsLeft: 2 }, 202);
  }

  if (url.includes("/api/credits")) return json({ credits: 3, known: true });

  return json({ error: "Not in the demo." }, 404);
};

// No service worker in an artifact frame. The key has to stay present — the
// app feature-detects with `in` — so it is stubbed with a registration that
// rejects, which the app already handles by carrying on without an offline
// shell.
Object.defineProperty(navigator, "serviceWorker", {
  configurable: true,
  value: { register: () => Promise.reject(new Error("no service worker in the demo")) },
});
