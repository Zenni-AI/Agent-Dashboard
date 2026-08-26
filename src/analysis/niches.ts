import type { ChannelSnapshot, NicheProfile, VideoRecord } from "../types.js";
import { clamp, safeDivide } from "../util/stats.js";

/**
 * Niche taxonomy.
 *
 * `commercialIntent` is the lever that separates a million views worth $500
 * from a hundred thousand views worth $50,000. It encodes how close the
 * audience already is to a buying decision: someone searching how to quote a
 * roof wash is one step from a transaction, someone watching a montage is not.
 * Values are deliberately conservative and every downstream projection states
 * which one it used.
 */
export interface NicheDefinition {
  slug: string;
  label: string;
  /** 0..1 — willingness of this audience to pay for an off-platform outcome. */
  commercialIntent: number;
  /** Rough US long-form RPM range, for the ad-revenue archetype. */
  rpmRange: { low: number; high: number };
  keywords: string[];
}

export const NICHES: NicheDefinition[] = [
  {
    slug: "home-services",
    label: "Home & exterior services",
    commercialIntent: 0.88,
    rpmRange: { low: 6, high: 18 },
    keywords: [
      "pressure wash", "softwash", "soft wash", "power wash", "roof cleaning",
      "gutter", "driveway", "window cleaning", "lawn care", "landscaping",
      "detailing", "exterior cleaning", "junk removal", "handyman", "contractor",
    ],
  },
  {
    slug: "skilled-trades",
    label: "Skilled trades",
    commercialIntent: 0.82,
    rpmRange: { low: 5, high: 15 },
    keywords: [
      "welding", "hvac", "plumbing", "electrician", "carpentry", "machinist",
      "cnc", "framing", "drywall", "tile", "apprentice", "job site", "toolbox",
    ],
  },
  {
    slug: "business-operations",
    label: "Business & client acquisition",
    commercialIntent: 0.85,
    rpmRange: { low: 8, high: 30 },
    keywords: [
      "agency", "smma", "client", "lead gen", "cold call", "cold email", "sales",
      "b2b", "freelance", "consulting", "small business", "entrepreneur",
      "side hustle", "make money", "scaling", "hiring", "payroll", "invoice",
    ],
  },
  {
    slug: "finance-investing",
    label: "Finance & investing",
    commercialIntent: 0.8,
    rpmRange: { low: 10, high: 40 },
    keywords: [
      "investing", "stocks", "portfolio", "dividend", "etf", "credit", "debt",
      "mortgage", "retirement", "tax", "budget", "crypto", "trading", "wealth",
    ],
  },
  {
    slug: "real-estate",
    label: "Real estate",
    commercialIntent: 0.84,
    rpmRange: { low: 10, high: 35 },
    keywords: [
      "real estate", "rental", "landlord", "airbnb", "property", "realtor",
      "house flip", "brrrr", "closing", "escrow", "tenant",
    ],
  },
  {
    slug: "software-ai",
    label: "Software, AI & tooling",
    commercialIntent: 0.76,
    rpmRange: { low: 8, high: 28 },
    keywords: [
      "programming", "developer", "javascript", "python", "saas", "api",
      "automation", "ai agent", "chatgpt", "claude", "llm", "no code",
      "software", "coding", "database", "devops",
    ],
  },
  {
    slug: "creator-education",
    label: "Creator growth & content",
    commercialIntent: 0.78,
    rpmRange: { low: 6, high: 22 },
    keywords: [
      "youtube growth", "algorithm", "thumbnail", "subscribers", "content creator",
      "faceless", "monetization", "views", "editing", "shorts strategy", "creator",
    ],
  },
  {
    slug: "fitness-health",
    label: "Fitness & health",
    commercialIntent: 0.68,
    rpmRange: { low: 4, high: 14 },
    keywords: [
      "workout", "fitness", "gym", "muscle", "fat loss", "diet", "nutrition",
      "protein", "training", "physique", "mobility", "running", "supplement",
    ],
  },
  {
    slug: "beauty-fashion",
    label: "Beauty & fashion",
    commercialIntent: 0.62,
    rpmRange: { low: 4, high: 15 },
    keywords: [
      "makeup", "skincare", "haul", "outfit", "fashion", "style", "hair",
      "grwm", "beauty", "routine", "wardrobe",
    ],
  },
  {
    slug: "automotive",
    label: "Automotive",
    commercialIntent: 0.6,
    rpmRange: { low: 4, high: 14 },
    keywords: [
      "car", "truck", "engine", "mechanic", "restoration", "turbo", "diesel",
      "garage build", "detailing car", "motorcycle", "off road",
    ],
  },
  {
    slug: "education-academic",
    label: "Education & academic",
    commercialIntent: 0.55,
    rpmRange: { low: 3, high: 12 },
    keywords: [
      "lesson", "explained", "history", "science", "math", "physics", "exam",
      "study", "course", "university", "language learning",
    ],
  },
  {
    slug: "food-cooking",
    label: "Food & cooking",
    commercialIntent: 0.45,
    rpmRange: { low: 3, high: 10 },
    keywords: [
      "recipe", "cooking", "kitchen", "bake", "meal prep", "restaurant", "chef",
      "grill", "bbq", "food",
    ],
  },
  {
    slug: "outdoors",
    label: "Outdoors & survival",
    commercialIntent: 0.5,
    rpmRange: { low: 3, high: 11 },
    keywords: [
      "camping", "bushcraft", "survival", "hiking", "fishing", "hunting",
      "overland", "backpacking", "prepper",
    ],
  },
  {
    slug: "gaming",
    label: "Gaming",
    commercialIntent: 0.25,
    rpmRange: { low: 1.5, high: 6 },
    keywords: [
      "gameplay", "gaming", "minecraft", "fortnite", "speedrun", "let's play",
      "walkthrough", "esports", "roblox", "fps",
    ],
  },
  {
    slug: "entertainment",
    label: "Entertainment & commentary",
    commercialIntent: 0.22,
    rpmRange: { low: 1.5, high: 7 },
    keywords: [
      "reaction", "prank", "vlog", "comedy", "sketch", "drama", "tier list",
      "ranking", "storytime", "challenge",
    ],
  },
];

