/**
 * YouTube Data API quota accounting.
 *
 * Every project gets 10,000 units per day by default. `list` endpoints cost 1
 * unit regardless of how many items come back, which is why LITIX batches video
 * lookups 50 at a time — and why `search.list` at 100 units is avoided entirely
 * in favour of the uploads playlist.
 */
export const QUOTA_COST: Record<string, number> = {
  "channels.list": 1,
  "playlistItems.list": 1,
  "videos.list": 1,
  "search.list": 100,
};

export const DAILY_QUOTA_DEFAULT = 10_000;

export class QuotaTracker {
  private spent = 0;
  private readonly calls: Record<string, number> = {};

  record(endpoint: string): void {
    const cost = QUOTA_COST[endpoint] ?? 1;
    this.spent += cost;
    this.calls[endpoint] = (this.calls[endpoint] ?? 0) + 1;
  }

  get unitsSpent(): number {
    return this.spent;
  }

  get callCounts(): Readonly<Record<string, number>> {
    return this.calls;
  }

  get percentOfDailyQuota(): number {
    return this.spent / DAILY_QUOTA_DEFAULT;
  }

  /** Units a sweep of `videoCount` uploads will cost, before caching. */
  static estimateChannelSweep(videoCount: number): number {
    const pages = Math.ceil(videoCount / 50);
    return (
      QUOTA_COST["channels.list"]! +
      pages * QUOTA_COST["playlistItems.list"]! +
      pages * QUOTA_COST["videos.list"]!
    );
  }

  summary(): string {
    const parts = Object.entries(this.calls)
      .map(([endpoint, count]) => `${endpoint} x${count}`)
      .join(", ");
    return `${this.spent} units (${parts || "no calls"})`;
  }
}
