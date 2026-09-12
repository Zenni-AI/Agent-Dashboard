import type { ComplianceNote } from "./types.js";

/**
 * The charter. Everything the Earner will not do, stated before it does
 * anything, and the general obligations that attach to every dollar it helps
 * bring in. The catalogue, the ranker and the model all sit inside this.
 *
 * None of this is legal advice. It is a checklist of the obligations a careful
 * person in New Jersey would verify, with the place to verify each one.
 */

export interface Prohibition {
  id: string;
  label: string;
  /** Why it is off the table — legal, ethical, or both. */
  why: string;
  /** Case-insensitive patterns that suggest a proposed activity falls here. */
  patterns: RegExp[];
}

export const PROHIBITIONS: Prohibition[] = [
  {
    id: "fraud-deception",
    label: "Fraud, deception or misrepresentation of any kind",
    why: "Illegal under the NJ Consumer Fraud Act and federal wire and mail fraud statutes; also simply wrong.",
    patterns: [
      /\bscam/i, /\bphish/i, /\bfake (review|testimonial|identity|id|document|invoice|receipt)/i,
      /\bimpersonat/i, /\bcounterfeit/i, /\bforg(e|ed|ery)\b/i, /\bchargeback (abuse|fraud)/i,
      /\brefund (abuse|scam|trick)/i, /\bidentity theft/i, /\bcatfish/i, /\bpretend(ing)? to be\b/i,
    ],
  },
  {
    id: "gambling",
    label: "Gambling, betting systems, or running games of chance",
    why: "Negative expected value for the player; running one without a license is a crime in NJ. Not a way to make money.",
    patterns: [
      /\bgambl/i, /\bsports ?bet/i, /\bbetting\b/i, /\bcasino/i, /\bpoker\b/i, /\blottery\b/i,
      /\bslots?\b/i, /\bparlay/i, /\braffle/i, /\bmatched betting/i, /\barbitrage bet/i,
    ],
  },
  {
    id: "mlm-pyramid",
    label: "Multi-level marketing or any recruitment-based income",
    why: "Pyramid schemes are illegal in NJ; even legal MLMs lose money for the overwhelming majority of participants.",
    patterns: [/\bmlm\b/i, /\bmulti-?level/i, /\bpyramid/i, /\bnetwork marketing/i, /\bdownline/i, /\brecruit(ing)? (people|members|sellers) under/i],
  },
  {
    id: "unlicensed-regulated-work",
    label: "Work that requires a license the person does not hold",
    why: "Practising a licensed trade or profession without the license is a criminal offence and voids any contract.",
    patterns: [
      /\bunlicensed (electrical|electrician|plumb|contract|medical|legal|practice|work as)/i,
      /\bwithout (a |the )?(proper |required |valid )?licen[cs]e/i, /\belectrical work/i, /\bplumbing\b/i, /\bhvac\b/i,
      /\bpractice (law|medicine|nursing)/i, /\blegal advice/i, /\bmedical advice/i, /\btherapy sessions?/i,
      /\bcosmetolog/i, /\bbarber/i, /\bmassage/i, /\bsecurity guard/i, /\breal estate agent/i,
      /\binsurance (agent|sales)/i, /\bday ?care cent/i, /\btattoo/i,
    ],
  },
  {
    id: "tax-evasion",
    label: "Hiding income, paying or being paid off the books, or misclassifying work",
    why: "Every dollar is reportable to the IRS and the NJ Division of Taxation whether or not a form arrives. Cash is fine; hidden cash is not.",
    patterns: [
      /\bunder the table/i, /\boff the books/i, /\bunreported/i, /\bavoid(ing)? tax/i, /\bdon'?t report/i,
      /\bcash only to (avoid|skip|dodge)/i, /\btax[- ]free cash/i, /\bno paper ?trail/i,
    ],
  },
  {
    id: "financial-crime",
    label: "Moving money for others, cashing cheques, crypto 'arbitrage' for strangers, or lending without a license",
    why: "These are the standard shapes of money laundering and money-mule recruitment. Unlicensed lending is a crime in NJ.",
    patterns: [
      /\bmoney mule/i, /\bcash (a |their )?che(ck|que)s? for/i, /\btransfer money for/i, /\breceive payments? on behalf/i,
      /\bpayday loan/i, /\blend(ing)? money at/i, /\bloan shark/i, /\bpump and dump/i, /\bcrypto (arbitrage|signal|bot) for/i,
      /\bmoney laund/i, /\bstructur(e|ing) deposits/i,
    ],
  },
  {
    id: "data-abuse",
    label: "Harvesting, scraping or selling personal data; selling or renting accounts",
    why: "Violates the CAN-SPAM Act, the TCPA, platform terms and basic decency. Account sales are fraud against the platform.",
    patterns: [
      /\bscrap(e|ing) (personal|user|contact|phone|email)/i, /\bsell(ing)? (leads|emails|phone numbers|personal data)/i,
      /\bsell(ing)? (my |an? |your |old )?(\w+ )?(account|profile)s?\b/i, /\brent(ing)? (my |an? |your )?(\w+ )?(account|profile)/i,
      /\bbuy(ing)? followers/i, /\bbot (farm|network)/i, /\bcold (text|sms) blast/i, /\brobocall/i,
    ],
  },
  {
    id: "academic-dishonesty",
    label: "Writing essays, exams or coursework for students to submit as their own",
    why: "Contract cheating defrauds the institution; illegal in a growing number of states and a permanent reputational risk.",
    patterns: [/\bessay mill/i, /\bwrite (their|students'?|someone'?s) (essay|homework|thesis|assignment)/i, /\btake (their|an?) (exam|test) for/i, /\bcontract cheating/i],
  },
  {
    id: "ip-theft",
    label: "Selling copied, pirated or trademark-infringing goods or content",
    why: "Copyright and trademark infringement carry statutory damages; print-on-demand of other people's IP is the commonest version.",
    patterns: [/\bpirat/i, /\bbootleg/i, /\bcopyrighted (images?|content|music|logos?) (on|for sale)/i, /\breplica (brand|designer)/i, /\bknock-?off/i, /\bdisney|marvel|pokemon|nike logo/i],
  },
  {
    id: "harm",
    label: "Anything that endangers the person or others",
    why: "No amount of money is worth a felony, a lost limb, or someone else's harm.",
    patterns: [/\bdrug/i, /\bweapon/i, /\bfirearm/i, /\bsmuggl/i, /\bsell(ing)? (my )?(kidney|organ)/i, /\bstreet rac/i],
  },
];

