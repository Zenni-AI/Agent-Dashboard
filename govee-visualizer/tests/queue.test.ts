import { describe, expect, it } from 'vitest';
import { JobFailure, JobQueue, QueueFullError } from '../src/queue.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('JobQueue', () => {
  it('runs 100 jobs without ever exceeding the concurrency cap', async () => {
    let inFlight = 0;
    let peak = 0;
    const q = new JobQueue<number, number>(
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await sleep(5 + (n % 7));
        inFlight--;
        return n * 2;
      },
      { concurrency: 8, maxQueued: 1000 },
    );
    const jobs = Array.from({ length: 100 }, (_, i) => q.enqueue(i));
    await q.onIdle();
    expect(peak).toBe(8);
    for (const [i, job] of jobs.entries()) {
      const done = q.get(job.id)!;
      expect(done.status).toBe('done');
      expect(done.result).toBe(i * 2);
    }
    q.close();
  });

  it('reports place in line and rejects when the queue is full', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = new JobQueue<number, number>(async (n) => (await gate, n), { concurrency: 1, maxQueued: 2 });
    const a = q.enqueue(1);
    const b = q.enqueue(2);
    const c = q.enqueue(3);
    expect(q.get(a.id)!.position).toBe(0);
    expect(q.get(b.id)!.position).toBe(1);
    expect(q.get(c.id)!.position).toBe(2);
    expect(() => q.enqueue(4)).toThrow(QueueFullError);
    release();
    await q.onIdle();
    expect(q.get(c.id)!.status).toBe('done');
    q.close();
  });

  it('surfaces JobFailure codes and hides unexpected errors', async () => {
    const q = new JobQueue<string, void>(
      async (kind) => {
        if (kind === 'known') throw new JobFailure('no_street_view', 'Upload a photo');
        throw new Error('secret internal detail');
      },
      { concurrency: 2, maxQueued: 10 },
    );
    const known = q.enqueue('known');
    const unknown = q.enqueue('unknown');
    const origError = console.error;
    console.error = () => {};
    await q.onIdle();
    console.error = origError;
    expect(q.get(known.id)!.error).toEqual({ code: 'no_street_view', message: 'Upload a photo' });
    expect(q.get(unknown.id)!.error!.code).toBe('internal');
    expect(q.get(unknown.id)!.error!.message).not.toContain('secret');
    q.close();
  });
});

describe('JobQueue priority', () => {
  it('runs priority jobs before normal ones, each group in arrival order', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = new JobQueue<string, void>(
      async (name) => {
        if (name === 'blocker') await gate;
        order.push(name);
      },
      { concurrency: 1, maxQueued: 100 },
    );
    q.enqueue('blocker');
    const a2 = q.enqueue('a2');
    q.enqueue('b2');
    q.enqueue('a1', { priority: true });
    const b1 = q.enqueue('b1', { priority: true });
    expect(q.get(b1.id)!.position).toBe(2);
    expect(q.get(a2.id)!.position).toBe(3);
    release();
    await q.onIdle();
    expect(order).toEqual(['blocker', 'a1', 'b1', 'a2', 'b2']);
    q.close();
  });
});
