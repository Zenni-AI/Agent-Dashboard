import type { IncomePlay } from "./types.js";

/**
 * Every legitimate way this agent knows to turn a person in New Jersey's time,
 * skills and belongings into reported income, with the economics and the
 * obligations attached.
 *
 * Hourly figures are after platform fees and the obvious direct costs (fuel
 * at the IRS mileage rate, supplies) and before tax. They are ranges because
 * the truth is a range. Compliance notes are the obligations a careful person
 * would verify before starting; they are not legal advice, and each names where
 * to check.
 *
 * Nothing here requires a loan, a license the person does not already hold, or
 * a lie to anyone.
 */
export const PLAYS: IncomePlay[] = [
  // ---------------------------------------------------------------- liquidate
  {
    id: "sell-belongings",
    name: "Sell what you already own",
    category: "liquidate",
    description:
      "Electronics, tools, furniture, bikes, brand-name clothes, game consoles, instruments, textbooks. The only play on this list that pays today, because the product already exists and the buyer is already searching. Photograph in daylight, price at 60-70% of the cheapest comparable listing, meet at a police-station lot or a busy store.",
    online: true,
    timeToFirstDollarDays: 0,
    hourlyUsd: { low: 20, high: 80 },
    maxHoursPerWeek: 8,
    startupCapitalUsd: 0,
    requirements: ["smartphone", "internet"],
    helpfulSkills: ["photography", "writing"],
    platforms: [
      "Facebook Marketplace (local cash, same day)",
      "OfferUp",
      "eBay (national reach, 7-10 days to payout)",
      "Mercari",
      "Decluttr / BackMarket buyback (electronics, prepaid label)",
      "Plato's Closet / Buffalo Exchange (clothes, cash on the spot)",
      "Local used-book, music and game stores",
    ],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "Occasional sales of your own used personal property are casual sales: no sales tax to collect, no business registration. This stops being true the moment you buy things in order to resell them.",
        verifyAt: "https://www.nj.gov/treasury/taxation/",
        blocking: false,
      },
      {
        authority: "municipal",
        requirement: "A yard or garage sale usually needs a free or cheap permit from the town clerk, and is limited to a few per year.",
        blocking: false,
      },
      {
        authority: "federal",
        requirement: "Selling your own used items for less than you paid is not taxable income. Selling for more than you paid is a capital gain and is reportable.",
        verifyAt: "https://www.irs.gov/businesses/gig-economy-tax-center",
        blocking: false,
      },
    ],
    ethics: ["You own it, you describe it honestly, the buyer inspects it. Nothing cleaner."],
    risks: ["Lowball offers and no-shows. Price firmly, confirm an hour before meeting, never ship before payment clears."],
  },
  {
    id: "resell-flip",
    name: "Buy low locally, sell high online",
    category: "liquidate",
    description:
      "Estate sales, thrift stores, clearance aisles and free curbside furniture, resold on eBay and Marketplace. A real business with real inventory risk. Only worth doing once the first-week plays are running, and only in categories you can price from memory.",
    online: true,
    timeToFirstDollarDays: 7,
    hourlyUsd: { low: 12, high: 40 },
    maxHoursPerWeek: 15,
    startupCapitalUsd: 150,
    requirements: ["smartphone", "internet", "can-leave-home", "bank-account"],
    helpfulSkills: ["pricing", "a product category you know cold", "photography"],
    platforms: ["eBay", "Facebook Marketplace", "Poshmark / Depop (clothes)", "Whatnot (live selling)"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "Buying to resell is a business. Register with NJ-REG before your first sale. Marketplaces such as eBay collect and remit NJ sales tax for you; local cash sales you must collect 6.625% on yourself.",
        verifyAt: "https://www.nj.gov/treasury/revenue/",
        blocking: true,
      },
      {
        authority: "municipal",
        requirement: "Some NJ towns license second-hand dealers. Check with the clerk if you sell in person from home.",
        blocking: false,
      },
      {
        authority: "federal",
        requirement: "Profit is Schedule C income. Keep receipts for everything you buy to resell.",
        blocking: false,
      },
    ],
    ethics: ["Honest descriptions, honest condition grades, no counterfeit or recalled goods, ever."],
    risks: ["Cash tied up in things nobody buys. Start with what sells in under a week: tools, small electronics, name-brand shoes."],
  },

  // ---------------------------------------------------------------- recovery
  {
    id: "unclaimed-money",
    name: "Claim money that is already yours",
    category: "recovery",
    description:
      "New Jersey holds billions in unclaimed property: old bank accounts, utility deposits, final paycheques, insurance payouts, and refunds. Search every state you have lived in, plus old 401(k) accounts and unclaimed class-action settlements. Twenty minutes of searching; payouts take weeks but cost nothing.",
    online: true,
    timeToFirstDollarDays: 21,
    hourlyUsd: { low: 0, high: 200 },
    maxHoursPerWeek: 1,
    startupCapitalUsd: 0,
    requirements: ["internet"],
    helpfulSkills: [],
    platforms: [
      "NJ Unclaimed Property Administration (unclaimedproperty.nj.gov)",
      "MissingMoney.com (every participating state)",
      "National Registry of Unclaimed Retirement Benefits",
      "IRS 'Where's My Refund' for unfiled prior-year refunds",
    ],
    compliance: [
      {
        authority: "new-jersey",
        requirement: "Claim directly through the state site; it is free. Never pay a 'finder' a percentage to do a search you can do yourself.",
        verifyAt: "https://www.unclaimedproperty.nj.gov/",
        blocking: false,
      },
    ],
    ethics: ["It is your money. The state is holding it for you."],
    risks: ["Most searches find nothing. Do it once, then move on."],
  },
  {
    id: "bank-bonuses",
    name: "Bank account opening bonuses",
    category: "recovery",
    description:
      "Banks pay $200-400 to open a checking account and receive qualifying direct deposits for two or three months. Pair it with any W-2 play on this list and the bonus is a side effect of getting paid. Not a credit product; no debt, no credit pull beyond a soft check at most banks.",
    online: true,
    timeToFirstDollarDays: 45,
    hourlyUsd: { low: 50, high: 200 },
    maxHoursPerWeek: 1,
    startupCapitalUsd: 0,
    requirements: ["internet", "bank-account"],
    helpfulSkills: [],
    platforms: ["Doctor of Credit bonus list (tracks current offers)", "Chase, Wells Fargo, Citi, Capital One, TD (NJ branches)"],
    compliance: [
      {
        authority: "federal",
        requirement: "Bonuses are interest income and arrive on a 1099-INT. Read the fee schedule; close or downgrade after the bonus posts so monthly fees do not eat it.",
        blocking: false,
      },
    ],
    ethics: ["You are the customer the bank is paying to acquire. Meet the stated terms and you have earned it."],
    risks: ["Minimum-balance fees and early-closure clawbacks. Calendar the dates."],
  },

  // ------------------------------------------------------------- employment
  {
    id: "same-day-shifts",
    name: "Same-day and next-day shift work",
    category: "employment",
    description:
      "Warehouse, event staffing, catering, stadium concessions and stocking shifts dispatched by app, many paid the next business day. The fastest reliable wage income available: onboarding is a background check and an ID upload, and there is work every week in a state this dense.",
    online: false,
    timeToFirstDollarDays: 3,
    hourlyUsd: { low: 16, high: 26 },
    maxHoursPerWeek: 40,
    startupCapitalUsd: 0,
    requirements: ["age-18", "can-leave-home", "physical-work", "work-authorization", "smartphone", "bank-account"],
    helpfulSkills: ["food service", "forklift", "bartending (TIPS certification)"],
    platforms: ["Instawork", "Qwick (hospitality)", "Wonolo", "Veryable (light industrial)", "Shiftsmart", "Indeed Flex"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "W-2 shifts must pay at least the NJ minimum wage (about $15.92 in 2026 for most employers) and accrue NJ Earned Sick Leave at one hour per 30 worked. If a staffing agency places you, the NJ Temporary Workers' Bill of Rights applies: written assignment notice and equal pay to permanent workers doing the same job.",
        verifyAt: "https://www.nj.gov/labor/",
        blocking: false,
      },
      {
        authority: "federal",
        requirement: "Bring ID for the I-9. Some platforms classify shifts as 1099; if so, the self-employment obligations above apply.",
        blocking: true,
      },
    ],
    ethics: ["Honest work at a posted wage for a business that needs hands that day."],
    risks: ["Shifts are taken within minutes of posting; check the app at 6am. Unreliable attendance gets you removed quickly."],
  },
  {
    id: "temp-and-seasonal",
    name: "Temp agency, warehouse and seasonal jobs",
    category: "employment",
    description:
      "New Jersey is the warehouse of the Northeast: Amazon, UPS, FedEx and third-party logistics hire continuously along the Turnpike corridor, and retail adds seasonal staff from October. Weekly pay, predictable hours, and the direct deposit that unlocks bank bonuses. Slower to start than app shifts, steadier once started.",
    online: false,
    timeToFirstDollarDays: 10,
    hourlyUsd: { low: 16, high: 23 },
    maxHoursPerWeek: 40,
    startupCapitalUsd: 0,
    requirements: ["age-18", "can-leave-home", "work-authorization", "bank-account"],
    helpfulSkills: ["forklift", "customer service", "CDL"],
    platforms: [
      "Amazon Jobs (Robbinsville, Edison, Carteret, Avenel, Logan)",
      "UPS and FedEx seasonal hiring pages",
      "Adecco, Randstad, Express Employment, Staffmark (walk-in offices statewide)",
      "NJ Career Connections (state job board)",
    ],
    compliance: [
      {
        authority: "new-jersey",
        requirement: "Same wage, sick-leave and Temp Workers' Bill of Rights protections as above. Agencies may not charge you a fee for placement.",
        verifyAt: "https://www.nj.gov/labor/",
        blocking: false,
      },
    ],
    ethics: ["Straightforward employment."],
    risks: ["First paycheque is usually two weeks out. Bridge it with the same-day plays."],
  },

  // ------------------------------------------------------------ gig platform
  {
    id: "food-delivery",
    name: "Food and grocery delivery",
    category: "gig-platform",
    description:
      "DoorDash, Uber Eats and Instacart approve most drivers within a week and pay out instantly for a small fee. In dense north Jersey and the shore towns in summer, dinner rush and weekend brunch are the only hours worth driving; the rest is waiting. Figures here already subtract fuel and wear at the IRS mileage rate, which most new drivers forget to do.",
    online: false,
    timeToFirstDollarDays: 4,
    hourlyUsd: { low: 12, high: 24 },
    maxHoursPerWeek: 35,
    startupCapitalUsd: 0,
    requirements: ["age-18", "car", "drivers-license", "smartphone", "can-leave-home", "bank-account", "background-check"],
    helpfulSkills: ["knowing the local roads"],
    platforms: ["DoorDash", "Uber Eats (car deliveries require 19+)", "Instacart", "Grubhub", "Spark (Walmart)"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "Tell your auto insurer you deliver for pay. A standard NJ personal policy can deny a claim during a delivery; a rideshare/delivery endorsement is usually $10-30 a month and protects you.",
        verifyAt: "https://www.nj.gov/dobi/",
        blocking: true,
      },
      {
        authority: "federal",
        requirement:
          "You are an independent contractor: track every mile from the first pickup to the last drop-off (the mileage deduction is the largest one you have) and reserve 25-30% of net for tax.",
        verifyAt: "https://www.irs.gov/businesses/gig-economy-tax-center",
        blocking: false,
      },
      {
        authority: "platform",
        requirement: "Background and driving-record check; a valid NJ licence, registration and insurance in your name or with you listed.",
        blocking: true,
      },
    ],
    ethics: ["Paid per delivery by platforms that publish the pay before you accept. Decline anything that does not pay for the miles."],
    risks: ["Wear on the car is the hidden cost. Parking tickets in Hoboken and Jersey City will erase a shift."],
  },
  {
    id: "rideshare",
    name: "Rideshare driving",
    category: "gig-platform",
    description:
      "Uber and Lyft. Higher per-hour than delivery at airport and nightlife hours (Newark, Hoboken, New Brunswick, Atlantic City), lower everywhere else, and the car has to qualify. Approval takes longer than delivery because New Jersey's rideshare law requires a state-mandated background check.",
    online: false,
    timeToFirstDollarDays: 7,
    hourlyUsd: { low: 14, high: 28 },
    maxHoursPerWeek: 40,
    startupCapitalUsd: 0,
    requirements: ["age-21", "car", "drivers-license", "clean-driving-record", "smartphone", "can-leave-home", "bank-account", "background-check"],
    helpfulSkills: ["knowing the local roads", "customer service"],
    platforms: ["Uber", "Lyft"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "The NJ Transportation Network Company Safety and Regulatory Act requires the company to carry $1.5M liability while you have a passenger and to background-check you. You must still notify your own insurer and carry a rideshare endorsement for the gap when the app is on but no trip is accepted.",
        verifyAt: "https://www.nj.gov/mvc/",
        blocking: true,
      },
      {
        authority: "platform",
        requirement: "Vehicle year, four-door and inspection requirements vary by platform; a 21+ age minimum and at least one year of US licensed driving are standard.",
        blocking: true,
      },
      {
        authority: "federal",
        requirement: "Independent contractor: mileage log and 25-30% tax reserve, as with delivery.",
        blocking: false,
      },
    ],
    ethics: ["A licensed, insured, regulated service the passenger chose and agreed a price for."],
    risks: ["Deadhead miles and surge-chasing. Airport queues can mean an hour unpaid."],
  },
  {
    id: "amazon-flex",
    name: "Amazon Flex delivery blocks",
    category: "gig-platform",
    description:
      "Pre-booked two-to-four-hour delivery blocks from Amazon stations, paid a flat rate per block. Predictable and decent per hour, but onboarding in New Jersey often means a waitlist, so this is a week-two play at best.",
    online: false,
    timeToFirstDollarDays: 14,
    hourlyUsd: { low: 16, high: 23 },
    maxHoursPerWeek: 30,
    startupCapitalUsd: 0,
    requirements: ["age-21", "car", "drivers-license", "smartphone", "can-leave-home", "bank-account", "background-check"],
    helpfulSkills: [],
    platforms: ["Amazon Flex"],
    compliance: [
      {
        authority: "new-jersey",
        requirement: "Commercial-use insurance notice to your insurer, as with any delivery for pay.",
        blocking: true,
      },
      {
        authority: "federal",
        requirement: "Independent contractor: mileage log and tax reserve.",
        blocking: false,
      },
    ],
    ethics: ["Flat, posted pay per block."],
    risks: ["Blocks that run long are unpaid overtime. Mid-size sedans fit more packages than compacts."],
  },

  // ----------------------------------------------------------- local service
  {
    id: "local-labor",
    name: "Moving help, yard cleanup, snow and odd jobs",
    category: "local-service",
    description:
      "Loading trucks, hauling furniture upstairs, raking leaves in October and November, shovelling driveways the morning after a storm, assembling furniture, hanging shelves. Every neighbourhood group in New Jersey has someone asking for this every week, and nobody asks for a résumé. Price per job, not per hour, and quote before you start.",
    online: false,
    timeToFirstDollarDays: 1,
    hourlyUsd: { low: 25, high: 50 },
    maxHoursPerWeek: 25,
    startupCapitalUsd: 0,
    requirements: ["age-18", "can-leave-home", "physical-work", "smartphone"],
    helpfulSkills: ["basic tools", "a truck or hatchback", "furniture assembly"],
    platforms: ["TaskRabbit", "Thumbtack", "Nextdoor", "Town Facebook groups ('<town> moms', '<town> community')", "Craigslist gigs", "Flyers at the hardware store and laundromat"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "Stay on the cleaning-and-labour side of the line. Anything that alters the home (repairs, painting, installing fixtures) is home improvement and requires NJ Home Improvement Contractor registration with the Division of Consumer Affairs plus insurance. Assembly, moving, raking and shovelling do not.",
        verifyAt: "https://www.njconsumeraffairs.gov/hic",
        blocking: false,
      },
      {
        authority: "new-jersey",
        requirement:
          "Do not haul away other people's junk for a fee: transporting solid waste for compensation requires NJ DEP registration. Leave it curbside for the town's bulk pickup instead. Do not apply pesticides or weed-and-feed: that needs a NJ DEP pesticide applicator licence.",
        verifyAt: "https://www.nj.gov/dep/",
        blocking: false,
      },
      {
        authority: "municipal",
        requirement: "Many towns require landscapers, including solo lawn-mowing, to register with the clerk. Leaf raking and snow shovelling are rarely covered; check before mowing for pay.",
        blocking: false,
      },
      {
        authority: "new-jersey",
        requirement: "Landscaping and cleaning services are taxable in NJ once you operate as a business. Casual one-off help for a neighbour is not. Register with NJ-REG when it becomes regular.",
        verifyAt: "https://www.nj.gov/treasury/taxation/",
        blocking: false,
      },
    ],
    ethics: ["Quote in writing, show up when you said, do what was agreed. Reputation is the entire marketing plan."],
    risks: ["Back injuries. Lift with someone else for anything over 50 lb. Weather decides the snow income."],
  },
  {
    id: "home-cleaning",
    name: "House cleaning and turnover cleans",
    category: "local-service",
    description:
      "Regular house cleaning, move-out cleans for tenants who want the deposit back, and turnovers for short-term rentals along the shore. Recurring clients in three weeks if the first clean is excellent. Supplies cost under $60 to start; most clients let you use theirs.",
    online: false,
    timeToFirstDollarDays: 3,
    hourlyUsd: { low: 25, high: 45 },
    maxHoursPerWeek: 30,
    startupCapitalUsd: 50,
    requirements: ["age-18", "can-leave-home", "physical-work", "smartphone"],
    helpfulSkills: ["attention to detail", "a car"],
    platforms: ["Care.com (housekeeping)", "Thumbtack", "Nextdoor", "Local Facebook groups", "Property managers and Airbnb hosts directly"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "Cleaning services are subject to NJ sales tax once you are in business. Register with NJ-REG and collect 6.625%, or work as a W-2 employee of a cleaning company and skip all of it.",
        verifyAt: "https://www.nj.gov/treasury/taxation/",
        blocking: false,
      },
      {
        authority: "federal",
        requirement: "Independent contractor if you set your own schedule and bring your own methods; Schedule C and the tax reserve apply.",
        blocking: false,
      },
    ],
    ethics: ["Priced per job, agreed in advance, done to the standard promised."],
    risks: ["Breakage claims. Photograph the space before and after; a $200 general-liability policy a year is worth it once you have three clients."],
  },
  {
    id: "exterior-cleaning",
    name: "Pressure washing and gutter clearing",
    category: "local-service",
    description:
      "Driveways, siding, decks, and gutters. The best-paid outdoor work in the state that needs no licence, because the result is visible from the street and every neighbour sees it. A $350 electric washer pays for itself on the second driveway; renting one for a day costs about $80.",
    online: false,
    timeToFirstDollarDays: 4,
    hourlyUsd: { low: 40, high: 80 },
    maxHoursPerWeek: 25,
    startupCapitalUsd: 350,
    requirements: ["age-18", "car", "can-leave-home", "physical-work", "smartphone"],
    helpfulSkills: ["pressure washing", "ladders", "sales"],
    platforms: ["Door knocking on the street where you just did a job", "Nextdoor", "Facebook groups", "Thumbtack"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "Cleaning is not home improvement, so HIC registration is not required for washing and gutter clearing. Gutter repair or replacement is home improvement and is. Stay on the cleaning side until registered.",
        verifyAt: "https://www.njconsumeraffairs.gov/hic",
        blocking: false,
      },
      {
        authority: "municipal",
        requirement: "Some towns restrict wash-water runoff to storm drains and require a mercantile licence for exterior services. Ask the clerk; it is usually a form and a small fee.",
        blocking: false,
      },
      {
        authority: "new-jersey",
        requirement: "Taxable service in NJ: NJ-REG and 6.625% once regular.",
        verifyAt: "https://www.nj.gov/treasury/taxation/",
        blocking: false,
      },
    ],
    ethics: ["Visible, verifiable work at a quoted price."],
    risks: ["Ladder falls are the injury that ends this. Two-storey gutters need a second person or a stand-off. Stripping paint or etching concrete with too much pressure costs more than the job paid."],
  },
  {
    id: "pet-care",
    name: "Dog walking and pet sitting",
    category: "local-service",
    description:
      "Midday walks for commuters and drop-in visits for travellers. Rover approval takes about a week; a flyer at the dog park and the vet's noticeboard works in a day. Overnight boarding in your home pays most but has the most rules.",
    online: false,
    timeToFirstDollarDays: 2,
    hourlyUsd: { low: 18, high: 35 },
    maxHoursPerWeek: 25,
    startupCapitalUsd: 0,
    requirements: ["age-18", "can-leave-home", "smartphone"],
    helpfulSkills: ["dog handling", "reliability"],
    platforms: ["Rover", "Wag", "Care.com", "Nextdoor", "The vet's noticeboard and the dog park"],
    compliance: [
      {
        authority: "municipal",
        requirement: "Regularly boarding dogs in your home can fall under local kennel and zoning ordinances and your lease. Walks and drop-ins almost never do. Check before boarding.",
        blocking: false,
      },
      {
        authority: "federal",
        requirement: "Independent contractor income; Rover issues 1099s above the threshold, but all of it is reportable.",
        blocking: false,
      },
    ],
    ethics: ["Someone trusts you with a family member. Be early, send the photo, lock the door."],
    risks: ["A dog fight or a lost dog is the catastrophic case. One dog at a time until you know them."],
  },
  {
    id: "babysitting",
    name: "Babysitting and after-school care",
    category: "local-service",
    description:
      "Evenings and weekends for parents who want a night out, and the 3pm-6pm gap for working parents. Well-paid in the commuter towns, found through parents' groups and school networks more than apps. Care in the child's home needs no licence.",
    online: false,
    timeToFirstDollarDays: 3,
    hourlyUsd: { low: 18, high: 30 },
    maxHoursPerWeek: 25,
    startupCapitalUsd: 0,
    requirements: ["age-18", "can-leave-home", "smartphone", "background-check"],
    helpfulSkills: ["childcare experience", "CPR certification", "a car"],
    platforms: ["Care.com", "Sittercity", "UrbanSitter", "Town parents' Facebook groups", "Word of mouth through one good family"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "Care in the family's own home is unregulated. Caring for several unrelated children in your own home on a regular basis is family child care; NJ registration through the Department of Children and Families is voluntary for up to five children but parents and subsidy programmes often require it.",
        verifyAt: "https://www.nj.gov/dcf/",
        blocking: false,
      },
      {
        authority: "federal",
        requirement: "A family paying you over the household-employee threshold in a year is technically your employer; most sitters are paid as casual labour and report it as self-employment income. Either way, report it.",
        verifyAt: "https://www.irs.gov/publications/p926",
        blocking: false,
      },
    ],
    ethics: ["Nothing matters more than the child's safety. Do not take a job you are not sure you can do well."],
    risks: ["A Red Cross babysitting or CPR course is about $40 and doubles your bookings."],
  },
  {
    id: "cottage-food",
    name: "Baked goods and preserves under the Cottage Food law",
    category: "local-service",
    description:
      "Since 2021 New Jersey lets you sell shelf-stable foods made in your home kitchen directly to consumers: breads, cookies, cakes, jams, granola, roasted coffee. The permit takes weeks, so this is a month-two play, but the margins are high and pre-orders mean no waste.",
    online: true,
    timeToFirstDollarDays: 30,
    hourlyUsd: { low: 15, high: 35 },
    maxHoursPerWeek: 20,
    startupCapitalUsd: 200,
    requirements: ["age-18", "can-leave-home", "smartphone"],
    helpfulSkills: ["baking", "food photography"],
    platforms: ["Pre-orders through Instagram and local Facebook groups", "Farmers' markets (stall fees vary)", "Local coffee shops on consignment"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "A Cottage Food Operator permit from the NJ Department of Health is required before the first sale ($100 for two years, a food-protection course, and labelling rules). Gross sales are capped at $50,000 a year and must be direct to the consumer; no wholesale, no third-party delivery apps.",
        verifyAt: "https://www.nj.gov/health/ceohs/food-drug-safety/cottage-food/",
        blocking: true,
      },
      {
        authority: "new-jersey",
        requirement: "Most unprepared food is exempt from NJ sales tax; candy and some prepared items are not. Register with NJ-REG regardless, since you are in business.",
        verifyAt: "https://www.nj.gov/treasury/taxation/",
        blocking: false,
      },
    ],
    ethics: ["Permitted, labelled, made in a clean kitchen. The law exists so that this is legitimate."],
    risks: ["Allergen labelling mistakes. Pricing too low because ingredients feel cheap; include your hours."],
  },

  // -------------------------------------------------------------- freelance
  {
    id: "tutoring",
    name: "Tutoring",
    category: "freelance",
    description:
      "Math, SAT/ACT, chemistry, Spanish, coding, reading. New Jersey parents pay among the highest tutoring rates in the country, and the school year is the season. Online platforms pay slower and take 25%; a parents' group and a clear offer ('Algebra I, $45/hr, your kitchen table or Zoom') pays this week.",
    online: true,
    timeToFirstDollarDays: 4,
    hourlyUsd: { low: 25, high: 65 },
    maxHoursPerWeek: 20,
    startupCapitalUsd: 0,
    requirements: ["age-18", "computer", "internet"],
    helpfulSkills: ["a subject you can teach", "patience", "teaching"],
    platforms: ["Wyzant", "Varsity Tutors", "Preply (languages)", "Town parents' Facebook groups", "Local library noticeboard", "Flyers at the high school's neighbouring coffee shop"],
    compliance: [
      {
        authority: "new-jersey",
        requirement: "Tutoring is not a taxable service in NJ and needs no licence. Working with minors, get a background check done through a platform or offer one; parents ask.",
        blocking: false,
      },
      {
        authority: "federal",
        requirement: "Schedule C income; the tax reserve applies.",
        blocking: false,
      },
    ],
    ethics: ["You teach; the student does the work. Never do the homework for them."],
    risks: ["Demand collapses in July. Summer is for SAT prep and enrichment."],
  },
  {
    id: "freelance-services",
    name: "Freelance skilled work online",
    category: "freelance",
    description:
      "Writing, editing, résumés, graphic design, bookkeeping, spreadsheets, data entry, web fixes, video editing, translation, voice-over. Online marketplaces are slow to the first client and quick after; a direct offer to local small businesses ('I will fix your Google Business profile and menu for $150 by Friday') is faster. Good once the first week is covered, because payouts lag a week.",
    online: true,
    timeToFirstDollarDays: 7,
    hourlyUsd: { low: 20, high: 75 },
    maxHoursPerWeek: 30,
    startupCapitalUsd: 0,
    requirements: ["age-18", "computer", "internet", "bank-account"],
    helpfulSkills: ["writing", "design", "bookkeeping", "software", "video editing", "a second language", "sales"],
    platforms: ["Upwork (payouts about 10 days after the first billing)", "Fiverr", "Contra", "LinkedIn and direct outreach to local businesses", "Local chamber of commerce"],
    compliance: [
      {
        authority: "new-jersey",
        requirement:
          "Most professional services are not taxable in NJ; information services and some digital products are. Check your specific service before invoicing. No licence is needed for any of the work listed.",
        verifyAt: "https://www.nj.gov/treasury/taxation/",
        blocking: false,
      },
      {
        authority: "federal",
        requirement: "Schedule C income. Upwork and Fiverr report to the IRS; direct clients may send a 1099-NEC at $600+. All of it is reportable.",
        blocking: false,
      },
    ],
    ethics: ["Deliver what you sold, on time, with your own work. Disclose AI assistance if the client asks; never pass off copied work."],
    risks: ["Racing to the bottom on price. Quote per project with a clear scope, not per hour."],
  },
  {
    id: "notary",
    name: "Notary public and loan signing agent",
    category: "freelance",
    description:
      "A New Jersey notary commission costs $25 plus a short course and exam and takes several weeks; once held, mobile notarisation pays $25-75 a visit and loan signings $75-200. New Jersey also permits remote online notarisation. Not a first-week play; a good sixty-day one.",
    online: true,
    timeToFirstDollarDays: 45,
    hourlyUsd: { low: 25, high: 60 },
    maxHoursPerWeek: 15,
    startupCapitalUsd: 150,
    requirements: ["age-18", "computer", "internet", "can-leave-home"],
    helpfulSkills: ["attention to detail", "a car"],
    platforms: ["NJ Division of Revenue notary application", "National Notary Association (signing-agent certification)", "Snapdocs and Notary Café (signing work)"],
    compliance: [
      {
        authority: "new-jersey",
        requirement: "Commission through the NJ Division of Revenue and Enterprise Services; a six-hour course and exam are required since 2021, and the commission runs five years. Fees you may charge are capped by statute.",
        verifyAt: "https://www.nj.gov/treasury/revenue/notarypublic.shtml",
        blocking: true,
      },
    ],
    ethics: ["A public office with a statutory duty to verify identity. Never notarise what you did not witness."],
    risks: ["Slow to start. The certification cost is real; do it only if the steadier plays are running."],
  },

  // ------------------------------------------------------------- micro task
  {
    id: "micro-tasks",
    name: "Paid online tasks, testing and data work",
    category: "micro-task",
    description:
      "Website usability tests ($10 for ten minutes), academic surveys, transcription, and AI training-data annotation. Starts tonight and pays within days, but the ceiling is low and the supply of work is uneven. The right use is filling the hours when nothing better is available, not the core of the plan.",
    online: true,
    timeToFirstDollarDays: 2,
    hourlyUsd: { low: 6, high: 22 },
    maxHoursPerWeek: 15,
    startupCapitalUsd: 0,
    requirements: ["age-18", "computer", "internet", "bank-account"],
    helpfulSkills: ["fast typing", "writing", "a second language"],
    platforms: [
      "UserTesting and Userlytics (usability tests)",
      "Prolific (academic studies, about $8-12/hr)",
      "DataAnnotation and Outlier (AI training work; assessment required, pays best)",
      "Rev and TranscribeMe (transcription)",
      "Amazon Mechanical Turk",
    ],
    compliance: [
      {
        authority: "federal",
        requirement: "Self-employment income, usually paid through PayPal; reportable whether or not a 1099 arrives.",
        blocking: false,
      },
      {
        authority: "platform",
        requirement: "One account per person, your own answers, your own work. Using multiple accounts or automation gets you banned and is fraud against the platform.",
        blocking: false,
      },
    ],
    ethics: ["Honest answers and honest work. The research depends on it."],
    risks: ["Hours spent qualifying for studies that reject you. Cap it at two hours a day."],
  },

  // ---------------------------------------------------------------- research
  {
    id: "paid-research",
    name: "Focus groups and paid research interviews",
    category: "research",
    description:
      "Market-research facilities in north Jersey and online research platforms pay $75-250 for one to two hours of honest opinion. Lumpy and not repeatable daily, but nothing else pays this per hour with no skill required. Sign up for every panel on day one and take what comes.",
    online: true,
    timeToFirstDollarDays: 7,
    hourlyUsd: { low: 50, high: 150 },
    maxHoursPerWeek: 4,
    startupCapitalUsd: 0,
    requirements: ["age-18", "internet"],
    helpfulSkills: [],
    platforms: ["Respondent.io", "User Interviews", "Schlesinger Group and Fieldwork (NJ facilities)", "Focus Groups of America", "Local university psychology and business school participant pools"],
    compliance: [
      {
        authority: "federal",
        requirement: "Incentives are taxable income; facilities issue a 1099 above $600.",
        blocking: false,
      },
      {
        authority: "platform",
        requirement: "Screeners must be answered truthfully. Misrepresenting yourself to qualify is fraud and gets you banned from every panel.",
        blocking: false,
      },
    ],
    ethics: ["They want your real opinion. Give it."],
    risks: ["Qualifying is a numbers game. Many screeners, few sessions."],
  },
  {
    id: "plasma-donation",
    name: "Plasma donation",
    category: "research",
    description:
      "FDA-regulated centres pay for the time it takes to donate plasma, which becomes medicines for immune disorders and trauma care. Up to twice in seven days; new-donor bonuses in the first month are often several hundred dollars. Not for everyone, and the centre's medical screening decides, but it is legal, useful, and pays today.",
    online: false,
    timeToFirstDollarDays: 0,
    hourlyUsd: { low: 25, high: 60 },
    maxHoursPerWeek: 5,
    startupCapitalUsd: 0,
    requirements: ["age-18", "can-leave-home"],
    helpfulSkills: [],
    platforms: ["CSL Plasma, BioLife, Grifols and Octapharma centres in New Jersey (check current new-donor offers)"],
    compliance: [
      {
        authority: "federal",
        requirement: "FDA rules: at least 48 hours between donations, no more than twice in seven days, weight over 110 lb, health screening every visit. Bring ID, proof of address and your Social Security number.",
        verifyAt: "https://www.fda.gov/vaccines-blood-biologics/",
        blocking: true,
      },
      {
        authority: "federal",
        requirement: "Compensation is taxable income.",
        blocking: false,
      },
    ],
    ethics: ["The plasma is needed and the compensation is for your time. Hydrate, eat, and stop if you feel unwell."],
    risks: ["Fatigue and bruising. Do not schedule physical work for the same afternoon."],
  },
  {
    id: "clinical-trials",
    name: "Paid clinical studies",
    category: "research",
    description:
      "University hospitals and research sites in New Jersey compensate healthy volunteers for studies, from a $50 blood draw to multi-day inpatient stays paying thousands. Every study has an ethics board, informed consent, and the right to withdraw. Worth knowing about; never worth doing without reading the consent form twice.",
    online: false,
    timeToFirstDollarDays: 21,
    hourlyUsd: { low: 15, high: 100 },
    maxHoursPerWeek: 10,
    startupCapitalUsd: 0,
    requirements: ["age-18", "can-leave-home"],
    helpfulSkills: [],
    platforms: ["ClinicalTrials.gov (filter: recruiting, New Jersey, healthy volunteers)", "Rutgers, Hackensack Meridian and RWJBarnabas research offices", "CenterWatch"],
    compliance: [
      {
        authority: "federal",
        requirement: "IRB-approved informed consent is required by law. You can leave at any time. Compensation is taxable.",
        verifyAt: "https://www.hhs.gov/ohrp/",
        blocking: true,
      },
    ],
    ethics: ["Regulated, consented, and how medicine gets tested. Your choice alone, made with the full consent form in hand."],
    risks: ["Real medical risk in drug studies. Prefer observational and device studies; ask what phase and what is known."],
  },
];

export function findPlay(id: string): IncomePlay | undefined {
  return PLAYS.find((p) => p.id === id);
}

export function playsByCategory(category: IncomePlay["category"]): IncomePlay[] {
  return PLAYS.filter((p) => p.category === category);
}