/** Legal but declined: the agent will not plan these, and says so plainly. */
export const DECLINED_BY_POLICY: { label: string; why: string; patterns: RegExp[] }[] = [
  {
    label: "Adult content",
    why: "Legal for adults, but the exposure is permanent and outside what this agent will plan. The decision is the person's, not the agent's.",
    patterns: [/\bonlyfans/i, /\badult content/i, /\bcamming/i, /\bescort/i],
  },
  {
    label: "Selling eggs, sperm or surrogacy",
    why: "Legal and regulated, but medical decisions with lifelong consequences do not belong in a cash-flow plan.",
    patterns: [/\begg donat/i, /\bsperm donat/i, /\bsurroga/i],
  },
  {
    label: "Anything that requires taking on debt to start",
    why: "A loan to fund a side hustle turns a cash problem into a bigger cash problem. This agent ranks plays that start with what you have.",
    patterns: [/\btake (out )?a loan to/i, /\bcredit card (to fund|advance)/i, /\bborrow (money )?to start/i],
  },
];

/** Obligations that attach to every dollar, regardless of play. */
export const GENERAL_COMPLIANCE: ComplianceNote[] = [
  {
    authority: "federal",
    requirement:
      "Report all income on your federal return, whether or not you receive a 1099. Self-employment tax (15.3%) applies once net self-employment earnings reach $400 in a year; keep a simple income and expense log from day one.",
    verifyAt: "https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center",
    blocking: false,
  },
  {
    authority: "federal",
    requirement:
      "If you will owe $1,000 or more in federal tax for the year, pay quarterly estimated tax (Form 1040-ES). Set aside 25-30% of net self-employment income as you earn it.",
    verifyAt: "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes",
    blocking: false,
  },
  {
    authority: "new-jersey",
    requirement:
      "New Jersey taxes the same income on the NJ-1040. If you expect to owe more than $400 in NJ tax, make NJ estimated payments (NJ-1040-ES).",
    verifyAt: "https://www.nj.gov/treasury/taxation/",
    blocking: false,
  },
  {
    authority: "new-jersey",
    requirement:
      "If you sell taxable goods or services (most physical goods, many services), register the business with the NJ Division of Revenue (form NJ-REG, free, online) before your first sale and collect 6.625% sales tax. Occasional sales of your own used belongings are casual sales and do not require this.",
    verifyAt: "https://www.nj.gov/treasury/revenue/",
    blocking: false,
  },
  {
    authority: "new-jersey",
    requirement:
      "Operating under any name other than your own legal name requires a trade-name registration with the county clerk (sole proprietor) or an LLC filing with the state. Your own name needs nothing.",
    verifyAt: "https://business.nj.gov/",
    blocking: false,
  },
  {
    authority: "municipal",
    requirement:
      "Many NJ municipalities require a mercantile or peddler licence for door-to-door selling and some home-based businesses, and a permit for yard sales. Check your town's clerk page before selling in person.",
    blocking: false,
  },
  {
    authority: "federal",
    requirement:
      "You must be authorised to work in the United States for W-2 employment, and platforms verify this. Self-employment income is still reportable regardless of status; if your status is uncertain, get advice before starting.",
    blocking: true,
  },
];

