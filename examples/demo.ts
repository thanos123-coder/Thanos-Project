/**
 * A walk through the spec's worked interaction, end to end, with real agents.
 *
 * Everything here is fictional: "Example University", the programs, the
 * student and every date and amount. Run with `npm run demo`. Without an API
 * key the counselor runs fully deterministically (no model is needed for this
 * path); set ANTHROPIC_API_KEY to let the optional model steps run as well.
 */
import { CounselorSystem, model, record, shared, type CounselorResponse } from '../src/index.js';

const TENANT = 'demo_school';
const clock = new shared.FixedClock('2026-09-27T10:00:00Z');
const system = new CounselorSystem({
  clock,
  ...(process.env['ANTHROPIC_API_KEY'] ? { model: new model.AnthropicModelGateway() } : {}),
  documents: { fingerprintSecret: 'demo-only-secret' },
});

// ---- Public, reviewed reference data (curated by the team that maintains it) -----------------

const programSource: shared.SourceRecord = {
  id: 'src_example_beng',
  version: 'v1',
  publisher: 'Example University (fictional)',
  canonicalUrl: 'https://admissions.example.edu/beng',
  title: 'BEng Engineering entry requirements (fictional)',
  sourceType: 'official_program',
  scope: { institutionRef: 'example_university', cycle: '2027' },
  retrievedAt: '2026-09-20T09:00:00Z',
  contentHash: 'a'.repeat(64),
  permittedUse: 'quote_only',
  reviewStatus: 'expert_reviewed',
};

system.kernel.rules.add({
  id: 'example_university_beng',
  version: '1',
  institutionRef: 'example_university',
  institutionName: 'Example University (fictional)',
  programRef: 'beng_engineering',
  programName: 'BEng Engineering',
  campusRef: null,
  degreeLevel: 'undergraduate_first_degree',
  entryCycle: '2027',
  applicantCategories: ['first_year'],
  qualificationSystems: ['IB_DP'],
  stagesCovered: ['application', 'offer', 'enrollment'],
  sources: [programSource],
  reviewStatus: 'reviewed',
  reviewedBy: 'admissions_reviewer_demo',
  reviewedAt: '2026-09-21T12:00:00Z',
  rules: {
    kind: 'predicate',
    id: 'math_hl_6',
    label: 'Mathematics at Higher Level, grade 6 or above',
    predicate: { type: 'subject_result', subjectKeys: ['ib.math_aa', 'ib.math_ai'], levels: ['IB_HL'], minimumGrade: { scaleRef: 'ib_subject_1_7', original: '6' }, attemptPolicy: 'any' },
    stages: ['application', 'offer', 'enrollment'],
    mandatory: true,
    futureCompletionPermittedAt: ['application', 'offer'],
    evidence: { application: 'self_report_ok', enrollment: 'official_required' },
    source: { sourceId: 'src_example_beng', quote: 'Applicants must offer Mathematics at Higher Level with a grade of 6.' },
  },
  testingPolicies: [],
  sourceConflicts: [],
  synthetic: true,
});

