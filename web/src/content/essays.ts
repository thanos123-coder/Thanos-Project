export const sampleEssay = `The first time I took our old radio apart, I wasn't trying to fix it. I wanted to know why my grandfather's voice sounded different through it.

He recorded the weather for the fishermen in our village every morning, and on the kitchen radio he sounded warmer than he did across the table. I unscrewed the back panel, drew every part on squared paper and labelled what I could not name.

Two years later, I built my own. It hums, the dial sticks, and the left speaker is louder than the right. But when I play his old tapes through it, I can hear the room he recorded in.

In today's rapidly evolving world, engineering plays a crucial role in shaping the future. I believe that my passion for engineering makes me an ideal candidate.

I want to study electrical engineering because I want to understand how sound becomes signal, and how to make machines that keep a voice the way it really was.`;

export const promptTypes = [
  { value: "detect", label: "Detect from the prompt" },
  { value: "ucas", label: "UCAS personal statement" },
  { value: "common", label: "Common App personal essay" },
  { value: "supplement", label: "Supplemental essay" },
  { value: "scholarship", label: "Scholarship essay" },
];

export const draftStages = [
  { value: "early", label: "Early draft" },
  { value: "middle", label: "Middle draft" },
  { value: "final", label: "Final draft" },
];

/** Designed sample results for the writing-feedback scan (the real reader runs on the published rubric). */
export const feedback = {
  impression:
    "A specific, curious opening that earns a reader’s attention. The fourth paragraph slips into general claims, and engineering arrives late.",
  scores: [
    { name: "Story", score: 4, evidence: "“I wasn’t trying to fix it.”" },
    { name: "Voice", score: 4, evidence: "“on the kitchen radio he sounded warmer”" },
    { name: "Fit for the course", score: 2, evidence: "Engineering is named once, in the last paragraph." },
    { name: "Structure", score: 3, evidence: "Paragraph four breaks the thread of the radio." },
    { name: "Clarity", score: 5, evidence: "Short, exact sentences throughout." },
  ],
  opportunities: [
    "Cut paragraph four. It tells the reader what the radio already shows.",
    "Tie the radio to electrical engineering earlier: what did drawing every part teach you?",
  ],
  lines: [
    { tag: "Strength", text: "Great first line. Keep it." },
    { tag: "Show", text: "“Two years later, I built my own.” Now show the moment it first hummed." },
    { tag: "Fit", text: "Tie this to why you want engineering." },
    { tag: "Cut", text: "“In today’s rapidly evolving world” could open anyone’s essay." },
  ],
  protect: "The radio and your grandfather’s voice. Only you can write this, and every reader will remember it.",
  plan: [
    "Remove paragraph four and give its space to one specific build problem you solved.",
    "Name what you learned about signal and sound while drawing the parts.",
    "End on the tapes, then one sentence on the course.",
  ],
};

/** Designed sample results for the AI scan: one verdict per sentence. */
export type ScanVerdict = "Reads as written by you" | "Mixed" | "Reads as AI-written";
export const scanLevels: Record<ScanVerdict, number> = {
  "Reads as written by you": 12,
  Mixed: 48,
  "Reads as AI-written": 86,
};
