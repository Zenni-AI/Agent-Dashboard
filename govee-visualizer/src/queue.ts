import { randomUUID } from 'node:crypto';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobError {
  code: string;
  message: string;
}

export interface Job<I, R> {
  id: string;
  status: JobStatus;
  /** Free-form progress label set by the worker, e.g. "locating", "rendering". */
  stage: string;
  input: I;
  result?: R;
  error?: JobError;
  createdAt: number;
  updatedAt: number;
}

export type Worker<I, R> = (input: I, setStage: (stage: string) => void) => Promise<R>;

export class QueueFullError extends Error {
  constructor() {
    super('Too many people are generating previews right now. Please try again in a minute.');
  }
}

/** Errors a worker throws with a user-facing message and a machine code the frontend can branch on. */
export class JobFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface QueueOptions {
  concurrency: number;
  maxQueued: number;
  /** Finished jobs are forgotten after this long. */
  retainMs?: number;
  onSettled?: (job: Job<unknown, unknown>) => void;
}

/**
 * In-process job queue with a hard concurrency cap.
 *
 * Image generation is I/O bound (we wait on Google / the AI provider), so a single Node process can hold
 * hundreds of visitors at once. What has to be bounded is how many requests we fire at the AI provider
 * simultaneously, so we stay under its rate limit instead of collecting 429s. Everyone else waits in
 * FIFO order and the frontend shows their place in line.
 */
export class JobQueue<I, R> {
  private readonly jobs = new Map<string, Job<I, R>>();
  private readonly pending: string[] = [];
  /** Priority jobs sit at the front of `pending`; this many of them are there. */
  private priorityCount = 0;
  private running = 0;
  private readonly retainMs: number;
  private readonly sweeper: NodeJS.Timeout;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly worker: Worker<I, R>,
    private readonly opts: QueueOptions,
  ) {
    this.retainMs = opts.retainMs ?? 60 * 60 * 1000;
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  /** `priority` jobs go ahead of normal ones (still first-come-first-served among themselves). */
  enqueue(input: I, { priority = false } = {}): Job<I, R> {
    if (this.pending.length >= this.opts.maxQueued) throw new QueueFullError();
    const now = Date.now();
    const job: Job<I, R> = { id: randomUUID(), status: 'queued', stage: 'queued', input, createdAt: now, updatedAt: now };
    this.jobs.set(job.id, job);
    if (priority) this.pending.splice(this.priorityCount++, 0, job.id);
    else this.pending.push(job.id);
    this.pump();
    return job;
  }

  get(id: string): (Job<I, R> & { position: number }) | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    // 1-based place in line; 0 once the job has started.
    const position = job.status === 'queued' ? this.pending.indexOf(id) + 1 : 0;
    return { ...job, position };
  }

  stats() {
    return { running: this.running, queued: this.pending.length, concurrency: this.opts.concurrency };
  }

  /** Resolves once nothing is running or queued. Used for graceful shutdown and tests. */
  onIdle(): Promise<void> {
    if (this.running === 0 && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  close() {
    clearInterval(this.sweeper);
  }

  private pump() {
    while (this.running < this.opts.concurrency && this.pending.length > 0) {
      const id = this.pending.shift()!;
      if (this.priorityCount > 0) this.priorityCount--;
      const job = this.jobs.get(id);
      if (!job) continue;
      this.running++;
      void this.run(job).finally(() => {
        this.running--;
        this.pump();
        if (this.running === 0 && this.pending.length === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          waiters.forEach((w) => w());
        }
      });
    }
  }

  private async run(job: Job<I, R>) {
    job.status = 'running';
    job.stage = 'starting';
    job.updatedAt = Date.now();
    try {
      job.result = await this.worker(job.input, (stage) => {
        job.stage = stage;
        job.updatedAt = Date.now();
      });
      job.status = 'done';
      job.stage = 'done';
    } catch (err) {
      job.status = 'failed';
      job.stage = 'failed';
      job.error =
        err instanceof JobFailure
          ? { code: err.code, message: err.message }
          : { code: 'internal', message: 'Something went wrong generating your preview. Please try again.' };
      if (!(err instanceof JobFailure)) console.error(`[job ${job.id}]`, err);
    }
    job.updatedAt = Date.now();
    this.opts.onSettled?.(job as Job<unknown, unknown>);
  }

  private sweep() {
    const cutoff = Date.now() - this.retainMs;
    for (const [id, job] of this.jobs) {
      if ((job.status === 'done' || job.status === 'failed') && job.updatedAt < cutoff) this.jobs.delete(id);
    }
  }
}
