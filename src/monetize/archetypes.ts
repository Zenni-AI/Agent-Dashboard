import type { ProductArchetype } from "../types.js";

/**
 * The catalogue of ways attention becomes money.
 *
 * Each archetype carries the economics that govern it: what it sells for, what
 * share of an engaged audience actually buys, what delivery eats, how long
 * before the first dollar, and how much work it is. The conversion bands are
 * expressed as a share of the *engaged* audience per month — not of views, and
 * not of subscribers. That distinction is the whole reason the numbers here
 * land in a believable range instead of a fantasy one.
 *
 * Bands are wide on purpose. A projection that says "somewhere between $800 and
 * $6,000" is honest; one that says "$3,412" is not.
 */
export const ARCHETYPES: ProductArchetype[] = [
  {
    id: "ad-revenue",
    name: "YouTube ad revenue",
    category: "platform",
    description:
      "The Partner Programme. Passive, uncapped in effort terms, and almost never the answer on its own — it prices your audience at whatever advertisers will pay rather than what the audience is worth.",
    price: { low: 0, base: 0, high: 0 },
    conversionRate: { low: 0, base: 0, high: 0 },
    recurring: true,
    deliveryCostRate: 0,
    refundRate: 0,
    effort: 1,
    timeToFirstRevenueDays: 0,
    requiredSkills: [],
    bestForNiches: [],
    minimumEngagedAudience: 0,
    notes: [
      "Modelled from niche RPM against monthly views, not from audience conversion.",
      "Shorts monetize at a small fraction of long-form RPM; the split matters more than the total.",
      "Requires 1,000 subscribers plus 4,000 watch hours, or 10M Shorts views in 90 days.",
    ],
  },
  {
    id: "sponsorship",
    name: "Brand sponsorships",
    category: "sponsorship",
    description:
      "Selling integrated placements at a CPM. The fastest revenue that requires no product — and the one that caps out, because you are renting the audience out rather than serving it.",
    price: { low: 8, base: 18, high: 35 },
    conversionRate: { low: 0, base: 0, high: 0 },
    recurring: false,
    deliveryCostRate: 0.05,
    refundRate: 0,
    effort: 2,
    timeToFirstRevenueDays: 30,
    requiredSkills: ["outreach", "negotiation"],
    bestForNiches: [],
    minimumEngagedAudience: 0,
    notes: [
      "Priced per 1,000 long-form views. B2B and finance clear the top of the band; entertainment sits at the bottom.",
      "Assumes roughly one integration per month, not every video.",
    ],
  },
  {
    id: "affiliate",
    name: "Affiliate offers",
    category: "affiliate",
    description:
      "Commission on tools and gear you already use. No product, no delivery, no support — the lowest-resistance revenue on this list.",
    price: { low: 12, base: 35, high: 90 },
    conversionRate: { low: 0.005, base: 0.015, high: 0.03 },
    recurring: false,
    deliveryCostRate: 0.02,
    refundRate: 0.08,
    effort: 1,
    timeToFirstRevenueDays: 7,
    requiredSkills: [],
    bestForNiches: [],
    minimumEngagedAudience: 500,
    notes: [
      "Price is commission per conversion, not the sticker price of the product.",
      "Only credible for things genuinely used on camera; audiences punish the rest.",
    ],
  },
  {
    id: "digital-product",
    name: "Digital product (templates, checklists, presets)",
    category: "digital-product",
    description:
      "A small, finished artefact that removes one specific chore. Builds in a weekend, sells forever, costs nothing to deliver.",
    price: { low: 17, base: 39, high: 79 },
    conversionRate: { low: 0.01, base: 0.025, high: 0.05 },
    recurring: false,
    deliveryCostRate: 0.05,
    refundRate: 0.05,
    effort: 2,
    timeToFirstRevenueDays: 14,
    requiredSkills: ["the craft you already film"],
    bestForNiches: [],
    minimumEngagedAudience: 800,
    notes: [
      "The standard first product: it validates that the audience will pay at all, at low risk.",
      "Sell the thing you are already asked for in the comments.",
    ],
  },
  {
    id: "online-course",
    name: "Self-paced course",
    category: "education",
    description:
      "The full method, packaged once and sold repeatedly. High ceiling, real production cost, and it only works if the free content already proves the method.",
    price: { low: 199, base: 499, high: 999 },
    conversionRate: { low: 0.003, base: 0.01, high: 0.02 },
    recurring: false,
    deliveryCostRate: 0.12,
    refundRate: 0.08,
    effort: 4,
    timeToFirstRevenueDays: 45,
    requiredSkills: ["teaching", "curriculum design", "video production"],
    bestForNiches: [
      "business-operations", "home-services", "skilled-trades", "finance-investing",
      "software-ai", "creator-education", "real-estate", "fitness-health",
    ],
    minimumEngagedAudience: 2000,
    notes: [
      "Pre-sell before building. A course nobody buys at pre-sale is a course nobody buys finished.",
      "Refunds climb steeply above $500 without live support attached.",
    ],
  },
  {
    id: "operator-playbook",
    name: "Operator playbook + supply",
    category: "education",
    description:
      "The trade-business model: document real jobs at real prices, then sell the systems, pricing and materials to the people who want the same business. The content is the proof and the proof is the sales page.",
    price: { low: 297, base: 897, high: 1997 },
    conversionRate: { low: 0.002, base: 0.008, high: 0.018 },
    recurring: false,
    deliveryCostRate: 0.2,
    refundRate: 0.07,
    effort: 4,
    timeToFirstRevenueDays: 40,
    requiredSkills: ["operating the business you film", "teaching"],
    bestForNiches: ["home-services", "skilled-trades", "automotive", "business-operations", "real-estate"],
    minimumEngagedAudience: 1500,
    notes: [
      "Only credible while the underlying business is genuinely running — the jobs on camera are the product's proof.",
      "Attaching physical supply raises delivery cost but makes the revenue recurring.",
    ],
  },
  {
    id: "consulting",
    name: "One-to-one consulting",
    category: "service",
    description:
      "Sell your hours directly. The fastest path from an audience to money — no build, no funnel, no inventory. It does not scale, and that is fine when the goal is the first dollar.",
    price: { low: 250, base: 750, high: 2000 },
    conversionRate: { low: 0.001, base: 0.004, high: 0.008 },
    recurring: false,
    deliveryCostRate: 0.45,
    refundRate: 0.03,
    // A serious engagement is roughly a half-day once prep and follow-up are counted.
    deliveryHoursPerUnit: 4,
    effort: 3,
    timeToFirstRevenueDays: 7,
    requiredSkills: ["the craft you already film"],
    bestForNiches: [],
    minimumEngagedAudience: 300,
    notes: [
      "Delivery cost is your own time, priced honestly — this is why it does not scale.",
      "The right first move for almost every channel: it produces cash and customer research at once.",
    ],
  },
  {
    id: "done-for-you",
    name: "Done-for-you service",
    category: "service",
    description:
      "Do the work rather than teach it. Highest revenue per customer of anything here, and it becomes a company with staff and scheduling whether you wanted one or not.",
    price: { low: 1000, base: 3000, high: 8000 },
    conversionRate: { low: 0.0005, base: 0.002, high: 0.005 },
    recurring: false,
    deliveryCostRate: 0.45,
    refundRate: 0.02,
    // A delivered project, not a call. Capacity binds long before demand does.
    deliveryHoursPerUnit: 25,
    effort: 5,
    timeToFirstRevenueDays: 21,
    requiredSkills: ["delivery capacity", "project management", "hiring"],
    bestForNiches: [
      "home-services", "skilled-trades", "business-operations", "software-ai", "real-estate", "creator-education",
    ],
    minimumEngagedAudience: 200,
    notes: [
      "Needs very little audience — a handful of buyers per month is a real business.",
      "Capacity, not demand, is the binding constraint. Model against hours available, not audience size.",
    ],
  },
  {
    id: "membership",
    name: "Membership / community",
    category: "community",
    description:
      "Recurring access to you and to each other. The most durable revenue on this list and the most relentless — churn is a treadmill that never stops.",
    price: { low: 19, base: 39, high: 79 },
    conversionRate: { low: 0.003, base: 0.01, high: 0.02 },
    recurring: true,
    retentionMonths: 5,
    deliveryCostRate: 0.15,
    refundRate: 0.04,
    effort: 4,
    timeToFirstRevenueDays: 30,
    requiredSkills: ["community facilitation", "consistent presence"],
    bestForNiches: [
      "business-operations", "creator-education", "finance-investing", "fitness-health", "software-ai", "skilled-trades",
    ],
    minimumEngagedAudience: 1500,
    notes: [
      "Revenue is modelled at steady state: monthly joins multiplied by the assumed months a member stays.",
      "Below roughly 100 active members a community feels empty and churn accelerates.",
    ],
  },
  {
    id: "saas",
    name: "Software product",
    category: "software",
    description:
      "Build the tool the audience keeps asking for. The highest ceiling and the longest, most expensive road — an audience shortens distribution, not development.",
    price: { low: 29, base: 59, high: 149 },
    conversionRate: { low: 0.002, base: 0.008, high: 0.015 },
    recurring: true,
    retentionMonths: 9,
    deliveryCostRate: 0.25,
    refundRate: 0.05,
    effort: 5,
    timeToFirstRevenueDays: 120,
    requiredSkills: ["software engineering", "product design", "support"],
    bestForNiches: ["software-ai", "creator-education", "business-operations", "finance-investing"],
    minimumEngagedAudience: 3000,
    notes: [
      "Only rational when the audience has a repeated, specific workflow problem you can already name.",
      "Time to first revenue assumes an existing ability to build; without it, treat this as unavailable.",
    ],
  },
  {
    id: "physical-product",
    name: "Physical product",
    category: "physical",
    description:
      "Merch, gear, or consumables. Tangible and on-brand, with margins eaten by goods, shipping and returns.",
    price: { low: 35, base: 75, high: 180 },
    conversionRate: { low: 0.004, base: 0.012, high: 0.028 },
    recurring: false,
    deliveryCostRate: 0.55,
    refundRate: 0.06,
    effort: 4,
    timeToFirstRevenueDays: 60,
    requiredSkills: ["sourcing", "logistics"],
    bestForNiches: ["home-services", "skilled-trades", "outdoors", "automotive", "fitness-health", "beauty-fashion"],
    minimumEngagedAudience: 2000,
    notes: [
      "Consumables the audience re-buys beat one-off merch by a wide margin.",
      "Delivery cost here is goods plus shipping plus returns, which is why the net is roughly half the gross.",
    ],
  },
];

export function findArchetype(id: string): ProductArchetype | undefined {
  return ARCHETYPES.find((a) => a.id === id);
}

/** Archetypes whose economics are driven by views rather than audience conversion. */
export function isViewDriven(archetype: ProductArchetype): boolean {
  return archetype.category === "platform" || archetype.category === "sponsorship";
}
