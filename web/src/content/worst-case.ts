import type { ExampleChance } from "./universities";

/**
 * Worst-case content for the dev-only data switch (break-ui, `?data=worst`). Same shapes and ids as the demo
 * content, filled with realistic extremes: the longest real university names, a six-letter code, ranges at
 * both ends of the scale, Greek text, pasted links and long log entries typed by a student. Never used in
 * production.
 */

export const worstDreamUniversities: ExampleChance[] = [
  {
    id: "oxford",
    short: "RWTH",
    name: "Rheinisch-Westfälische Technische Hochschule Aachen",
    country: "Germany",
    low: 1,
    high: 3,
    could: 4,
    mover: "Higher predicted grades, a stronger personal statement and a second competition result would raise this the most.",
  },
  {
    id: "cambridge",
    short: "EPFL",
    name: "École Polytechnique Fédérale de Lausanne",
    country: "Switzerland",
    low: 93,
    high: 99,
    could: 100,
    mover: "Interview practice can move this.",
  },
  {
    id: "imperial",
    short: "MBZUAI",
    name: "Mohamed bin Zayed University of Artificial Intelligence",
    country: "United Arab Emirates",
    low: 47,
    high: 65,
    could: 72,
    offerChance: 100,
    meetingOffer: 7,
    mover: "A strong essay can move this.",
  },
  {
    id: "ucl",
    short: "LMU",
    name: "Ludwig-Maximilians-Universität München",
    country: "Germany",
    low: 64,
    high: 78,
    could: 84,
    offerChance: 90,
    meetingOffer: 69,
    mover: "A strong essay can move this.",
  },
  {
    id: "lse",
    short: "LSE",
    name: "London School of Economics and Political Science",
    country: "United Kingdom",
    note: "This university doesn’t teach engineering, and its nearest course asks for Further Maths at HL. Choose another course to see a range.",
  },
  {
    id: "edinburgh",
    short: "HKUST",
    name: "Hong Kong University of Science and Technology",
    country: "Hong Kong SAR, China",
    low: 79,
    high: 88,
    could: 92,
    offerChance: 94,
    meetingOffer: 84,
    mover: "A strong essay can move this.",
  },
  {
    id: "harvard",
    short: "ΕΜΠ",
    name: "Εθνικό Μετσόβιο Πολυτεχνείο",
    country: "Greece",
    low: 4,
    high: 11,
    could: 14,
    mover: "Μια καλύτερη βαθμολογία στις Πανελλήνιες θα το ανεβάσει περισσότερο.",
  },
  { id: "mit", short: "KTH", name: "KTH", country: "Sweden", low: 5, high: 13, could: 16, mover: "A strong essay can move this." },
  {
    id: "stanford",
    short: "UNAM",
    name: "Universidad Nacional Autónoma de México",
    country: "Mexico",
    low: 4,
    high: 10,
    could: 13,
    mover: "A strong essay can move this.",
  },
  {
    id: "nyu",
    short: "UCLA",
    name: "University of California, Los Angeles",
    country: "United States",
    low: 8,
    high: 26,
    could: 33,
    mover: "Higher predicted grades would raise this the most.",
  },
];

export const worstMoreUniversities: ExampleChance[] = [
  {
    id: "kings",
    short: "KIT",
    name: "Karlsruher Institut für Technologie",
    country: "Germany",
    low: 79,
    high: 88,
    could: 92,
    mover: "A strong essay can move this.",
  },
  {
    id: "tudelft",
    short: "TUM",
    name: "Technische Universität München, TUM School of Computation, Information and Technology",
    country: "Germany",
    note: "More details needed",
  },
];

export const worstResults: ExampleChance[] = ["imperial", "ucl", "edinburgh", "nyu"]
  .map((id) => worstDreamUniversities.find((u) => u.id === id)!)
  .concat(worstMoreUniversities[1]);

export const worstPastChats = [
  "Can you check https://www.imperial.ac.uk/study/courses/undergraduate/2027/electrical-and-electronic-engineering/ and tell me what I still need?",
  "Is a summer programme worth it for my application, or should I spend the six weeks on my extended essay about signal loss in valve radios instead?",
  "Μπορώ να κάνω αίτηση στο Imperial με 18.950 μόρια στις Πανελλήνιες;",
  "UCAT?",
];

export const worstMemoryItems = [
  "Wants to study electrical and electronic engineering, ideally with a year in industry, in the UK or the Netherlands",
  "Predicted 40 in the IB: HL Physics 7, HL Maths Analysis and Approaches 7, HL Chemistry 6",
  "Portfolio at https://github.com/eleni-papadopoulou/radio-archive-digitisation-scripts",
  "Θέλει να σπουδάσει κοντά στην οικογένειά της, αν γίνεται",
  "UCAT",
];

export type WorstLogEntry = {
  id: number;
  kind: "Activity" | "Award" | "Experience";
  title: string;
  role: string;
  when: string;
  hours?: string;
  text: string;
};