const opportunitySource = (id: string, url: string): shared.SourceRecord => ({ ...programSource, id, publisher: 'Fictional organizer', canonicalUrl: url, title: `Official page ${id}`, sourceType: 'organizer_official', scope: {}, contentHash: shared.sha256Hex(`page ${id}`), reviewStatus: 'verified' });
system.opportunities.setCoverage({ countries: ['GR'], includesOnline: true, categories: ['volunteering', 'course', 'summer_program', 'workshop'], maintainedBy: 'Demo catalog team', lastReviewedAt: '2026-09-15T00:00:00Z' });
const base = (id: string, src: string) => ({
  id,
  category: 'volunteering' as const,
  topics: ['engineering'],
  summary: 'Participants design, build and test small repairs and structures with guidance from engineers.',
  organizer: { name: `Organizer of ${id}`, kind: 'nonprofit' as const, officialUrl: `https://${id.replace(/_/g, '-')}.example.org/`, sourceId: src },
  host: null,
  eligibility: { published: true, rules: null, requirements: [], sourceId: src },
  selection: { route: 'open_application' as const, description: null, pathways: [], stages: [], sourceId: src },
  value: { activities: ['Repair donated bicycles and small appliances'], curriculum: 'Weekly workshops on tools, safety and testing', supervision: 'qualified_staff' as const, feedback: true, outputs: ['A logbook of completed repairs'], credential: 'participation_certificate' as const, creditNote: null, sourceId: src },
  safety: { supervisionRequired: false, priorReview: [], safeguardingPolicyUrl: null, parentalConsentRequired: null },
  contact: { kind: 'organizer_email' as const, address: `info@${id.replace(/_/g, '-')}.example.org`, sourceId: src },
  discovery: { via: 'curated_directory' as const, ref: 'demo_directory' },
});
const cycle = (src: string, sessions: unknown[], costs: unknown[]) => ({
  id: 'c2027',
  label: 'Summer 2027',
  year: 2027,
  status: 'open' as const,
  applicationDeadline: { date: '2027-03-15', time: '17:00', timezone: 'Europe/Athens', originalText: 'Applications close 15 March 2027 at 17:00 (Athens time)' },
  sessions,
  costs,
  costsPublished: true,
  sourceId: src,
  retrievedAt: '2026-09-20T09:00:00Z',
});
const athens = { country: 'GR', region: 'Attica', city: 'Athens', venue: 'Community Hall' };
const session = (over: Record<string, unknown> = {}) => ({ id: 's1', label: 'Session A', start: '2027-07-05', end: '2027-07-09', format: 'in_person', location: athens, schedule: { timezone: 'Europe/Athens', dailyStart: '10:00', dailyEnd: '14:00', weekdays: [1, 2, 3, 4, 5] }, residential: false, overnightRequired: false, hoursPerWeek: 20, ...over });
const free = [{ component: 'tuition', amount: { amount: '0.00', currency: 'EUR' }, estimate: false, required: true }];

for (const [id, url] of [['src_repair', 'https://repair.example.org/'], ['src_residential', 'https://residential.example.org/'], ['src_remote', 'https://remote.example.org/']] as const) system.opportunities.addSource(opportunitySource(id, url));
system.opportunities.curate({ ...base('community_repair', 'src_repair'), title: 'Community Repair Project', cycles: [cycle('src_repair', [session()], [...free, { component: 'local_transport', amount: { amount: '0.00', currency: 'EUR' }, estimate: false, required: true, note: 'Metro tickets reimbursed' }])] } as never);
system.opportunities.curate({ ...base('famous_residential', 'src_residential'), category: 'summer_program', title: 'Famous Residential Engineering Program', cycles: [cycle('src_residential', [session({ residential: true, location: { country: 'GR', region: 'Central Macedonia', city: 'Thessaloniki', venue: null } })], free)] } as never);
system.opportunities.curate({ ...base('remote_course', 'src_remote'), category: 'course', title: 'Remote Engineering Course', cycles: [cycle('src_remote', [session({ format: 'online', location: null, schedule: { timezone: 'America/Los_Angeles', dailyStart: '15:00', dailyEnd: '17:00', weekdays: [1, 3] }, hoursPerWeek: 4 })], free)] } as never);

// ---- A fictional student and what they already told the app ------------------------------------

const student: shared.Actor = { id: 'acct_amara', kind: 'student', tenantId: TENANT };
const studentId = system.createStudent({ tenantId: TENANT, ownerActorId: student.id });
const told = (attribute: string, value: unknown, extra: Record<string, unknown> = {}) =>
  record.buildClaim({ attribute, value, origin: 'student_statement', confirmation: 'student_confirmed', evidence: [record.conversationEvidence('conv_setup', 'turn_setup', JSON.stringify(value), 'text')], actor: student, viaRole: 'ui', ...extra });
const fromTranscript = (entityId: string, attribute: string, value: unknown, text: string, review?: 'needs_confirmation') =>
  record.buildClaim({ entity: 'course', entityId, attribute, value, origin: 'document_extraction', evidence: [{ kind: 'document_anchor', documentId: 'doc_demo', documentVersion: 1, page: 1, region: { kind: 'table_cell', tableIndex: 0, row: 0, column: 0 }, originalText: text, method: 'text_layer' }], actor: student, viaRole: 'ui', ...(review ? { extractionReview: { state: review, candidates: [] } } : {}) });