/** Used when nothing matches: a neutral, mid-intent audience. */
export const FALLBACK_NICHE: NicheDefinition = {
  slug: "general",
  label: "General / mixed",
  commercialIntent: 0.5,
  rpmRange: { low: 3, high: 12 },
  keywords: [],
};

export function findNiche(slug: string): NicheDefinition {
  return NICHES.find((n) => n.slug === slug) ?? FALLBACK_NICHE;
}

/**
 * Classify a channel by keyword mass across its own words.
 *
 * Titles are weighted highest because they describe what the channel actually
 * ships; the channel description states intent, which is weaker evidence.
 */
export function classifyNiche(
  channel: ChannelSnapshot,
  videos: VideoRecord[],
): NicheProfile {
  const titleText = videos.map((v) => v.title).join(" \n ").toLowerCase();
  const tagText = videos.flatMap((v) => v.tags).join(" \n ").toLowerCase();
  const descriptionText = `${channel.title} ${channel.description}`.toLowerCase();

  const scores = NICHES.map((niche) => {
    let score = 0;
    const hits: string[] = [];

    for (const keyword of niche.keywords) {
      const inTitles = countOccurrences(titleText, keyword);
      const inTags = countOccurrences(tagText, keyword);
      const inDescription = countOccurrences(descriptionText, keyword);
      const weighted = inTitles * 3 + inTags * 1.5 + inDescription * 2;
      if (weighted > 0) {
        score += weighted;
        hits.push(keyword);
      }
    }

    return { niche, score, hits };
  }).sort((a, b) => b.score - a.score);

  const best = scores[0];
  const runnerUp = scores[1];

  if (!best || best.score === 0) {
    return {
      slug: FALLBACK_NICHE.slug,
      label: FALLBACK_NICHE.label,
      confidence: 0,
      commercialIntent: FALLBACK_NICHE.commercialIntent,
      signals: ["No niche keywords matched; using neutral commercial-intent assumptions."],
    };
  }

  // Confidence rises with both absolute evidence and separation from the
  // runner-up. A channel that matches two niches equally is genuinely ambiguous.
  const separation = runnerUp
    ? clamp(safeDivide(best.score - runnerUp.score, best.score, 1), 0, 1)
    : 1;
  const volume = clamp(best.score / 30, 0, 1);
  const confidence = clamp(0.35 * separation + 0.65 * volume, 0, 1);

  return {
    slug: best.niche.slug,
    label: best.niche.label,
    confidence,
    commercialIntent: best.niche.commercialIntent,
    signals: best.hits.slice(0, 8),
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}
