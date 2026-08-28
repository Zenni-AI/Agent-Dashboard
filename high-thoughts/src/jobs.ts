import type { StreamEvent } from "./types.js";

/**
 * Background jobs for work that outlives the connection that started it.
 *
 * A textbook takes minutes, and the phone will lock, the browser will suspend
 * the tab, and the person will wander off. So generation is decoupled from any
 * one socket: the job runs to completion regardless, accumulating its events,
 * and a client may attach, drop, and re-attach — receiving everything produced
 * so far, then the rest live.
 *
 * In-memory and per-process, which is the honest scope for a single server. A
 * restart loses in-flight jobs; the client re-requests and pays again in time,
 * not money, because nothing was written down.
 */
export type JobStatus = "running" | "done" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  /** Everything emitted so far, in order. Replayed to a late subscriber. */
  events: StreamEvent[];
  createdAt: number;
  finishedAt?: number;
}

interface Waiter {
  resolve: () => void;
}

const TTL_MS = 60 * 60 * 1000;
const SWEEP_EVERY = 20;

export class JobStore {
  private readonly jobs = new Map<string, { job: Job; waiters: Waiter[] }>();
  private started = 0;

  constructor(private readonly ttlMs = TTL_MS) {}

  /**
   * Start a generator running in the background and return its job id
   * immediately. The generator is fully drained even if nobody ever subscribes.
   */
  start(
    id: string,
    produce: () => AsyncGenerator<StreamEvent>,
    onSettled?: (status: JobStatus) => void | Promise<void>,
  ): Job {
    const job: Job = { id, status: "running", events: [], createdAt: Date.now() };
    const entry = { job, waiters: [] as Waiter[] };
    this.jobs.set(id, entry);

    if (++this.started % SWEEP_EVERY === 0) this.sweep();

    void (async () => {
      try {
        for await (const event of produce()) {
          job.events.push(event);
          if (event.type === "error") job.status = "failed";
          this.wake(entry);
        }
      } catch (error) {
        job.events.push({
          type: "error",
          message: "That stopped partway through. Your thought is safe — try again.",
          retryable: true,
        });
        job.status = "failed";
        console.error(`job ${id} threw:`, error);
      } finally {
        if (job.status === "running") job.status = "done";
        job.finishedAt = Date.now();
        this.wake(entry);

        // Runs whatever the outcome, so a failed book can hand its credit back.
        try {
          await onSettled?.(job.status);
        } catch (error) {
          console.error(`job ${id} settle hook threw:`, error);
        }
      }
    })();

    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id)?.job;
  }

  /**
   * Every event from the beginning, then each new one as it arrives, ending
   * when the job does. Safe to call at any point in a job's life, including
   * after it has finished — a late subscriber simply gets the whole thing.
   */
  async *subscribe(id: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const entry = this.jobs.get(id);
    if (!entry) return;

    let cursor = 0;
    while (!signal?.aborted) {
      while (cursor < entry.job.events.length) {
        yield entry.job.events[cursor]!;
        cursor += 1;
      }

      if (entry.job.status !== "running") return;

      await new Promise<void>((resolve) => {
        const waiter: Waiter = { resolve };
        entry.waiters.push(waiter);
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  }

  private wake(entry: { waiters: Waiter[] }): void {
    const waiting = entry.waiters.splice(0);
    for (const waiter of waiting) waiter.resolve();
  }

  /** Drop finished jobs past their TTL. A running job is never swept. */
  private sweep(now = Date.now()): void {
    for (const [id, entry] of this.jobs) {
      const { job } = entry;
      if (job.status === "running") continue;
      if (now - (job.finishedAt ?? job.createdAt) > this.ttlMs) this.jobs.delete(id);
    }
  }

  get size(): number {
    return this.jobs.size;
  }
}

export function newJobId(): string {
  return `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
