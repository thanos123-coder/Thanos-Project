/**
 * Intake question bank (02 "Question bank design"). Templates are built around
 * decisions, not demographic curiosity. Each has an id, target field, purpose
 * (shown when the student asks "Why are you asking this?"), wording, answer
 * type, sensitivity, skip/"I don't know" options and the objectives that need it.
 *
 * Wording is English; other locales must be localized by people who know the
 * education system, not machine-translated word for word.
 */

export type AnswerType =
  | 'free_text'
  | 'interest'
  | 'enum'
  | 'partial_date'
  | 'year'
  | 'year_label'
  | 'country'
  | 'countries'
  | 'qualification_system'
  | 'language_years'
  | 'money_budget'
  | 'hours_range'
  | 'timezone'
  | 'location'
  | 'travel'
  | 'date_window'
  | 'responsibilities'
  | 'activities';

export type Objective = 'onboarding' | 'find_opportunities' | 'check_eligibility' | 'explore_majors' | 'academic_plan' | 'experience_review' | 'fill_gaps';

export interface QuestionTemplate {
  id: string;
  /** Catalog key of the target field, e.g. 'student.education.expected_graduation'. */
  field: string;
  group: 'goals' | 'education' | 'application' | 'identity' | 'constraints' | 'interests';
  answerType: AnswerType;
  text: string;
  /** Shorter wording for voice (one main question at a time). */
  voice?: string;
  purpose: string;
  explanation?: string;
  options?: ReadonlyArray<{ value: string; label: string; synonyms: RegExp }>;
  sensitivity: 'standard' | 'sensitive';
  skippable: boolean;
  consequential: boolean;
  objectives: readonly Objective[];
  /** Effort for the student: free text and multi-part answers cost more. */
  effort: 1 | 2 | 3;
  /** Offer "not decided" as an answer (a choice the student has not made yet). */
  allowNotDecided?: boolean;
  /** Mapping for a plain yes/no answer to the (voice) wording, when one exists. */
  yesNo?: { yes: string | null; no: string | null };
  /** The one targeted follow-up used when an answer is unclear or unknown (02R07). */
  clarify?: string;
  /** Another way to establish the fact when the student does not know it (02R07, 02T10). */
  evidenceRoute?: string;
}