export const worstLog: WorstLogEntry[] = [
  {
    id: 1,
    kind: "Activity",
    title: "Founder and President, Thessaloniki Regional Model United Nations and Debating League",
    role: "Founder and president of a league of 14 schools",
    when: "September 2023 to now",
    hours: "12",
    text: "Started the league with two teachers, then grew it to 14 schools and 380 students. I write the motions, train the chairs, run the budget with the parents’ association and find sponsors for the final every spring. Schedule and results: https://thessaloniki-mun-league.example.org/2025-2026/season-results-and-rankings",
  },
  {
    id: 2,
    kind: "Award",
    title: "Gold medal, International Olympiad on Astronomy and Astrophysics (IOAA)",
    role: "International round, top 8% of 312 contestants from 52 countries",
    when: "August 2025",
    text: "",
  },
  {
    id: 3,
    kind: "Experience",
    title: "Research internship",
    role: "Volunteer",
    when: "July to August 2025",
    hours: "40",
    text: "Write-up: https://eleni-papadopoulou.example.org/research/valve-radio-signal-loss-measurements-2025-final-v3.pdf",
  },
  {
    id: 4,
    kind: "Activity",
    title: "Ψηφιοποίηση του αρχείου του ραδιοφωνικού σταθμού του χωριού",
    role: "Μέλος",
    when: "2023 to now",
    hours: "2",
    text: "Ψηφιοποιώ τις ηχογραφήσεις του καιρού που έκανε ο παππούς μου για τους ψαράδες.",
  },
  { id: 5, kind: "Activity", title: "Chess", role: "", when: "", text: "" },
  { id: 6, kind: "Award", title: "Silver, chemistry olympiad", role: "National round", when: "2025", text: "Top 5% of 2,400 entrants." },
  { id: 7, kind: "Activity", title: "Captain, robotics team", role: "Leader", when: "2024 to now", hours: "6", text: "Led a team of 9 to the national final." },
  { id: 8, kind: "Activity", title: "Tutor", role: "Peer tutor", when: "2024", hours: "1", text: "" },
  { id: 9, kind: "Experience", title: "Part-time job, family bakery", role: "Weekends", when: "2022 to now", hours: "10", text: "" },
  { id: 10, kind: "Activity", title: "First violin, school orchestra", role: "Member", when: "2021 to now", hours: "3", text: "" },
  { id: 11, kind: "Award", title: "Honourable mention, European Girls’ Mathematical Olympiad", role: "International round", when: "April 2024", text: "" },
  { id: 12, kind: "Activity", title: "Volunteer, sea turtle nesting survey (ARCHELON)", role: "Volunteer", when: "Summers 2023 to 2025", hours: "15", text: "" },
];

export const worstGrades = { system: "Greek Panhellenic exams" as const, value: 19950 };

export const worstScores = { SAT: "1600", ACT: "36", IELTS: "9.0", TOEFL: "120", UCAT: "3,450 (Band 1, superscored)" };

export const worstEssay = `The first time I took our old radio apart (a 1958 Grundig, model 3088, bought in Thessaloniki by my grandfather), I wasn't trying to fix it. I wanted to know why his voice sounded different through it.

He recorded the weather for the fishermen in our village every morning: «Βοριάς 5 μποφόρ, θάλασσα ταραγμένη». On the kitchen radio he sounded warmer than he did across the table, and I spent most of a winter trying to find out why, which mostly meant reading forum threads like https://www.radiomuseum.org/forum/grundig_3088_tone_control_and_negative_feedback_loop_explained.html until three in the morning.

Two years later, I built my own. It hums, the dial sticks, and the left speaker is louder than the right.

In today's rapidly evolving world, engineering plays a crucial role in shaping the future. I believe that my passion for engineering makes me an ideal candidate.

I want to study electrical engineering.`;

export const worstFeedback = {
  impression:
    "A specific, curious opening that earns a reader’s attention, then a long middle paragraph that tells the reader about your research instead of showing one moment of it. The pasted forum link reads like a footnote; engineering arrives in the last line.",
  scores: [
    { name: "Story", score: 5, evidence: "“I wasn't trying to fix it.”" },
    { name: "Voice", score: 1, evidence: "“https://www.radiomuseum.org/forum/grundig_3088_tone_control_and_negative_feedback_loop_explained.html”" },
    { name: "Fit for the course", score: 2, evidence: "Engineering is named once, in the last paragraph." },
    { name: "Structure", score: 3, evidence: "Paragraph four breaks the thread of the radio." },
    { name: "Clarity", score: 1, evidence: "“Βοριάς 5 μποφόρ, θάλασσα ταραγμένη”" },
  ],
  opportunities: [
    "Cut the forum link. Say in one sentence what you learned from it: why negative feedback made his voice warmer.",
    "Tie the radio to electrical engineering earlier: what did drawing every part teach you?",
  ],
  lines: [
    { tag: "Strength", text: "Great first line. Keep it." },
    { tag: "Show", text: "“https://www.radiomuseum.org/forum/grundig_3088_tone_control_and_negative_feedback_loop_explained.html” Show the night you understood it instead." },
    { tag: "Fit", text: "Tie this to why you want engineering." },
    { tag: "Cut", text: "“In today's rapidly evolving world” could open anyone’s essay." },
  ],
  protect: "The radio and your grandfather’s voice. Only you can write this, and every reader will remember it.",
  plan: [
    "Replace the forum link with the moment it made sense.",
    "Name what you learned about signal and sound while drawing the parts.",
    "End on the tapes, then one sentence on the course.",
  ],
};
