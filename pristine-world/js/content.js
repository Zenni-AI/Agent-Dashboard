// All site copy lives here. Swap the placeholder copy for real details
// (service areas, pricing notes, founder story) without touching the 3D code.

export const BRAND = { name: 'Pristine', full: 'Pristine Home Services' };

// Caption shown for each camera view.
export const CAPTIONS = {
  garage: {
    kicker: 'Pristine Home Services',
    title: 'Step into the garage.',
    sub: 'Everything we do lives in here. Walk up to the car, the tool wall, the web in the corner, or the photo on the back wall.',
  },
  services: {
    kicker: 'Services wall',
    title: 'Grab a tool.',
    sub: 'Every tool on this wall is a service we run. The bin by the door leads to the dumpster, which holds the full list.',
  },
  dumpster: {
    kicker: 'Services · the full catalog',
    title: 'Everything we do is in the dumpster.',
    sub: 'Pull anything out of the pile to see that service.',
  },
  solar: {
    kicker: 'Featured · Solar',
    title: 'Run the whole house on the sun.',
    sub: 'Our flagship service. Check the battery wall, the charger and the meter, or walk up to the car.',
    cta: { label: 'Get my solar quote', do: 'quote:Solar' },
  },
  network: {
    kicker: 'Pristine Home Services Network',
    title: 'One call. A whole web of trusted pros.',
    sub: 'Click a strand to learn how it works, join as a homeowner, or partner with us as a pro.',
  },
  about: {
    kicker: 'About us',
    title: 'The real part.',
    sub: 'Look closer. Click the people, the truck, or the laptop on the tailgate.',
  },
};

export const SERVICES = [
  'Solar', 'Landscaping', 'Lawn care', 'Pavers & hardscape', 'Junk removal',
  'Cleanouts', 'Pressure washing', 'Gutter cleaning', 'Something else',
];

const Q = (s) => ({ label: `Get a ${s.toLowerCase()} quote`, do: `quote:${s}` });