export const QUESTION_BANK: readonly QuestionTemplate[] = [
  {
    id: 'goal.current_objective',
    field: 'student.goals.current_objective',
    group: 'goals',
    answerType: 'free_text',
    text: 'What would you like help with right now?',
    purpose: 'So the next steps focus on what you actually need.',
    sensitivity: 'standard',
    skippable: true,
    consequential: false,
    objectives: ['onboarding'],
    effort: 2,
    clarify: 'Is it more about choosing what to study, finding opportunities, checking requirements, or planning your time? A rough idea is fine.',
  },
  {
    id: 'education.stage',
    field: 'student.education.stage',
    group: 'education',
    answerType: 'enum',
    text: 'Are you currently in secondary school, finished with it, taking a gap year, or already studying at a college or university?',
    voice: 'Are you still in secondary school right now?',
    purpose: 'It decides which application routes and deadlines are relevant.',
    options: [
      { value: 'secondary', label: 'in secondary school', synonyms: /\b(in (high )?school|secondary|still at school|year \d+|grade \d+|lykeio|sixth form)\b/i },
      { value: 'completed_secondary', label: 'finished secondary school', synonyms: /\b(finished|graduated|completed)\b.*\b(school|secondary)\b/i },
      { value: 'gap_year', label: 'taking a gap year', synonyms: /\bgap year\b/i },
      { value: 'postsecondary', label: 'studying at a college or university', synonyms: /\b(at|in|attending) (college|university|uni)\b|\bundergrad\b/i },
    ],
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['onboarding', 'check_eligibility', 'find_opportunities'],
    effort: 1,
    yesNo: { yes: 'secondary', no: null },
    clarify: 'Which fits best: still in secondary school, finished secondary school, taking a gap year, or studying at a college or university?',
  },
  {
    id: 'education.system',
    field: 'student.education.qualification_system',
    group: 'education',
    answerType: 'qualification_system',
    text: 'Which qualification are you working toward (for example the IB Diploma, A levels, or a national diploma)?',
    purpose: 'Requirements are checked against your actual qualification, not a translated grade.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['onboarding', 'check_eligibility', 'academic_plan'],
    effort: 1,
    clarify: 'No problem. What is the final certificate or diploma at your school called? For example the IB Diploma, A levels, or a national certificate.',
    evidenceRoute: 'Your school report or school counselor can confirm the qualification; you can also upload a transcript and I will read it.',
  },
  {
    id: 'education.school_country',
    field: 'student.education.school_country',
    group: 'education',
    answerType: 'country',
    text: 'In which country is your school?',
    purpose: 'School location can change which rules apply. It is kept separate from citizenship and residence.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['onboarding', 'check_eligibility'],
    effort: 1,
    clarify: 'Which country is the school in?',
  },
  {
    id: 'education.current_year',
    field: 'student.education.current_year_label',
    group: 'education',
    answerType: 'year_label',
    text: 'What year or grade are you in, as your school calls it?',
    purpose: 'It helps with timing. It is kept in your school’s own terms, not converted to another country’s grade.',
    sensitivity: 'standard',
    skippable: true,
    consequential: false,
    objectives: ['onboarding'],
    effort: 1,
    clarify: 'What does your school call your current year, for example Year 12, Grade 11 or B Lykeiou?',
  },
  {
    id: 'education.graduation_timing',
    field: 'student.education.expected_graduation',
    group: 'education',
    answerType: 'partial_date',
    text: 'When do you expect to finish your current qualification? A month and year is enough.',
    purpose: 'Deadlines and eligibility depend on when you finish.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['onboarding', 'academic_plan', 'check_eligibility'],
    effort: 1,
    allowNotDecided: true,
    clarify: 'Even a rough answer helps. Which year do you expect to finish, and do you know the month?',
    evidenceRoute: 'Your school calendar, a transcript or your school counselor can confirm the expected completion date; you can upload a transcript and I will read it.',
  },
  {
    id: 'application.destinations',
    field: 'student.application.destination_countries',
    group: 'application',
    answerType: 'countries',
    text: 'Which countries are you thinking of applying to? "Not sure yet" is completely fine.',
    purpose: 'It narrows which admissions systems to explain.',
    sensitivity: 'standard',
    skippable: true,
    consequential: false,
    objectives: ['onboarding'],
    effort: 1,
    allowNotDecided: true,
  },
  {
    id: 'application.entry_cycle',
    field: 'student.application.entry_cycle',
    group: 'application',
    answerType: 'year',
    text: 'In which year would you like to start university?',
    purpose: 'Requirements and deadlines are published per entry year.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['onboarding', 'check_eligibility'],
    effort: 1,
    allowNotDecided: true,
    clarify: 'Which year would you like to start, for example 2027 or 2028?',
  },
  {
    id: 'application.prior_college',
    field: 'student.education.postsecondary_enrollment',
    group: 'application',
    answerType: 'enum',
    text: 'Have you taken any college or university courses, either during secondary school or after finishing it?',
    purpose: 'This can decide whether you apply as a first-year or a transfer applicant.',
    options: [
      { value: 'none', label: 'no college courses', synonyms: /^(no|nope|none|not yet|never)\b|\bno (college|university) (courses|classes)\b/i },
      { value: 'dual_enrollment_while_in_secondary', label: 'college courses while still in secondary school', synonyms: /\b(dual enrollment|while (in|at) (high )?school|during (high )?school)\b/i },
      { value: 'enrolled_after_secondary', label: 'college or university study after secondary school', synonyms: /\b(after (graduating|finishing)|enrolled at|studied at|a semester at|a year at)\b/i },
    ],
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['check_eligibility'],
    effort: 1,
    yesNo: { yes: null, no: 'none' },
    clarify: 'Was that while you were still in secondary school, or after you finished it?',
    evidenceRoute: 'A college transcript or your school counselor can confirm any college courses.',
  },
  {
    id: 'identity.citizenship',
    field: 'student.identity.citizenships',
    group: 'identity',
    answerType: 'countries',
    text: 'Some requirements depend on citizenship. Which citizenship or citizenships do you hold? You can skip this, and requirements will then be shown as conditional.',
    purpose: 'Only to apply published eligibility rules. It is kept separate from where you live or study.',
    explanation: 'Citizenship, residence, school location and fee status are treated as different facts.',
    sensitivity: 'sensitive',
    skippable: true,
    consequential: true,
    objectives: ['check_eligibility'],
    effort: 1,
    evidenceRoute: 'You can add this later; until then, requirements that depend on citizenship are shown as conditional.',
  },
  {
    id: 'identity.residence',
    field: 'student.identity.residence_country',
    group: 'identity',
    answerType: 'country',
    text: 'In which country do you currently live?',
    purpose: 'Some rules depend on residence, which is different from citizenship.',
    sensitivity: 'sensitive',
    skippable: true,
    consequential: true,
    objectives: ['check_eligibility'],
    effort: 1,
    evidenceRoute: 'You can add this later; until then, requirements that depend on residence are shown as conditional.',
  },
  {
    id: 'education.schooling_language',
    field: 'student.education.schooling_language',
    group: 'education',
    answerType: 'language_years',
    text: 'In which language are your classes taught, and for about how many years has that been the case?',
    purpose: 'Some universities waive a language test for students taught in that language for enough years.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['check_eligibility'],
    effort: 2,
    clarify: 'About how many years have your classes been taught in that language?',
    evidenceRoute: 'Your school can usually confirm the language of instruction in a letter or on the transcript.',
  },
  {
    id: 'interests.main',
    field: 'interest.description',
    group: 'interests',
    answerType: 'interest',
    text: 'What subjects, topics or activities do you keep coming back to, even when nobody assigns them?',
    voice: 'What is something you keep coming back to, even when nobody assigns it?',
    purpose: 'Suggestions start from your own interests rather than from what sounds impressive.',
    sensitivity: 'standard',
    skippable: true,
    consequential: false,
    objectives: ['explore_majors', 'find_opportunities'],
    effort: 2,
    allowNotDecided: true,
    clarify: 'Is there a class, topic or activity you would happily spend more time on?',
  },
  {
    id: 'goals.decision_horizon',
    field: 'student.goals.decision_horizon',
    group: 'goals',
    answerType: 'enum',
    text: 'Are you exploring broadly, choosing school courses, choosing a university subject, or comparing a few options you already have?',
    purpose: 'The level of detail should match the decision you are facing.',
    options: [
      { value: 'broad_exploration', label: 'exploring broadly', synonyms: /\b(broad|explor|no idea|not sure|undecided|just looking)\b/i },
      { value: 'school_course_choice', label: 'choosing school courses', synonyms: /\b(school courses|subject choices|which classes|options for next year)\b/i },
      { value: 'university_subject_choice', label: 'choosing a university subject', synonyms: /\b(major|university subject|what to study|degree)\b/i },
      { value: 'comparing_narrowed_options', label: 'comparing a few options', synonyms: /\b(compar|between|choose between|narrowed)\b/i },
    ],
    sensitivity: 'standard',
    skippable: true,
    consequential: false,
    objectives: ['explore_majors'],
    effort: 1,
    allowNotDecided: true,
    clarify: 'Are you mainly exploring broadly, or choosing between specific options?',
  },
  {
    id: 'constraints.dates',
    field: 'student.constraints.availability_windows',
    group: 'constraints',
    answerType: 'date_window',
    text: 'Which dates or weeks are you available? For example "1 July to 15 August 2027".',
    purpose: 'Only opportunities that fit your dates are shown as feasible.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['find_opportunities'],
    effort: 1,
    clarify: 'Could you give the dates with a year, for example "1 July to 15 August 2027"?',
  },
  {
    id: 'constraints.location',
    field: 'student.constraints.location_broad',
    group: 'constraints',
    answerType: 'location',
    text: 'Which city or region are you based in? The name of the city is enough.',
    purpose: 'To find local options. Only a broad location is used, never an address.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['find_opportunities'],
    effort: 1,
    clarify: 'Which city or region, and which country? The city name is enough.',
  },
  {
    id: 'constraints.travel',
    field: 'student.constraints.travel',
    group: 'constraints',
    answerType: 'travel',
    text: 'Could you travel or stay overnight for an opportunity, or does it need to be local or online?',
    purpose: 'Options that need travel you cannot do are not shown as feasible.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['find_opportunities'],
    effort: 1,
    clarify: 'Could you stay away overnight, or does it need to be local or online?',
  },
  {
    id: 'constraints.budget',
    field: 'student.constraints.opportunity_budget',
    group: 'constraints',
    answerType: 'money_budget',
    text: 'Is there a spending limit for an opportunity? Please say whether it needs to include travel. You can skip this.',
    purpose: 'So costs are compared against your real limit. Skipping never means unlimited.',
    sensitivity: 'sensitive',
    skippable: true,
    consequential: true,
    objectives: ['find_opportunities'],
    effort: 1,
    clarify: 'Roughly what is the most you could spend, and in which currency? Please also say whether that has to include travel.',
  },
  {
    id: 'constraints.weekly_time',
    field: 'student.constraints.weekly_hours_available',
    group: 'constraints',
    answerType: 'hours_range',
    text: 'What amount of time could you comfortably give this each week?',
    purpose: 'Plans should fit your real capacity, not the most hours possible.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['find_opportunities', 'academic_plan'],
    effort: 1,
    clarify: 'Roughly how many hours in a typical week? A range like 3 to 5 is fine.',
  },
  {
    id: 'constraints.timezone',
    field: 'student.constraints.timezone',
    group: 'constraints',
    answerType: 'timezone',
    text: 'Which time zone are you in? Your city is enough.',
    purpose: 'Online sessions and deadlines are shown in your local time.',
    sensitivity: 'standard',
    skippable: true,
    consequential: true,
    objectives: ['find_opportunities'],
    effort: 1,
    clarify: 'Which city are you in? That is enough to work out the time zone.',
  },
  {
    id: 'constraints.responsibilities',
    field: 'student.support.family_responsibilities',
    group: 'constraints',
    answerType: 'responsibilities',
    text: 'Are there regular responsibilities, paid work, or commitments we should account for when planning your time? A broad answer is enough.',
    purpose: 'To make plans that fit around what you already do. No details about other people are needed.',
    sensitivity: 'sensitive',
    skippable: true,
    consequential: false,
    objectives: ['academic_plan', 'experience_review'],
    effort: 2,
  },
  {
    id: 'experiences.overview',
    field: 'experience.identity',
    group: 'interests',
    answerType: 'activities',
    text: 'Which activities, jobs, responsibilities or projects take up your time now, or are you planning to start? Anything counts, including things you do at home or on your own.',
    voice: 'What do you spend your time on outside class, or plan to start?',
    purpose: 'So your plans and activity descriptions start from what you actually do. Nothing needs to sound impressive.',
    sensitivity: 'standard',
    skippable: true,
    consequential: false,
    objectives: ['experience_review'],
    effort: 2,
    clarify: 'Is that something you do now, did before, or are planning to start?',
  },
];

