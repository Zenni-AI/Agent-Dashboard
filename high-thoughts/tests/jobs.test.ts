import { describe, expect, it } from "vitest";
import { JobStore, newJobId } from "../src/jobs.js";
import type { StreamEvent } from "../src/types.js";

async function* emit(...events: StreamEvent[]): AsyncGenerator<StreamEvent> {
  for (const event of events) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    yield event;
  }
}

async function drain(iterator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of iterator) out.push(event);
  return out;
}

describe("JobStore", () => {
  it("runs to completion with nobody subscribed, then replays the whole thing", async () => {
    const store = new JobStore();
    const id = newJobId();

    store.start(id, () => emit({ type: "text", text: "a" }, { type: "text", text: "b" }));

    // Nothing is listening while it runs — the point of a job.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(store.get(id)?.status).toBe("done");

    const replayed = await drain(store.subscribe(id));
    expect(replayed).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
  });

  it("gives a mid-flight subscriber everything so far and then the rest", async () => {
    const store = new JobStore();
    const id = newJobId();

    store.start(id, () =>
      emit(
        { type: "text", text: "one" },
        { type: "text", text: "two" },
        { type: "done", stopReason: "end_turn", outputTokens: 1 },
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    const events = await drain(store.subscribe(id));

    expect(events.filter((event) => event.type === "text")).toHaveLength(2);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("serves two subscribers the same complete stream", async () => {
    const store = new JobStore();
    const id = newJobId();
    store.start(id, () => emit({ type: "text", text: "x" }, { type: "text", text: "y" }));

    const [first, second] = await Promise.all([
      drain(store.subscribe(id)),
      drain(store.subscribe(id)),
    ]);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
  });

  it("marks a job failed when the generator emits an error", async () => {
    const store = new JobStore();
    const id = newJobId();
    store.start(id, () => emit({ type: "error", message: "no", retryable: true }));

    await drain(store.subscribe(id));
    expect(store.get(id)?.status).toBe("failed");
  });

  it("turns a thrown generator into an error event rather than an unhandled rejection", async () => {
    const store = new JobStore();
    const id = newJobId();

    store.start(id, async function* () {
      yield { type: "text", text: "partial" } as StreamEvent;
      throw new Error("boom");
    });

    const events = await drain(store.subscribe(id));
    expect(events[0]).toEqual({ type: "text", text: "partial" });
    expect(events.at(-1)?.type).toBe("error");
    expect(store.get(id)?.status).toBe("failed");
  });

  it("ends a subscription when its signal aborts", async () => {
    const store = new JobStore();
    const id = newJobId();
    const abort = new AbortController();

    store.start(id, async function* () {
      yield { type: "text", text: "first" } as StreamEvent;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    const iterator = store.subscribe(id, abort.signal);
    const collected: StreamEvent[] = [];

    const pump = (async () => {
      for await (const event of iterator) collected.push(event);
    })();

    await new Promise((resolve) => setTimeout(resolve, 10));
    abort.abort();
    await pump;

    expect(collected).toEqual([{ type: "text", text: "first" }]);
    // The job itself is untouched — that is the whole point.
    expect(store.get(id)?.status).toBe("running");
  });

  it("returns nothing for an unknown job", async () => {
    expect(await drain(new JobStore().subscribe("nope"))).toEqual([]);
  });

  it("sweeps finished jobs past their TTL but never a running one", async () => {
    const store = new JobStore(0);
    for (let i = 0; i < 21; i += 1) {
      store.start(`done-${i}`, () => emit({ type: "text", text: "x" }));
    }
    await new Promise((resolve) => setTimeout(resolve, 60));

    const running = newJobId();
    store.start(running, async function* () {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      yield { type: "text", text: "late" } as StreamEvent;
    });

    // The 20th start triggers a sweep; the running job must survive it.
    for (let i = 0; i < 20; i += 1) {
      store.start(`more-${i}`, () => emit({ type: "text", text: "x" }));
    }
    expect(store.get(running)?.status).toBe("running");
  });
});
