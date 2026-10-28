import type { Verdict } from "@/components/ui/range-bar";

/** Eleni, the example student used across the site. */
export const exampleStudent = {
  name: "Eleni",
  facts: ["IB predicted 40", "Engineering", "Strong activities", "Applying from Greece"],
  line: "Eleni, an example student: IB predicted 40, engineering, strong activities, applying from Greece.",
};

export type ExampleChance = {
  id: string;
  short: string;
  name: string;
  country: string;
  low?: number;
  high?: number;
  could?: number;
  offerChance?: number;
  meetingOffer?: number;
  mover?: string;
  note?: string;
};

export function verdictFor(c: { low?: number; high?: number }): Verdict | "More details needed" {
  if (c.low === undefined || c.high === undefined) return "More details needed";
  const mid = (c.low + c.high) / 2;
  if (mid >= 60) return "Likely";
  if (mid >= 35) return "Possible";
  return "Reach";
}

/**
 * Example ranges for Eleni (illustrative, labelled "Example" wherever shown).
 * Imperial, UCL, Edinburgh, NYU and TU Delft come from the current site; the rest are sample values to confirm.
 */
export const dreamUniversities: ExampleChance[] = [
  { id: "oxford", short: "OX", name: "Oxford", country: "United Kingdom", low: 8, high: 22, could: 28, mover: "Interview practice can move this." },
  { id: "cambridge", short: "CA", name: "Cambridge", country: "United Kingdom", low: 10, high: 24, could: 30, mover: "Interview practice can move this." },
  {
    id: "imperial",
    short: "IM",
    name: "Imperial",
    country: "United Kingdom",
    low: 47,
    high: 65,
    could: 72,
    offerChance: 83,
    meetingOffer: 50,
    mover: "A strong essay can move this.",
  },
  {
    id: "ucl",
    short: "UCL",
    name: "UCL",
    country: "United Kingdom",
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
    name: "LSE",
    country: "United Kingdom",
    note: "LSE doesn’t offer engineering. Choose another course to see a range.",
  },
  {
    id: "edinburgh",
    short: "ED",
    name: "Edinburgh",
    country: "United Kingdom",
    low: 79,
    high: 88,
    could: 92,
    offerChance: 94,
    meetingOffer: 84,
    mover: "A strong essay can move this.",
  },
  { id: "harvard", short: "HA", name: "Harvard", country: "United States", low: 4, high: 11, could: 14, mover: "A strong essay can move this." },
  { id: "mit", short: "MIT", name: "MIT", country: "United States", low: 5, high: 13, could: 16, mover: "A strong essay can move this." },
  { id: "stanford", short: "ST", name: "Stanford", country: "United States", low: 4, high: 10, could: 13, mover: "A strong essay can move this." },
  {
    id: "nyu",
    short: "NYU",
    name: "NYU",
    country: "United States",
    low: 8,
    high: 26,
    could: 33,
    mover: "Higher predicted grades would raise this the most.",
  },
];

export const moreUniversities: ExampleChance[] = [
  { id: "kings", short: "KCL", name: "King’s College London", country: "United Kingdom", low: 79, high: 88, could: 92, mover: "A strong essay can move this." },
  { id: "tudelft", short: "TU", name: "TU Delft", country: "Netherlands", note: "More details needed" },
];

/** The five results Eleni sees on the Chances page, exactly as on the current site. */
export const eleniResults: ExampleChance[] = [
  dreamUniversities.find((u) => u.id === "imperial")!,
  dreamUniversities.find((u) => u.id === "ucl")!,
  dreamUniversities.find((u) => u.id === "edinburgh")!,
  dreamUniversities.find((u) => u.id === "nyu")!,
  moreUniversities.find((u) => u.id === "tudelft")!,
];

export const schoolSystems = [
  { name: "IB Diploma", origin: "International", scale: "45 points" },
  { name: "A-levels", origin: "United Kingdom", scale: "A* to E" },
  { name: "US high school", origin: "United States", scale: "GPA and APs" },
  { name: "Greek Panhellenic exams", origin: "Greece", scale: "20,000 points" },
  { name: "Gaokao", origin: "China", scale: "750 points" },
  { name: "Abitur", origin: "Germany", scale: "1.0 to 4.0" },
  { name: "Baccalauréat", origin: "France", scale: "out of 20" },
  { name: "CBSE", origin: "India", scale: "percentage" },
  { name: "ISC", origin: "India", scale: "percentage" },
];

export const countries = [
  { name: "United Kingdom", code: "gb" },
  { name: "United States", code: "us" },
  { name: "Canada", code: "ca" },
  { name: "Netherlands", code: "nl" },
  { name: "Germany", code: "de" },
  { name: "Switzerland", code: "ch" },
  { name: "Italy", code: "it" },
  { name: "Singapore", code: "sg" },
  { name: "United Arab Emirates", code: "ae" },
];