const result = system.kernel.records.applyMutation({ actor: student, viaRole: 'ui', purpose: 'counseling' }, TENANT, studentId, {
  mutationId: 'demo_setup',
  operation: 'add_claims',
  expectedRecordVersion: 0,
  reason: 'profile set up in the app',
  targetClaimIds: [],
  claims: [
    told('constraints.location_broad', { country: 'GR', region: 'Attica', city: 'Athens' }),
    told('constraints.timezone', 'Europe/Athens'),
    told('constraints.travel', { overnightTravelPossible: false, maxTravelMinutes: 60, travelDuringTermPossible: null }),
    told('constraints.opportunity_budget', { amount: { amount: '150.00', currency: 'EUR' }, kind: 'hard_cap', covers: 'all', appliesTo: 'per_opportunity' }),
    told('constraints.availability_windows', [{ start: '2027-06-20', end: '2027-08-31', ongoing: false }]),
    told('constraints.weekly_hours_available', { min: 10, max: 25 }),
    told('description', { text: 'I want to explore engineering and building things', lens: 'interest' }, { entity: 'interest', entityId: 'i1' }),
    fromTranscript('c1', 'name_original', 'Mathematics: Analysis and Approaches', 'Mathematics: Analysis and Approaches'),
    fromTranscript('c1', 'subject_mapping', { key: 'ib.math_aa', basis: 'verified_mapping' }, 'Mathematics: Analysis and Approaches'),
    fromTranscript('c1', 'grade', { original: '6', scaleRef: 'ib_subject_1_7', status: 'predicted', weighting: null }, '6'),
    // The level was hard to read on the scan, so it needs the student's confirmation.
    fromTranscript('c1', 'level', { original: 'HL', normalized: 'IB_HL' }, 'HL?', 'needs_confirmation'),
  ],
});
if (result.outcome !== 'accepted') throw new Error(`setup failed: ${result.reasons.join('; ')}`);

// ---- The conversation ---------------------------------------------------------------------------

function show(label: string, r: CounselorResponse): void {
  console.log(`\n=== ${label} ===`);
  if (!r.accepted || !r.answer) {
    console.log(`(not shown: ${r.issues.join('; ') || r.status})`);
    return;
  }
  const a = r.answer;
  console.log(a.headline);
  for (const s of a.sections) console.log(`  - [${s.label}] ${s.title}: ${s.summary}`);
  if (a.question) {
    console.log(`  ? ${a.question.text}`);
    if (a.question.options.length > 0) console.log(`    options: ${a.question.options.join(' | ')}`);
    console.log(`    why: ${a.question.whyNeeded}`);
  }
  for (const n of a.notices) console.log(`  i ${n.message}`);
  console.log(`  progress: ${a.progress.map((p) => `${p.task} (${p.state})`).join(', ') || 'none'}`);
}

const target = { institutionRef: 'example_university', campusRef: null, programRef: 'beng_engineering', degreeLevel: 'undergraduate_first_degree' as const, entryCycle: '2027', applicantCategory: 'first_year' as const, decisionStage: 'application' as const };

const first = await system.ask(student, TENANT, studentId, { text: 'I want engineering, but I also need a summer activity. Can you plan everything?', context: { targets: [target] } });
show('Student: "I want engineering, but I also need a summer activity. Can you plan everything?"', first);

const objectiveId = first.objectiveId!;
const second = await system.reply(student, TENANT, studentId, objectiveId, 'Yes, it is HL');
show('Student: "Yes, it is HL"', second);

const reviewItems = second.answer?.question?.reviewItems ?? [];
const third = await system.confirm(student, TENANT, studentId, objectiveId, reviewItems.map((i) => ({ claimId: i.claimId, decision: 'approve' as const })));
show('Student approves the recorded answer', third);

show('Student: "How is it going?"', await system.status(student, TENANT, studentId, objectiveId));
show('Background updates', await system.updates(student, TENANT, studentId));
console.log(`\nExternal actions sent without approval: ${system.kernel.actions.countByState('executed')}`);