// Content cards ("work orders"). dept = small header, code = work-order prefix.
export const ITEMS = {
  landscaping: {
    dept: 'Landscaping', code: 'LND',
    title: 'Landscaping',
    lead: 'Beds, edging, mulch, planting and seasonal cleanups that make the whole property look cared for.',
    listLabel: 'On the truck',
    list: ['Planting bed design and install', 'Mulch, stone and edging refresh', 'Spring and fall cleanups', 'Shrub and hedge trimming', 'Storm and branch debris haul-away'],
    actions: [Q('Landscaping')],
  },
  lawn: {
    dept: 'Lawn care', code: 'LWN',
    title: 'Lawn care',
    lead: 'Weekly or bi-weekly mowing with crisp edges and blown-clean walks, on a schedule you never have to think about.',
    listLabel: 'Every visit',
    list: ['Mow, trim, edge and blow', 'Fertilization and weed-control programs', 'Aeration and overseeding', 'Fall leaf removal'],
    actions: [Q('Lawn care')],
  },
  pavers: {
    dept: 'Hardscape', code: 'HRD',
    title: 'Pavers & hardscape',
    lead: 'Patios, walkways, driveways and fire-pit areas, built on a compacted base so they stay flat for years.',
    listLabel: 'What we build',
    list: ['Patios and walkways', 'Paver driveways', 'Retaining and seat walls', 'Paver cleaning, re-sanding and sealing', 'Fire pits and outdoor living areas'],
    actions: [Q('Pavers & hardscape')],
  },
  junk: {
    dept: 'Junk removal', code: 'JNK',
    title: 'Junk removal',
    lead: 'Point at it and it’s gone. We load, haul and sort for donation and recycling before anything goes to a landfill.',
    listLabel: 'We take',
    list: ['Furniture, mattresses and appliances', 'Yard waste and construction debris', 'Hot tubs and sheds (demo and haul)', 'Single items or full truckloads'],
    actions: [Q('Junk removal')],
  },
  cleanouts: {
    dept: 'Cleanouts', code: 'CLN',
    title: 'Cleanouts',
    lead: 'Garages, basements, attics and full estate cleanouts, start to finish, with a crew that is careful with what stays.',
    listLabel: 'How it goes',
    list: ['Walkthrough and flat quote', 'Sort: keep, donate, recycle, haul', 'Broom-clean finish', 'Before and after photos'],
    actions: [Q('Cleanouts')],
  },
  washing: {
    dept: 'Exterior cleaning', code: 'PWS',
    title: 'Pressure washing',
    lead: 'House washes, driveways, patios, decks and fences. Soft wash for siding and roofs, pressure for concrete.',
    listLabel: 'Surfaces',
    list: ['Siding soft wash', 'Driveways and walkways', 'Decks, fences and patios', 'Paver cleaning before sealing'],
    actions: [Q('Pressure washing')],
  },
  gutters: {
    dept: 'Exterior care', code: 'GTR',
    title: 'Gutter cleaning',
    lead: 'Hand-cleaned gutters, flushed downspouts, and a photo report of anything that needs attention.',
    listLabel: 'Included',
    list: ['Debris removed by hand and bagged', 'Downspouts flushed and tested', 'Loose hangers flagged', 'Photo report after every visit'],
    actions: [Q('Gutter cleaning')],
  },
  'solar-svc': {
    dept: 'Featured', code: 'SOL', stamp: 'Featured',
    title: 'Solar',
    lead: 'Solar is our featured service. The full setup is parked in the middle of the garage.',
    actions: [{ label: 'Walk to the solar bay', do: 'go:solar' }, Q('Solar')],
  },
  'solar-how': {
    dept: 'Solar', code: 'SOL', stamp: 'Featured',
    title: 'How Pristine Solar works',
    lead: 'Panels on the roof, a battery on the wall, and one crew handling it from the first roof check to the day the utility flips you on.',
    steps: ['Free roof and energy-bill review', 'Custom panel layout and savings estimate', 'Permits, install and utility hookup handled by us', 'Monitoring from your phone after install'],
    actions: [Q('Solar')],
  },
  'solar-ev': {
    dept: 'Solar', code: 'SOL',
    title: 'Charge on sunshine',
    lead: 'Pair panels with a Level 2 charger and fill the car from your own roof. We size the circuit, pull the permit and mount it clean.',
    listLabel: 'Included',
    list: ['Load check on your electrical panel', 'Level 2 charger install', 'Scheduling to charge from solar first', 'Clean conduit runs, no loose cords'],
    actions: [Q('Solar')],
  },
  'solar-savings': {
    dept: 'Solar', code: 'SOL',
    title: 'Savings & net metering',
    lead: 'Power you make and don’t use can be credited by your utility. We walk through your actual bills before you commit, so the numbers are yours, not a sales sheet.',
    listLabel: 'We cover',
    list: ['Your last 12 months of usage', 'Utility net-metering rules where you live', 'Available incentives and credits', 'Payback timeline in plain numbers'],
    actions: [Q('Solar')],
  },
  'solar-quote': {
    dept: 'Solar', code: 'SOL', stamp: 'Featured',
    title: 'Get your solar quote',
    lead: 'Tell us where the house is. We pull satellite roof data, review your bills and come back with a layout and a price.',
    form: 'quote', service: 'Solar',
  },
  'net-mission': {
    dept: 'Network', code: 'NET',
    title: 'Our mission',
    lead: 'Every homeowner deserves one number to call and a crew they trust. The Pristine Home Services Network links vetted local pros so one relationship covers the whole house.',
    listLabel: 'What we hold every job to',
    list: ['Show up when promised', 'Clear prices before work starts', 'Leave it cleaner than we found it', 'Stand behind the work'],
    actions: [{ label: 'Join the network', do: 'item:net-join' }, { label: 'Become a partner', do: 'item:net-partner' }],
  },
  'net-learn': {
    dept: 'Network', code: 'NET',
    title: 'How the network works',
    lead: 'You call Pristine. We handle it in-house or send a vetted partner, and we stay on the job until it’s done right.',
    steps: ['Tell us what the house needs', 'We match the right crew, ours or a partner’s', 'One schedule, one point of contact', 'We check the work before we call it done'],
    actions: [{ label: 'Join the network', do: 'item:net-join' }],
  },
  'net-join': {
    dept: 'Network · Homeowners', code: 'NET',
    title: 'Join the network',
    lead: 'Membership puts your home on our schedule: priority booking, seasonal check-ins, and member pricing across partner trades.',
    form: 'join',
  },
  'net-partner': {
    dept: 'Network · Pros', code: 'NET',
    title: 'Become a partner',
    lead: 'Run a quality trade business? Partners get steady referred work, shared marketing, and the Pristine name behind them.',
    listLabel: 'What we look for',
    list: ['Licensed and insured', 'Reviews we can verify', 'Clear pricing and communication', 'Crews that show up when promised'],
    form: 'partner',
  },
  'about-founders': {
    dept: 'About us', code: 'ABT',
    title: 'Joe & Pat',
    lead: 'Two guys, one truck, and one standard: leave every property better than we found it. That standard is still the whole business.',
    listLabel: 'How we run it',
    list: ['We answer our own phones', 'Every crew uses the same checklist', 'Photo report after every job', 'If it’s not right, we come back'],
    actions: [{ label: 'Read our playbook', do: 'item:about-portal' }],
  },
  'about-truck': {
    dept: 'About us', code: 'ABT',
    title: 'The Pristine truck',
    lead: 'When this truck is in your driveway, the job is handled. Every crew rolls with the same gear, the same checklist and the same standard.',
    listLabel: 'Every truck carries',
    list: ['Uniformed, background-checked crew', 'Drop cloths, tarps and shop vacs', 'Clean-up as part of the job', 'A way to take your junk with us'],
    actions: [{ label: 'Book the truck', do: 'quote:Something else' }],
  },
  'about-portal': {
    dept: 'Learning portal', code: 'EDU',
    title: 'The Pristine learning portal',
    lead: 'Free guides from the field. Pick one and we’ll send it over.',
    ebooks: [
      { title: 'The Pristine Homeowner’s Playbook', blurb: 'A season-by-season checklist for keeping a house in shape.', color: '#1f4e8c' },
      { title: 'Solar Without the Sales Pitch', blurb: 'How to read a solar quote and the questions to ask.', color: '#c1121f' },
      { title: 'Curb Appeal on a Budget', blurb: 'Pavers, beds and edging that add the most for the least.', color: '#3d7a4a' },
      { title: 'The Network Partner Guide', blurb: 'How trade pros grow with the Pristine network.', color: '#6b4a2b' },
    ],
  },
  quote: {
    dept: 'Quote request', code: 'QTE',
    title: 'Get a quote',
    lead: 'Tell us what the house needs. We reply with a price, not a runaround.',
    form: 'quote',
  },
};
