export const stats = {
  heading: "What Upchance knows",
  tiles: [
    { figure: 100, suffix: "", caption: "universities with chance estimates, in 9 countries" },
    { figure: 1600, suffix: "", caption: "universities with admissions facts Upchance knows" },
    { figure: 9, suffix: "", caption: "school systems, from the IB to the Gaokao" },
  ],
};

export type FeatureId = "chances" | "ask" | "essays" | "interviews" | "log" | "memory";

export const features: {
  id: FeatureId;
  title: string;
  sentence: string;
  consequence: string;
  link: { href: string; label: string };
  field: "cobalt" | "ink" | "tint";
  on: boolean;
}[] = [
  {
    id: "chances",
    title: "Your chances, honestly",
    sentence: "See your chances as honest ranges.",
    consequence:
      "A realistic range for every university on your list, and what would move it. 100 universities in 9 countries.",
    link: { href: "/chances", label: "See your chances" },
    field: "cobalt",
    on: true,
  },
  {
    id: "ask",
    title: "Ask anything about admissions",
    sentence: "Ask anything about admissions.",
    consequence:
      "Programmes, grades, deadlines, scholarships: clear answers that know your goals. 3 messages a day free, unlimited on Pro.",
    link: { href: "/ask", label: "Try Ask Upchance" },
    field: "ink",
    on: false,
  },
  {
    id: "essays",
    title: "Essays that sound like you",
    sentence: "Get notes like an admissions reader’s.",
    consequence: "Feedback like an admissions reader’s. The writing stays yours. Up to 20 full reviews a month.",
    link: { href: "/essays", label: "Get feedback" },
    field: "tint",
    on: true,
  },
  {
    id: "interviews",
    title: "Interviews, out loud",
    sentence: "Practise your interviews out loud.",
    consequence:
      "Spoken mock interviews for Oxbridge, medicine and US alumni rounds. Up to 8 a month, with 60 voice minutes.",
    link: { href: "/interviews", label: "Practise" },
    field: "cobalt",
    on: false,
  },
  {
    id: "log",
    title: "Your log, always ready",
    sentence: "Keep your log always ready.",
    consequence: "Activities, awards and grades in one place. Your chances follow it.",
    link: { href: "/log", label: "Open your log" },
    field: "ink",
    on: false,
  },
  {
    id: "memory",
    title: "It remembers you",
    sentence: "Tell it once. It remembers you.",
    consequence: "Every part of Upchance uses what you tell it. You stay in control.",
    link: { href: "/ask", label: "Start a chat" },
    field: "tint",
    on: false,
  },
];

export const steps = [
  {
    name: "Take the free assessment",
    text: "A few questions about your grades, activities and dream universities.",
  },
  {
    name: "See where you stand",
    text: "A realistic range for each university, and what would raise it.",
  },
  {
    name: "Raise your chances",
    text: "Essays, interviews, activities and next steps, one at a time.",
  },
];

export const trust = {
  heading: "Honest, safe and private",
  intro: "What students and parents should know before they start.",
  tiles: [
    {
      title: "Honest, not hopeful",
      text: "Ranges, not promises, built from published admission figures, with what would move each one.",
      link: { href: "/chances#how-we-estimate", label: "How we estimate" },
    },
    {
      title: "Safe for teenagers",
      text: "For students aged 13 and over, with a parent’s approval where the law requires it. No ads, and careful answers on wellbeing.",
      link: { href: "/privacy", label: "Privacy Policy" },
    },
    {
      title: "Your data stays yours",
      text: "See or delete what Upchance remembers, pause its memory, and export or delete your account at any time.",
      link: { href: "/ai-notice", label: "AI Notice" },
    },
    { title: "0 ads", text: "And we never sell your data." },
    { title: "You write every word", text: "Coaching and feedback only, under each university’s AI policy." },
    {
      title: "Private in your browser",
      text: "The essay AI scan runs in your browser, and in interviews Upchance receives only the text of what you say, never a recording.",
    },
  ],
};

export const pricingTeaser = {
  free: {
    name: "Start free",
    sentence: "For exploring, in any grade. No card needed, ever.",
    included: [
      "The free assessment and your first results",
      "3 chat messages a day with Ask Upchance",
      "The AI scan for your essays",
      "Your log and what Upchance remembers",
    ],
    price: "Free",
    cta: { href: "/assessment", label: "Start free" },
  },
  paid: {
    name: "Upgrade when you’re ready",
    sentence: "Paid plans add every result, more chat, essay feedback and mock interviews.",
    included: "Basic, Plus and Pro, monthly, yearly or for all 4 years, with tax shown up front and cancel anytime.",
    price: 9.99,
    cta: { href: "/plans", label: "Compare plans" },
  },
};

export const homeFaq = [
  {
    topic: "Price",
    q: "Is Upchance free?",
    a: "Yes, to start. The free assessment and your first results, 3 chat messages a day with Ask Upchance, the AI scan for your essays, and your log are free, with no card needed. Paid plans add every result, more chat, essay feedback and mock interviews.",
  },
  {
    topic: "Accuracy",
    q: "How accurate are the chances?",
    a: "Each estimate starts from the university’s published admission or offer rate, then compares your grades, tests and activities with the students it admits. Essays, references and interviews still change things, so you see a range, not a promise.",
  },
  {
    topic: "Coverage",
    q: "Which universities and countries are covered?",
    a: "Chance estimates cover 100 universities in 9 countries: the United Kingdom, the United States, Canada, the Netherlands, Germany, Switzerland, Italy, Singapore and the United Arab Emirates. Upchance knows admissions facts for 1,600 universities.",
  },
  {
    topic: "Systems",
    q: "Which school systems does it understand?",
    a: "Nine, from the IB to the Gaokao: the IB Diploma, A-levels, US high school, the Greek Panhellenic exams, the Gaokao, the Abitur, the Baccalauréat, and CBSE or ISC in India.",
  },
  {
    topic: "Safety",
    q: "Is it safe for teenagers?",
    a: "Upchance is for students aged 13 and over, with a parent’s approval where the law requires it. There are no ads, and answers about wellbeing are careful.",
  },
  {
    topic: "Essays",
    q: "Will it write my essays for me?",
    a: "No. You write every word. Upchance coaches with questions and gives feedback, under each university’s AI policy, and never rewrites your words.",
  },
  {
    topic: "Your data",
    q: "Can I delete my data?",
    a: "Yes. See or delete what Upchance remembers, pause its memory, and export or delete your account at any time. We never sell your data.",
  },
];