export type ScreenVerdict = "allowed" | "blocked" | "declined";

export interface ScreenResult {
  verdict: ScreenVerdict;
  /** The prohibitions or policies that matched. */
  matched: { id?: string; label: string; why: string }[];
  /** Always returned, so the caller can show them regardless of verdict. */
  generalObligations: string[];
}

/**
 * Screen a proposed activity, in plain English, against the charter.
 *
 * This is a keyword screen, not a legal opinion: it catches the obvious shapes
 * of illegal and unethical income so the model cannot be talked into them, and
 * it is deliberately biased toward false positives. Anything it blocks can be
 * argued with by a human; nothing it blocks gets planned by the agent.
 */
export function screenActivity(description: string): ScreenResult {
  const text = description.trim();
  const blocked = PROHIBITIONS.filter((p) => p.patterns.some((re) => re.test(text))).map((p) => ({
    id: p.id,
    label: p.label,
    why: p.why,
  }));
  if (blocked.length > 0) {
    return { verdict: "blocked", matched: blocked, generalObligations: obligations() };
  }
  const declined = DECLINED_BY_POLICY.filter((p) => p.patterns.some((re) => re.test(text))).map((p) => ({
    label: p.label,
    why: p.why,
  }));
  if (declined.length > 0) {
    return { verdict: "declined", matched: declined, generalObligations: obligations() };
  }
  return { verdict: "allowed", matched: [], generalObligations: obligations() };
}

function obligations(): string[] {
  return GENERAL_COMPLIANCE.map((c) => c.requirement);
}

/** The refusals, phrased for a plan's "what this will never recommend" section. */
export function refusalSummary(): string[] {
  return [
    ...PROHIBITIONS.map((p) => `${p.label}. ${p.why}`),
    ...DECLINED_BY_POLICY.map((p) => `${p.label} (legal, but not planned here). ${p.why}`),
  ];
}
