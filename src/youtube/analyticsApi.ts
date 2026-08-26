import type {
  OwnerChannelMetrics,
  OwnerVideoMetrics,
  RetentionCurve,
  TrafficSourceShare,
} from "../types.js";
import { log } from "../util/logger.js";
import type { YouTubeOAuth } from "./oauth.js";

const REPORTS_ENDPOINT = "https://youtubeanalytics.googleapis.com/v2/reports";

/**
 * Client for the YouTube Analytics API v2.
 *
 * Everything here is owner-only: retention curves, impressions and traffic
 * sources exist for channels you have authorised and for nobody else. That
 * asymmetry is deliberate on YouTube's side and it shapes LITIX — competitor
 * analysis is limited to public signals, and the deep read is reserved for the
 * operator's own channel.
 */
export class YouTubeAnalyticsApi {
  constructor(private readonly oauth: YouTubeOAuth) {}

  private async query(params: Record<string, string>): Promise<ReportResponse> {
    const token = await this.oauth.getAccessToken();
    const url = new URL(REPORTS_ENDPOINT);
    url.searchParams.set("ids", "channel==MINE");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `YouTube Analytics query failed (${response.status}): ${text.slice(0, 300)}`,
      );
    }

    return (await response.json()) as ReportResponse;
  }

  /** Channel totals for a date window, plus the traffic-source split. */
  async getChannelMetrics(
    startDate: string,
    endDate: string,
  ): Promise<OwnerChannelMetrics> {
    const totals = await this.query({
      startDate,
      endDate,
      metrics:
        "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost",
    });

    const row = totals.rows?.[0] ?? [];
    const pick = (name: string) => numberAt(totals, row, name);

    const metrics: OwnerChannelMetrics = {
      periodStart: startDate,
      periodEnd: endDate,
      views: pick("views"),
      estimatedMinutesWatched: pick("estimatedMinutesWatched"),
      averageViewDurationSeconds: pick("averageViewDuration"),
      subscribersGained: pick("subscribersGained"),
      subscribersLost: pick("subscribersLost"),
    };

    try {
      metrics.trafficSources = await this.getTrafficSources(startDate, endDate);
    } catch (error) {
      log.debug(`traffic source report unavailable: ${(error as Error).message}`);
    }

    return metrics;
  }

  async getTrafficSources(
    startDate: string,
    endDate: string,
  ): Promise<TrafficSourceShare[]> {
    const report = await this.query({
      startDate,
      endDate,
      metrics: "views",
      dimensions: "insightTrafficSourceType",
      sort: "-views",
    });

    const rows = report.rows ?? [];
    const total = rows.reduce((acc, row) => acc + Number(row[1] ?? 0), 0);
    return rows.map((row) => ({
      source: String(row[0] ?? "UNKNOWN"),
      views: Number(row[1] ?? 0),
      share: total > 0 ? Number(row[1] ?? 0) / total : 0,
    }));
  }

  /**
   * Per-video owner metrics. The `video==` filter accepts up to 200 IDs per
   * call, so requests are chunked.
   */
  async getVideoMetrics(
    videoIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<OwnerVideoMetrics[]> {
    const results: OwnerVideoMetrics[] = [];

    for (let i = 0; i < videoIds.length; i += 200) {
      const batch = videoIds.slice(i, i + 200);
      let report: ReportResponse;
      try {
        report = await this.query({
          startDate,
          endDate,
          metrics:
            "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained",
          dimensions: "video",
          filters: `video==${batch.join(",")}`,
          maxResults: "200",
        });
      } catch (error) {
        log.warn(`per-video metrics batch failed: ${(error as Error).message}`);
        continue;
      }

      for (const row of report.rows ?? []) {
        const videoId = String(row[0] ?? "");
        if (!videoId) continue;
        results.push({
          videoId,
          estimatedMinutesWatched: numberAt(report, row, "estimatedMinutesWatched"),
          averageViewDurationSeconds: numberAt(report, row, "averageViewDuration"),
          averageViewPercentage: numberAt(report, row, "averageViewPercentage"),
          subscribersGained: numberAt(report, row, "subscribersGained"),
        });
      }
    }

    // Impressions and CTR live in a separate report that is not available to
    // every channel; merge them opportunistically.
    await this.mergeImpressions(results, startDate, endDate);
    return results;
  }

  private async mergeImpressions(
    metrics: OwnerVideoMetrics[],
    startDate: string,
    endDate: string,
  ): Promise<void> {
    if (metrics.length === 0) return;
    const ids = metrics.map((m) => m.videoId).slice(0, 200);
    try {
      const report = await this.query({
        startDate,
        endDate,
        metrics: "impressions,impressionClickThroughRate",
        dimensions: "video",
        filters: `video==${ids.join(",")}`,
        maxResults: "200",
      });
      const byId = new Map(metrics.map((m) => [m.videoId, m]));
      for (const row of report.rows ?? []) {
        const target = byId.get(String(row[0] ?? ""));
        if (!target) continue;
        target.impressions = numberAt(report, row, "impressions");
        target.impressionClickThroughRate = numberAt(
          report,
          row,
          "impressionClickThroughRate",
        );
      }
    } catch (error) {
      log.debug(`impressions report unavailable: ${(error as Error).message}`);
    }
  }

  /**
   * The retention curve for one video: what share of the starting audience is
   * still watching at each point through it. This is the single most valuable
   * signal on the platform and the reason owner authorisation is worth having.
   */
  async getRetentionCurve(
    videoId: string,
    startDate: string,
    endDate: string,
  ): Promise<RetentionCurve | null> {
    try {
      const report = await this.query({
        startDate,
        endDate,
        metrics: "audienceWatchRatio,relativeRetentionPerformance",
        dimensions: "elapsedVideoTimeRatio",
        filters: `video==${videoId};audienceType==ORGANIC`,
      });

      const points = (report.rows ?? [])
        .map((row) => ({
          elapsedVideoTimeRatio: Number(row[0] ?? 0),
          audienceWatchRatio: Number(row[1] ?? 0),
          relativeRetentionPerformance: row[2] === undefined ? undefined : Number(row[2]),
        }))
        .sort((a, b) => a.elapsedVideoTimeRatio - b.elapsedVideoTimeRatio);

      if (points.length === 0) return null;
      return { videoId, points };
    } catch (error) {
      log.debug(`retention curve for ${videoId} unavailable: ${(error as Error).message}`);
      return null;
    }
  }

  /** Retention curves for several videos, fetched serially to respect rate limits. */
  async getRetentionCurves(
    videoIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<RetentionCurve[]> {
    const curves: RetentionCurve[] = [];
    for (const videoId of videoIds) {
      const curve = await this.getRetentionCurve(videoId, startDate, endDate);
      if (curve) curves.push(curve);
    }
    return curves;
  }
}

interface ReportResponse {
  columnHeaders?: { name: string; dataType?: string; columnType?: string }[];
  rows?: (string | number)[][];
}

/** Read a metric by column name rather than by position, which YouTube may reorder. */
function numberAt(
  report: ReportResponse,
  row: (string | number)[] | undefined,
  columnName: string,
): number | undefined {
  if (!row) return undefined;
  const index = report.columnHeaders?.findIndex((h) => h.name === columnName) ?? -1;
  if (index < 0) return undefined;
  const value = Number(row[index]);
  return Number.isFinite(value) ? value : undefined;
}

/** `YYYY-MM-DD`, the only date format the Analytics API accepts. */
export function toAnalyticsDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function analyticsWindow(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  return { startDate: toAnalyticsDate(start), endDate: toAnalyticsDate(end) };
}
