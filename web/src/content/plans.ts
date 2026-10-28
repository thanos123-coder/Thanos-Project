export type BillingId = "monthly" | "yearly" | "fouryear";

export const billingOptions: { id: BillingId; label: string; note: string }[] = [
  { id: "monthly", label: "Monthly", note: "Pay as you go" },
  { id: "yearly", label: "Yearly", note: "Save 30%" },
  { id: "fouryear", label: "4 years", note: "Half price" },
];

type Price = {
  perMonth: number;
  billed: number;
  billedNote: string;
  save?: string;
};

export type Plan = {
  id: "free" | "basic" | "plus" | "pro";
  name: string;
  for: string;
  badge?: string;
  current?: boolean;
  cta: string;
  prices?: Record<BillingId, Price>;
  features: string[];
  ai: string;
};

export const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    for: "For exploring, in any grade",
    cta: "Start free",
    features: [
      "Ask Upchance: 3 messages a day",
      "Every planning tool: deadlines, requirements and a course plan",
      "University matching and comparisons",
      "Volunteering directory for 250 countries",
      "Guides for visas, ΔΟΑΤΑΠ, military deferment and results day",
    ],
    ai: "AI level: fast model for Ask Upchance; other tools run on code",
  },
  {
    id: "basic",
    name: "Basic",
    for: "For getting started with AI help",
    cta: "Choose Basic",
    prices: {
      monthly: { perMonth: 9.99, billed: 9.99, billedNote: "Then $9.99 plus tax every month. Cancel anytime." },
      yearly: {
        perMonth: 7.0,
        billed: 83.99,
        billedNote: "One payment for 12 months. Renews yearly; cancel anytime.",
        save: "You save $35.89 a year",
      },
      fouryear: {
        perMonth: 5.0,
        billed: 239.99,
        billedNote: "One payment for all 4 years. Nothing more to pay.",
        save: "You save $239.53 over 4 years",
      },
    },
    features: [
      "Ask Upchance: 20 messages a day*",
      "AI answers and explanations",
      "Essay story interview and coaching questions",
      "2 full essay reviews a month",
      "10 research checks a month",
      "Transcript reading and SAT and ACT explanations",
    ],
    ai: "AI level: fast and advanced models",
  },
  {
    id: "plus",
    name: "Plus",
    badge: "Best for applying this year",
    for: "For applying this year",
    cta: "Choose Plus",
    prices: {
      monthly: { perMonth: 24.99, billed: 24.99, billedNote: "Then $24.99 plus tax every month. Cancel anytime." },
      yearly: {
        perMonth: 17.5,
        billed: 209.99,
        billedNote: "One payment for 12 months. Renews yearly; cancel anytime.",
        save: "You save $89.89 a year",
      },
      fouryear: {
        perMonth: 12.5,
        billed: 599.99,
        billedNote: "One payment for all 4 years. Nothing more to pay.",
        save: "You save $599.53 over 4 years",
      },
    },
    features: [
      "Ask Upchance: 40 messages a day*",
      "Everything in Basic, on stronger models",
      "8 essay reviews and 4 re-examinations a month",
      "Admissions-reader and scholarship-panel reads",
      "3 mock interviews with feedback and 20 voice minutes",
      "Oxbridge tutorial and MMI practice",
    ],
    ai: "AI level: up to our expert model",
  },
  {
    id: "pro",
    name: "Pro",
    for: "For competitive applications to many universities",
    current: true,
    cta: "Current plan",
    prices: {
      monthly: { perMonth: 59.99, billed: 59.99, billedNote: "Then $59.99 plus tax every month. Cancel anytime." },
      yearly: {
        perMonth: 42.0,
        billed: 503.99,
        billedNote: "One payment for 12 months. Renews yearly; cancel anytime.",
        save: "You save $215.89 a year",
      },
      fouryear: {
        perMonth: 30.0,
        billed: 1439.99,
        billedNote: "One payment for all 4 years. Nothing more to pay.",
        save: "You save $1,439.53 over 4 years",
      },
    },
    features: [
      "Ask Upchance: unlimited messages*",
      "A stronger model on every task",
      "20 essay reviews and 8 final reads on our highest model a month",
      "50 research checks a month",
      "8 mock interviews and 60 voice minutes",
      "A parent seat with a progress digest",
    ],
    ai: "AI level: up to our highest model",
  },
];