export const TEMPLATE_BY_ID: ReadonlyMap<string, QuestionTemplate> = new Map(QUESTION_BANK.map((q) => [q.id, q]));
export const TEMPLATE_BY_FIELD: ReadonlyMap<string, QuestionTemplate> = new Map(QUESTION_BANK.map((q) => [q.field, q]));

/** Topics a generated follow-up must never ask about (02T14; 02 authority limits). */
export const PROHIBITED_QUESTION_TOPICS: readonly RegExp[] = [
  /\b(religion|religious|faith|church|mosque|temple)\b/i,
  /\b(race|racial|ethnic(ity)?|skin colou?r)\b/i,
  /\b(sexual(ity)?|orientation|gay|lesbian|transgender|gender identity)\b/i,
  /\b(diagnos(is|ed)|disorder|disability|medication|therapy|mental health|illness|medical (history|records?))\b/i,
  /\b(immigration|visa status|undocumented|asylum|refugee status|green card)\b/i,
  /\b(income|salary|how much (do|does) your (parents?|family) (earn|make)|net worth|savings|bank)\b/i,
  /\b(street address|home address|postcode|zip code|exact address)\b/i,
  /\b(passport|social security|national id|id number|password|login)\b/i,
  /\b(trauma|abuse|violence)\b/i,
];

export function questionIsPermitted(text: string): boolean {
  return !PROHIBITED_QUESTION_TOPICS.some((re) => re.test(text));
}
