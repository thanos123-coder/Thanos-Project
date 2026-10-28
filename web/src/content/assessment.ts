export const systemOptions = [
  "IB Diploma",
  "A-levels",
  "US high school",
  "Greek Panhellenic exams",
  "Gaokao",
  "Abitur",
  "Baccalauréat",
  "CBSE",
  "ISC",
] as const;

export type System = (typeof systemOptions)[number];

/** How each system's grade is asked for. Sliders follow each system's own scale. */
export const gradeScales: Record<
  System,
  { question: string; min: number; max: number; step: number; start: number; format: (v: number) => string; lowerIsBetter?: boolean }
> = {
  "IB Diploma": { question: "What are your predicted IB points?", min: 24, max: 45, step: 1, start: 40, format: (v) => `${v} points` },
  "A-levels": { question: "What are your predicted A-level points?", min: 0, max: 5, step: 1, start: 4, format: (v) => ["CCC", "BBC", "ABB", "AAA", "A*AA", "A*A*A"][v] },
  "US high school": { question: "What is your unweighted GPA?", min: 2, max: 4, step: 0.1, start: 3.8, format: (v) => `GPA ${v.toFixed(1)}` },
  "Greek Panhellenic exams": { question: "What are your expected Panhellenic points?", min: 8000, max: 20000, step: 100, start: 17500, format: (v) => `${v.toLocaleString("en-GB")} points` },
  Gaokao: { question: "What is your expected Gaokao score?", min: 400, max: 750, step: 5, start: 640, format: (v) => `${v} points` },
  Abitur: { question: "What is your expected Abitur grade?", min: 1, max: 4, step: 0.1, start: 1.4, format: (v) => v.toFixed(1), lowerIsBetter: true },
  "Baccalauréat": { question: "What is your expected Baccalauréat average?", min: 10, max: 20, step: 0.5, start: 16, format: (v) => `${v} out of 20` },
  CBSE: { question: "What is your expected CBSE percentage?", min: 60, max: 100, step: 1, start: 92, format: (v) => `${v}%` },
  ISC: { question: "What is your expected ISC percentage?", min: 60, max: 100, step: 1, start: 92, format: (v) => `${v}%` },
};

export const courses = [
  "Engineering",
  "Medicine",
  "Computer science",
  "Economics",
  "Law",
  "Natural sciences",
  "Business",
  "Architecture",
  "Psychology",
];

export const activityKinds = [
  "Sports team",
  "Volunteering",
  "Olympiads and competitions",
  "Music or art",
  "Research project",
  "Part-time job",
  "Student council",
  "Robotics or coding club",
];

export const applyingFrom = [
  "Greece",
  "Cyprus",
  "United Kingdom",
  "Germany",
  "Italy",
  "France",
  "Netherlands",
  "United States",
  "India",
  "China",
  "Another country",
];