export const fairUseNote =
  "* Ask Upchance uses a range of AI models, from our most advanced to faster ones. Unlimited messages are subject to our fair-use policy.";

export const trustPoints = [
  "Cancel anytime",
  "Your price in your currency, tax shown up front",
  "You write every word of your essays",
  "Secure checkout",
];

type Cell = boolean | string;
export type CompareRow = { label: string; note?: string; cells: [Cell, Cell, Cell, Cell] };
export type CompareGroup = { title: string; rows: CompareRow[] };

const all: [Cell, Cell, Cell, Cell] = [true, true, true, true];

export const compareIntro =
  "Every plan includes the full set of planning tools and guides. Paid plans add AI help, and higher plans use stronger models for the same tasks.";

export const compareGroups: CompareGroup[] = [
  {
    title: "Planning tools",
    rows: [
      { label: "Deadlines, timeline and reminders", cells: all },
      { label: "Requirement checks against official rules", cells: all },
      { label: "Course and test plan", cells: all },
      { label: "University matching, degree and campus comparisons", cells: all },
      { label: "Activity log and brag sheet", cells: all },
      { label: "Volunteering directory for 250 countries", cells: all },
      { label: "Several specialists working on one question", cells: all },
    ],
  },
  {
    title: "Guides",
    rows: [
      { label: "Student visas and what to do before you arrive", cells: all },
      { label: "Degree recognition in Greece (ΔΟΑΤΑΠ)", cells: all },
      { label: "Military service deferment", cells: all },
      { label: "Access arrangements for tests", cells: all },
      { label: "Results day and Clearing", cells: all },
      { label: "Panhellenic points and Μηχανογραφικό check", cells: all },
    ],
  },
  {
    title: "AI counsellor",
    rows: [
      {
        label: "Ask Upchance, the admissions chat",
        note: "Messages reset every day.",
        cells: ["3 messages a day", "20 messages a day*", "40 messages a day*", "Unlimited messages*"],
      },
      { label: "AI answers and explanations", cells: [false, true, true, true] },
      {
        label: "AI actions a month",
        note: "Fair use: past this, tasks move to a lighter model instead of stopping",
        cells: [false, "About 170", "About 450", "About 800"],
      },
      { label: "Answers planned and combined by a model", cells: [false, false, true, true] },
      { label: "Translations and a parent explainer", cells: [false, true, true, true] },
    ],
  },
  {
    title: "Writing",
    rows: [
      { label: "Essay story interview and coaching questions", cells: [false, true, true, true] },
      { label: "Full essay reviews", cells: [false, "2 a month", "8 a month", "20 a month"] },
      { label: "Essay AI scan, private in your browser", cells: all },
      { label: "Re-examinations of revised essays", cells: [false, false, "4 a month", "8 a month"] },
      { label: "Admissions-reader and scholarship-panel reads", cells: [false, false, "6 a month", "15 a month"] },
      {
        label: "You write every word",
        note: "Coaching and feedback only, under each university’s AI policy",
        cells: all,
      },
    ],
  },
  {
    title: "Research",
    rows: [
      { label: "Opportunity and official-source research", cells: [false, "10 a month", "25 a month", "50 a month"] },
      { label: "Transcript and document reading", cells: [false, "2 a month", "5 a month", "9 a month"] },
      { label: "SAT and ACT mistake explanations", cells: [false, "8 a month", "20 a month", "40 a month"] },
    ],
  },
  {
    title: "Interviews",
    rows: [
      { label: "Mock interviews with analysis and feedback", cells: [false, false, "3 a month", "8 a month"] },
      { label: "Oxbridge tutorial and MMI practice", cells: [false, false, true, true] },
      { label: "Voice practice", cells: [false, false, "20 minutes a month", "60 minutes a month"] },
    ],
  },
  {
    title: "AI level",
    rows: [
      { label: "Everyday answers", cells: [false, "Fast model", "Fast model", "Advanced model"] },
      { label: "Reading and research", cells: [false, "Advanced model", "Advanced model", "Expert model"] },
      { label: "Essays and interviews", cells: [false, "Advanced model", "Expert model", "Expert model, thinks longer"] },
      { label: "Final essay reads", cells: [false, false, "Expert model", "Highest model"] },
    ],
  },
  {
    title: "Family and support",
    rows: [
      { label: "Parent seat with a progress digest", cells: [false, false, false, true] },
      { label: "Priority processing", cells: [false, false, false, true] },
    ],
  },
];

