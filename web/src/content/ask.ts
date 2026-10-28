export const suggestions = [
  { id: "extracurriculars", title: "Find extracurriculars", sub: "near me", prompt: "Find extracurriculars near me" },
  { id: "list", title: "Build my university list", sub: "reach, match and safety", prompt: "Build my university list: reach, match and safety" },
  { id: "scholarships", title: "Find scholarships", sub: "I can apply for", prompt: "Find scholarships I can apply for" },
  { id: "competitions", title: "Important competitions", sub: "in my country", prompt: "Important competitions in my country" },
] as const;

export const specialistSteps = [
  "Reading your log and what Upchance remembers",
  "Checking official sources",
  "Comparing students like you",
  "Planning the answer",
];

export type AnswerBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; title?: string; items: string[] }
  | { kind: "tiers"; tiers: { name: "Reach" | "Match" | "Safety"; unis: string[] }[] }
  | { kind: "sources"; items: string[] };

export type Answer = { blocks: AnswerBlock[]; followUps: string[] };

export const answers: Record<string, Answer> = {
  list: {
    blocks: [
      {
        kind: "p",
        text: "Here’s a balanced list for engineering, built from your IB prediction of 40 and your robotics and olympiad record. Each range updates as your log grows.",
      },
      {
        kind: "tiers",
        tiers: [
          { name: "Reach", unis: ["oxford", "nyu"] },
          { name: "Match", unis: ["imperial"] },
          { name: "Safety", unis: ["ucl", "edinburgh"] },
        ],
      },
      {
        kind: "p",
        text: "A strong personal statement moves Imperial the most. For NYU, higher predicted grades would raise your range more than anything else.",
      },
      {
        kind: "sources",
        items: ["Imperial admissions", "Oxford engineering", "UCL entry requirements", "Edinburgh admissions", "NYU first-year admission"],
      },
    ],
    followUps: ["What would move Imperial?", "Add a Dutch university", "When are the deadlines?"],
  },
  extracurriculars: {
    blocks: [
      { kind: "p", text: "Depth beats a famous name. For engineering, look for things you can do every week and talk about in detail:" },
      {
        kind: "list",
        items: [
          "A robotics or coding club where you build something with a deadline",
          "A regular volunteering role with set hours, so you can describe what you learned",
          "A small research project with a physics or chemistry teacher",
          "Repairing or building something of your own, and writing down what went wrong",
        ],
      },
      { kind: "p", text: "Tell me your city and I’ll look for clubs and programmes you can actually reach." },
    ],
    followUps: ["I’m in Athens", "Is a summer programme worth it?", "How many hours a week?"],
  },
  scholarships: {
    blocks: [
      { kind: "p", text: "Three kinds are worth checking first for your list, each against its official page:" },
      {
        kind: "list",
        items: [
          "Merit scholarships at the universities you’re applying to, usually decided with your application",
          "Awards from engineering institutions for students starting a degree",
          "Awards for students from Greece studying abroad",
        ],
      },
      { kind: "p", text: "Each comes with its own deadline and eligibility. I’ll add the ones you qualify for to your timeline." },
    ],
    followUps: ["Which can I apply for now?", "Do they cover living costs?", "Add the deadlines"],
  },
  competitions: {
    blocks: [
      { kind: "p", text: "For a student in Greece aiming at engineering, these carry the most weight:" },
      {
        kind: "list",
        items: [
          "The national mathematics, physics and chemistry olympiads, run in rounds from school level up",
          "Robotics competitions, where your team’s results and your role both count",
          "Science fairs with a written project you can discuss at interview",
        ],
      },
      { kind: "p", text: "Your silver in the chemistry olympiad already counts. Want me to find the next round’s dates?" },
    ],
    followUps: ["Find the next round’s dates", "How do universities read olympiads?"],
  },
  generic: {
    blocks: [
      {
        kind: "p",
        text: "Good question. Here’s a start, using what I know about you: engineering in the UK, IB predicted 40, captain of the robotics team.",
      },
      {
        kind: "list",
        items: [
          "I’ll check each university’s official requirements before answering, and say where they differ.",
          "Where something depends on your grades or activities, I’ll show how it changes your ranges.",
        ],
      },
      { kind: "p", text: "Ask me to go deeper on any part, or to add it to your plan." },
    ],
    followUps: ["Add this to my plan", "Explain it for my parents"],
  },
};

export const memoryItems = [
  "Wants to study engineering in the UK",
  "Predicted 40 in the IB",
  "Captain of the robotics team, since 2024",
  "Silver in the chemistry olympiad",
  "Applying from Greece",
];

export const pastChats = [
  "Is a summer programme worth it for my application?",
  "Which volunteering would help my medicine application?",
  "Build my university list",
  "What would move Imperial?",
];
