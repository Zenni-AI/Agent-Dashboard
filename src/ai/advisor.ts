import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type {
  AdvisorOutput,
  AudienceModel,
  BenchmarkReport,
  ChannelProfile,
  OperatorProfile,
  Play,
} from "../types.js";
import { log } from "../util/logger.js";
import { ADVISOR_SYSTEM_PROMPT, buildChannelBrief } from "./prompts.js";

const VideoIdeaSchema = z.object({
  title: z.string().describe("An exact video title using packaging that measurably works on this channel."),
  hook: z.string().describe("The first two spoken lines, verbatim."),
  angle: z.string().describe("Why this video moves the viewer toward the offer."),
});

const RecommendationSchema = z.object({
  title: z.string().describe("Short name for the play."),
  archetypeId: z.string().describe("The exact archetypeId from the ranked plays."),
  offer: z.string().describe("The specific offer: what it is, what it includes, who it is for."),
  whyThisChannel: z.string().describe("The evidence from this channel's own data that supports it."),
  pricing: z.string().describe("Price point and the reasoning, referencing the projected figures."),
  firstThreeVideos: z.array(VideoIdeaSchema).describe("Three videos that set the offer up."),
  first30Days: z.array(z.string()).describe("Ordered, concrete actions for the first 30 days."),
  successMetric: z.string().describe("The one number that says this is working."),
  killCriteria: z.string().describe("The specific result, by a specific date, that means stop."),
});

const AdvisorOutputSchema = z.object({
  positioning: z.string().describe("What this channel is actually selling, in one paragraph."),
  contentVerdict: z.array(z.string()).describe("What is working and what to change, grounded in the measured patterns."),
  recommendations: z.array(RecommendationSchema).describe("Three plays in execution order."),
  risks: z.array(z.string()).describe("What would make this plan fail."),
});

export interface AdvisorOptions {
  apiKey: string;
  model?: string;
  profile: ChannelProfile;
  audience: AudienceModel;
  plays: Play[];
  benchmark?: BenchmarkReport;
  operator?: OperatorProfile;
}

export class AdvisorRefusalError extends Error {
  constructor(readonly category: string | undefined, explanation?: string) {
    super(
      `The model declined to answer${category ? ` (${category})` : ""}${explanation ? `: ${explanation}` : ""}.`,
    );
    this.name = "AdvisorRefusalError";
  }
}

/**
 * Turn the computed brief into shippable plays.
 *
 * Structured output is used rather than free text so the result slots straight
 * into the report and can be diffed between runs. Adaptive thinking is on
 * because the useful judgement here — sequencing three offers against a real
 * constraint set — is exactly the kind of work that benefits from it.
 */
export async function generateAdvice(options: AdvisorOptions): Promise<AdvisorOutput> {
  const client = new Anthropic({ apiKey: options.apiKey });
  const brief = buildChannelBrief(options);

  log.info(`asking ${options.model ?? "claude-opus-5"} for the strategy read…`);

  const response = await client.messages.parse({
    model: options.model ?? "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: zodOutputFormat(AdvisorOutputSchema),
    },
    system: [
      {
        type: "text",
        text: ADVISOR_SYSTEM_PROMPT,
        // The system prompt is frozen across runs; only the brief varies.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: brief }],
  });

  if (response.stop_reason === "refusal") {
    const details = response.stop_details;
    throw new AdvisorRefusalError(
      details?.type === "refusal" ? details.category ?? undefined : undefined,
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error(
      "The model returned a response that did not match the expected schema. Re-run, or use --no-advise for the computed report alone.",
    );
  }

  return parsed satisfies AdvisorOutput;
}