/**
 * Sample currencies for the "Prices for" picker. Amounts are converted with these sample rates for the
 * design only; replace with the live price list (exchange rates from October 2, 2026, reviewed monthly).
 */
export const priceRegions = [
  { id: "none", label: "No location set", currency: "USD", currencyName: "US dollars", rate: 1 },
  { id: "us", label: "United States", currency: "USD", currencyName: "US dollars", rate: 1 },
  { id: "gr", label: "Greece", currency: "EUR", currencyName: "euros", rate: 0.92 },
  { id: "cy", label: "Cyprus", currency: "EUR", currencyName: "euros", rate: 0.92 },
  { id: "gb", label: "United Kingdom", currency: "GBP", currencyName: "pounds", rate: 0.78 },
  { id: "de", label: "Germany", currency: "EUR", currencyName: "euros", rate: 0.92 },
  { id: "nl", label: "Netherlands", currency: "EUR", currencyName: "euros", rate: 0.92 },
  { id: "it", label: "Italy", currency: "EUR", currencyName: "euros", rate: 0.92 },
  { id: "fr", label: "France", currency: "EUR", currencyName: "euros", rate: 0.92 },
  { id: "ch", label: "Switzerland", currency: "CHF", currencyName: "Swiss francs", rate: 0.86 },
  { id: "ca", label: "Canada", currency: "CAD", currencyName: "Canadian dollars", rate: 1.37 },
  { id: "sg", label: "Singapore", currency: "SGD", currencyName: "Singapore dollars", rate: 1.3 },
  { id: "ae", label: "United Arab Emirates", currency: "AED", currencyName: "dirhams", rate: 3.67 },
  { id: "in", label: "India", currency: "INR", currencyName: "rupees", rate: 84 },
  { id: "cn", label: "China", currency: "CNY", currencyName: "yuan", rate: 7.2 },
] as const;

export type PriceRegion = (typeof priceRegions)[number];

export const plansFaq = [
  {
    topic: "Your price",
    q: "Why is my price different from the US price?",
    a: "Prices are set for each country and shown in your currency, before tax. They use exchange rates from October 2, 2026 and are reviewed monthly, so your price can differ from the US price.",
  },
  {
    topic: "Going over",
    q: "What happens if I use more than my plan includes?",
    a: "Nothing stops. Past your plan’s AI actions for the month, tasks move to a lighter model instead of stopping, under our fair-use policy. Chat messages reset every day.",
  },
  {
    topic: "Essays",
    q: "Does Upchance write my essays?",
    a: "No. You write every word. Upchance gives coaching and feedback only, under each university’s AI policy.",
  },
  {
    topic: "Today",
    q: "What am I charged today?",
    a: "Exactly what your plan shows under ‘Billed today’, plus tax: one month on Monthly, twelve months on Yearly, and all four years on the 4-year plan. Tax is shown up front, before you pay.",
  },
  {
    topic: "Cancelling",
    q: "How do I cancel?",
    a: "Cancel anytime with Cancel subscription, at the foot of every page.",
  },
  {
    topic: "AI level",
    q: "Which level of AI does each plan use?",
    a: "Free uses a fast model for Ask Upchance, and its other tools run on code. Basic uses fast and advanced models, Plus goes up to our expert model and Pro up to our highest model. Higher plans use stronger models for the same tasks.",
  },
  {
    topic: "Schools",
    q: "Can my school get Upchance for all its students?",
    a: "Yes. Fill out the form for schools and we’ll get back to you.",
  },
];
