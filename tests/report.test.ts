import { describe, expect, it } from "vitest";
import { buildChannelProfile } from "../src/analysis/profile.js";
import { buildAudienceModel } from "../src/monetize/audience.js";
import { rankPlays } from "../src/monetize/plays.js";
import { renderMarkdownReport } from "../src/report/markdown.js";
import type { ChannelDataset, LitixReport } from "../src/types.js";
import { channel, video, videos } from "./helpers.js";

function buildReport(overrides: Partial<ChannelDataset> = {}): LitixReport {
  const data: ChannelDataset = {
    channel: channel({ description: "pressure washing softwash roof cleaning" }),
    videos: [
      ...videos(20, [20_000], { durationSeconds: 600, ageDays: 90 }),
      ...videos(10, [80_000], { durationSeconds: 40, ageDays: 60 }),
    ],
    ...overrides,
  };
  const profile = buildChannelProfile(data);
  const audience = buildAudienceModel(profile, data);
  return {
    generatedAt: new Date().toISOString(),
    profile,
    audience,
    plays: rankPlays(profile, audience),
  };
}

describe("renderMarkdownReport", () => {
  it("renders the full structure without an advisor section", () => {
    const markdown = renderMarkdownReport(buildReport());

    expect(markdown).toContain("# LITIX — Test Channel");
    expect(markdown).toContain("## The short version");
    expect(markdown).toContain("## What the data says");
    expect(markdown).toContain("## Format performance");
    expect(markdown).toContain("## What the audience is actually worth");
    expect(markdown).toContain("## Ranked plays");
    expect(markdown).not.toContain("## Strategy");
  });

  it("includes the advisor section when advice is present", () => {
    const report = buildReport();
    report.advisor = {
      positioning: "A local exterior cleaning operator teaching the trade.",
      contentVerdict: ["Shorts carry reach; long-form carries trust."],
      recommendations: [
        {
          title: "Pricing playbook",
          archetypeId: "operator-playbook",
          offer: "A $897 pricing and quoting system for residential softwash.",
          whyThisChannel: "Job walkthroughs already show real numbers.",
          pricing: "$897, in line with the base projection.",
          firstThreeVideos: [
            { title: "How I quote a $4,000 roof wash", hook: "This roof took two hours.", angle: "Shows the method the product systematises." },
          ],
          first30Days: ["Pre-sell to the email list.", "Record module one."],
          successMetric: "20 pre-sales before recording.",
          killCriteria: "Fewer than 5 pre-sales in 14 days.",
        },
      ],
      risks: ["Audience may want the service, not the system."],
    };

    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("## Strategy");
    expect(markdown).toContain("Pricing playbook");
    expect(markdown).toContain("**Kill criteria.**");
    expect(markdown).toContain("How I quote a $4,000 roof wash");
  });

  it("escapes pipes so a title cannot break the table", () => {
    const report = buildReport({
      channel: channel({ description: "pressure washing softwash" }),
      videos: [
        ...videos(10, [1000], { durationSeconds: 600, ageDays: 90 }),
        video({
          videoId: "pipe",
          title: "Before | After",
          views: 50_000,
          durationSeconds: 600,
          ageDays: 90,
        }),
      ],
    });
    const markdown = renderMarkdownReport(report);
    expect(markdown).toContain("Before \\| After");
  });

  it("always states that the projections are modelled ranges", () => {
    expect(renderMarkdownReport(buildReport())).toContain("modelled ranges, not forecasts");
  });
});
