/**
 * The Earner — an agent whose single goal is to get a person in New Jersey
 * from zero to real, reported, legal income as fast as possible.
 *
 * Everything that decides *what* to recommend is deterministic and typed here.
 * The model only sequences and explains; it never invents a play, a number, or
 * a legal requirement that is not already in this catalogue.
 */

export type PlayCategory =
  | "liquidate" // turn things you already own into cash
  | "gig-platform" // app-dispatched work, paid per task or shift
  | "local-service" // work you sell directly to neighbours
  | "freelance" // skilled work sold online to clients
  | "micro-task" // small online tasks, low pay, instant start
  | "research" // paid studies, focus groups, plasma
  | "employment" // W-2 shifts, temp and seasonal work
  | "recovery"; // money that is already yours and unclaimed

export interface IncomePlay {
  id: string;
  name: string;
  category: PlayCategory;
  /** One paragraph: what it is and why it is on the list. */
  description: string;
  /** Can be done entirely online, from home. */
  online: boolean;
  /** Calendar days from deciding to do it to money in hand. 0 = same day. */
  timeToFirstDollarDays: number;
  /** Realistic earnings per hour of effort, after platform fees, before tax. */
  hourlyUsd: { low: number; high: number };
  /** Hours of paid work realistically available per week, if demand were unlimited. */
  maxHoursPerWeek: number;
  /** Cash you must spend before the first dollar arrives. */
  startupCapitalUsd: number;
  /** Things the operator must have or be; hard gates, not preferences. */
  requirements: PlayRequirement[];
  /** Skills that make this play materially better; not gates. */
  helpfulSkills: string[];
  /** Where to go to start, named so the plan can be specific. */
  platforms: string[];
  /** What New Jersey and federal law require for this play. Verify; not legal advice. */
  compliance: ComplianceNote[];
  /** The plain-English reasons this is, and stays, legitimate. */
  ethics: string[];
  /** What usually goes wrong. */
  risks: string[];
}

export type PlayRequirement =
  | "age-18"
  | "age-21"
  | "car"
  | "drivers-license"
  | "smartphone"
  | "computer"
  | "internet"
  | "bank-account"
  | "can-leave-home"
  | "physical-work"
  | "work-authorization"
  | "clean-driving-record"
  | "background-check";

export interface ComplianceNote {
  /** Who makes the rule. */
  authority: "federal" | "new-jersey" | "municipal" | "platform";
  /** What you must do. */
  requirement: string;
  /** Where to verify it. An official URL where one exists. */
  verifyAt?: string;
  /** Blocks starting until done, versus can be completed in parallel. */
  blocking: boolean;
}

/** What the person actually has and needs, which decides the ranking. */
export interface Situation {
  /** Days until money is needed. Drives how heavily speed is weighted. */
  urgencyDays: number;
  /** Hours per day available for paid work. */
  hoursPerDay: number;
  /** Cash available to spend on getting started. */
  cashOnHandUsd: number;
  /** Dollar target, if there is one. */
  targetUsd?: number;
  skills: string[];
  has: PlayRequirement[];
  /** Plays the person refuses to do, by id. Respected without argument. */
  excludePlayIds?: string[];
  /** Municipality, for local-ordinance reminders. */
  town?: string;
  notes?: string;
}

export interface RankedPlay {
  play: IncomePlay;
  /** Dollars realistically earnable inside the urgency window. */
  expectedUsdInWindow: { low: number; high: number };
  /** Dollars earnable in the first 7 days, regardless of the window. */
  expectedUsdFirstWeek: { low: number; high: number };
  /** Hours the plan actually allocates to this play, per week. */
  allocatedHoursPerWeek: number;
  /** 0..1. Speed to the first dollar, weighted by urgency. */
  speedScore: number;
  /** 0..1. Expected money in the window relative to the best option. */
  moneyScore: number;
  /** 0..1. Skills overlap; 1 when nothing special is needed. */
  skillScore: number;
  /** 0..1. The ranking key. */
  score: number;
  /** Hard blockers that make this unavailable today. */
  blockers: string[];
  /** Compliance steps that must be done before starting. */
  mustDoFirst: string[];
  rationale: string[];
}

/** The deterministic plan; the model's job is to turn it into a day. */
export interface EarnPlan {
  generatedAt: string;
  situation: Situation;
  ranked: RankedPlay[];
  /** The combination that fills the available hours fastest. */
  stack: RankedPlay[];
  /** Compliance steps for the stack, deduplicated and ordered. */
  setupChecklist: string[];
  /** Things this plan will never recommend, stated so the person knows. */
  refused: string[];
  projection: {
    firstWeekUsd: { low: number; high: number };
    windowUsd: { low: number; high: number };
    targetReachable: boolean | null;
  };
}

export interface LedgerEntry {
  date: string; // YYYY-MM-DD
  playId: string;
  grossUsd: number;
  hours: number;
  /** Platform fees, mileage, supplies. */
  expensesUsd: number;
  note?: string;
}

export interface Ledger {
  createdAt: string;
  targetUsd?: number;
  entries: LedgerEntry[];
}

export interface LedgerSummary {
  grossUsd: number;
  expensesUsd: number;
  netUsd: number;
  hours: number;
  /** Net dollars per hour actually worked, across every play. */
  netPerHour: number;
  /** Net dollars per calendar day since the first entry. */
  netPerDay: number;
  byPlay: { playId: string; netUsd: number; hours: number; netPerHour: number }[];
  /** Cash that should be set aside for income tax, at a conservative rate. */
  taxReserveUsd: number;
  daysActive: number;
}

/** What the agent hands back: the deterministic plan, narrated for one day. */
export interface DailyBrief {
  headline: string;
  /** Ordered actions for the next 24 hours, each with a time block. */
  today: { when: string; action: string; playId?: string; expectedUsd?: string }[];
  /** What to set up this week so next week earns more. */
  thisWeek: string[];
  /** Compliance steps, in the order they unblock earnings. */
  legalChecklist: string[];
  /** The one number to check tomorrow. */
  successMetric: string;
  /** The result that means change course, and when. */
  killCriteria: string;
  /** Anything the person proposed that the agent would not do, and why. */
  declined: string[];
}
