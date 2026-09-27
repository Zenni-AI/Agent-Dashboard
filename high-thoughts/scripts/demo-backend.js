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

const DEMO_BRIEF = {
  title: "Reverse Tuesday",
  building: "A city bus line that runs its route backwards one day a week, unannounced.",
  goingWith: ["One line only, not the whole network", "Unannounced — no signage", "Normal fare"],
  ruledOut: ["Buses driving physically in reverse", "Telling riders in advance"],
  stillOpen: ["Whether the drivers are told", "What the timetable app does with it"],
  needToLearn: ["How GTFS feeds are structured", "How a route change gets approved locally", "Transit network topology"],
  searchConcepts: ["GTFS specification", "bus network redesign"],
  looksLikeSeveral: false,
  separateIdeas: [],
};

const DEMO_BOOK = `# Reverse Tuesday

## What you're actually building
One bus line that runs its stop sequence backwards, one day a week, with no announcement. Same stops, same fare, same drivers.

You've ruled out the physical-reverse version and ruled out warning people. What's left is a scheduling change with a social effect.

## How it actually works
A bus route is a **directed sequence of stops** published in a GTFS feed — General Transit Feed Specification, the open format Google Maps, Transit, Citymapper and every other trip planner consume [1]. The route lives in \`routes.txt\`; the ordering lives in \`stop_times.txt\` as a \`stop_sequence\` column.

Reversing a route is editing that column for one service day. **No infrastructure changes. No new vehicles.** Most agencies already run each route in both directions — what you're changing is which direction is served at which time.

The hard part is entirely institutional: a schedule is a published commitment, and someone has to sign off on breaking it.

## Who has done this
No agency has done exactly this. Three neighbours:

- **Bus network redesigns** — Houston rewrote its entire bus network overnight in 2015, and several cities have followed [2]. Precedent that a system-wide change *can* be executed at once.
- **Transit as artwork** — a long tradition, though usually additive (a decorated carriage) rather than subtractive.
- **Unplanned reversals** — diversions during roadworks reverse sequences routinely, and agencies have operational data on what happens. **That data is your best evidence and nobody has looked at it for this.**

## What you need to know first
Each depends only on the ones above it.

1. **The GTFS specification** — how a feed encodes routes, trips and stop sequences. Start with the official reference, which is short and readable [1]. An afternoon.
2. **Reading a real feed** — most agencies publish openly; TransitFeeds and Mobility Database index them by city [3]. Open yours in Python with \`gtfs-kit\`, or just a spreadsheet.
3. **How transit networks are shaped** — why routes run where they do, and what a reversal costs riders. Jarrett Walker's *Human Transit* is the standard text and is written for non-planners [2].
4. **How a service change gets approved where you live** — every agency has a public process, usually with a required comment period. Your local agency's board minutes are public and will tell you the real timeline.

**No physical hazard here** — this is a data and policy project. The risk is to other people's time, and the mitigation is the comment period in step 4.

## The numbers
| Item | Figure |
| --- | --- |
| Stops on a typical urban route | 30–45 |
| Lead time for a published schedule change | 8–12 weeks |
| Cost of the data change itself | Effectively zero |
| Riders affected on a mid-size urban route | 2,000–8,000 per day |

That last row is the real number in this project.

## What kills it
**The trip planner.** Riders trust the app over the sign. If your reversed feed doesn't propagate, the app confidently sends people to a stop the bus reaches ninety minutes later, and the piece reads as a malfunction rather than an intervention.

Test it before anything else: push a modified feed to a local OpenTripPlanner instance and see what it plans.

## The first weekend
Download your city's GTFS feed. Open \`stop_times.txt\`, pick the route you know best, reverse \`stop_sequence\` for one service day, and render the before and after on a map.

**Two hours.** At the end you have an image, which is the only thing that will get you a meeting.

## Still open
You haven't decided whether the drivers are told. That's not a detail — it's the whole ethics of the piece. If they know, it's a performance with informed participants. If they don't, you've made them the instrument.

Worth settling before you show anyone the map.

## Sources
1. GTFS Reference — https://gtfs.org/documentation/schedule/reference/
2. Human Transit, Jarrett Walker — https://humantransit.org/
3. Mobility Database — https://mobilitydatabase.org/`;

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

  if (url.includes("/api/brief")) {
    await sleep(1400);
    return json({ brief: DEMO_BRIEF });
  }

  if (url.match(/\/api\/textbook\/./)) {
    return sse(
      streamOf(
        [
          { type: "start", mode: "textbook", model: "demo" },
          { type: "status", text: "checking whether any agency has actually tried this" },
        ],
        DEMO_BOOK,
        {
          lead: 2200,
          sources: [
            { title: "GTFS Reference — gtfs.org", url: "https://gtfs.org/" },
            { title: "Human Transit — Jarrett Walker", url: "https://humantransit.org/" },
            { title: "Mobility Database", url: "https://mobilitydatabase.org/" },
          ],
        },
      ),
    );
  }

  if (url.includes("/api/textbook")) return json({ id: `demo_${Date.now()}` }, 202);

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
