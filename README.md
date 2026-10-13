# AI College Counselor: agents 01–18

The first eighteen specialist agents of the AI College Counselor, and the system that runs them together. Agents 01–09 are built to the *Agents 01–09 Deep Specification* and the whole-app blueprint; Agents 10–18 to the *Agents 10–18 Deep Specification*. They are written in TypeScript and designed to sit behind both a mobile app and a website.

| Role | Agent | What it does | Contract |
|---|---|---|---|
| 01 | Lead counselor and orchestrator | Turns a request into the smallest useful task graph, delegates to specialists, validates and reconciles their results, and answers with the useful result first | `counselor_turn_v1` |
| 02 | Intake interviewer | Asks only for missing, consequential facts, by text or voice, with confirmation and review before they are used | `intake_turn_v1` |
| 03 | Document and transcript interpreter | Quarantines, parses and extracts transcripts and certificates exactly as printed, with source anchors | `document_import_v1` |
| 04 | Student record and evidence steward | Owns the one student record: typed claims with evidence, conflicts, permissions, invalidation and deletion | `record_change_v1`, `record_explanation_v1` |
| 05 | Goals and major exploration advisor | Builds a few revisable hypotheses and low-cost experiments from the student's own examples | `exploration_v1` |
| 06 | Curriculum and eligibility contextualizer | Checks a record against a reviewed rule package for an exact program, cycle, category and stage | `eligibility_finding_v1` |
| 07 | Academic and testing planner | Plans courses and tests from findings and real constraints, with dependencies, costs and alternatives | `academic_plan_v1` |
| 08 | Activities and experience assessor | Records what the student actually did and learned, without inflation or a "worth" score | `experience_record_v1` |
| 09 | Opportunity research scout | Finds opportunities a student can really access, with complete costs, current cycles and honest no-result answers | `opportunity_dossier_v1` |
| 10 | Project mentor and workload planner | A genuine student-owned project at a sustainable pace: milestones, evidence, a schedule within real time, an honest completion record | `project_plan_v1` |
| 11 | Official college and program researcher | Scoped, anchored claims from official sources, with dates, versions and unresolved conflicts | `evidence_packet_v1` |
| 12 | College and program fit matcher | An explainable shortlist from the student's own priorities, with tradeoffs and missing information | `fit_shortlist_v1` |
| 13 | Admissions uncertainty advisor | How selective an option is, with definitions, and never invented personal odds | `admissions_uncertainty_v1` |
| 14 | Application portfolio and round strategist | A versioned, affordable, feasible plan with valid round combinations, coverage gaps and a real schedule | `portfolio_plan_v1` |
| 15 | Affordability and financial aid planner | Exact cost scenarios, gift aid separate from loans and work, award reconciliation and cash timing | `affordability_ledger_v1` |
| 16 | Scholarship eligibility and matching advisor | Verified awards with the deciding eligibility reasons, dependencies, trust status and next steps | `scholarship_matches_v1` |
| 17 | Personal essay brainstorming interviewer | A student-approved story bank built through one question at a time, in text or voice; no essay text | `story_session_v1` |
| 18 | Narrative portfolio coordinator | A policy-permitted look across responses: lengths, required fields, unanswered asks, anchored repetition, facts that disagree | `narrative_review_v1` |

Agents 19–36 are not part of these volumes. Where the specifications hand work to them (draft feedback, interviews, recommendations, application forms, offers), the agents return typed handoffs and say plainly that the service is not available yet. Nothing in the first eighteen writes an essay for the student.

## Quick start

Requires Node.js 22.12 or later.

```bash
npm install
npm run check      # typecheck + the full test suite (no network, no model needed)
npm run demo       # the spec's worked interaction, end to end, with real agents
npm run demo:v2    # volume two: a round conflict, a repaired plan, an essay request turned into brainstorming
npm run build      # compiles the library to dist/
```

Using it from an app or website back end:

```ts
import { CounselorSystem, model } from 'ai-college-counselor-agents';

const counselor = new CounselorSystem({
  model: new model.AnthropicModelGateway(),          // optional: every agent also runs without a model
  research: { search: mySearchProvider, fetch: myFetchProvider },
  reviewStaffing: { staffed: true, queueOwner: 'Counseling team', responseExpectation: 'within 2 school days' },
});

const studentId = counselor.createStudent({ tenantId, ownerActorId: account.id });
const actor = { id: account.id, kind: 'student', tenantId };

const answer = await counselor.ask(actor, tenantId, studentId, {
  text: 'I want engineering, but I also need a summer activity. Can you plan everything?',
  deliveryKey: clientMessageId,                        // a repeated delivery has no second effect
  context: { targets: [selectedProgram] },             // what the interface already knows
});
// answer.answer.headline, .sections, .question, .progress, .externalActions ...

await counselor.reply(actor, tenantId, studentId, answer.objectiveId!, 'Yes, it is HL');
await counselor.confirm(actor, tenantId, studentId, answer.objectiveId!, decisions);
await counselor.status(actor, tenantId, studentId, answer.objectiveId!);
await counselor.cancel(actor, tenantId, studentId, answer.objectiveId!, '09');   // stop the search only
await counselor.resume(actor, tenantId, studentId, answer.objectiveId!);
await counselor.updates(actor, tenantId, studentId);                            // background changes to review
await counselor.deleteAccount(actor, tenantId, studentId);                      // stops running work, then purges everything
```

The system exposes these entry points: `ask`, `reply`, `confirm`, `status`, `cancel`, `resume`, `updates`, `uploadDocument`, `deleteDocument`, `deleteFact`, `deleteAccount`, `pendingActions`, `approveAction` and `rejectAction`. A message from someone who may not act for the student is refused before anything is stored. Lower-level access to every agent module is available through the namespaces exported from the package root (`leadCounselor`, `intake`, `documents`, `record`, `goals`, `eligibility`, `planner`, `activities`, `opportunities`, `projects`, `officialResearch`, `fit`, `admissionsUncertainty`, `portfolio`, `affordability`, `scholarships`, `stories`, `narrative`, `shared`, `runtime`, `model`). The shared stores the second nine use (institution claims, scholarship catalog, model registry, assistance policies, project notebook, story bank and draft registry) are properties of `CounselorSystem`, so a deployment can load reviewed content into them.

## What is enforced in code, not left to a prompt

- **One record, explicit ownership.** Only Agent 04 writes student facts. Every fact is a claim with its origin, confirmation, lifecycle, holder and evidence. Disagreeing sources become a conflict, and both values are kept.
- **Permissions at every call.** The tool gateway checks each call against the role's tool matrix, the task's allow-list, the argument schema, the tenant and student, the budget, and the person's live authorization. A revoked grant stops queued work. A denial is never retried through another role.
- **Minimum necessary data.** Each role sees only its data categories, and model prompts get a smaller set than local code does. Public search queries are built from a controlled vocabulary with no free-text field, so a name, birth date or grade cannot reach a search provider.
- **Nothing external without approval.** Agents can only *propose* messages, registrations and contact. Nothing is sent, paid, submitted or enrolled. Approval is a separate human step, and execution needs an integration this volume deliberately does not ship.
- **Deterministic decisions.** Eligibility, dates, time zones, money, budgets and ranking are computed by code. Unknown is never treated as "fine", and a missing deadline time zone stays unresolved. Aid is never counted as awarded, and sponsorship cannot reach the ranking.
- **Validated results.** Every specialist result is checked against its contract (schema, semantics, cited claims and sources, and summary grounding) before anyone sees it. The coordinator allows one bounded repair. A result that still fails validation is left out and named as a gap.
- **Change propagation.** A correction, a new rule version or a changed opportunity marks every dependent result stale. Deleting a document, fact or record purges every result and cached answer built from it.
- **Honest limits.** Unsupported coverage (for example graduate admissions) is stated rather than guessed. An unstaffed human review becomes a referral the student can take to a counselor, never a pretend escalation. No-result searches say what was searched and offer real alternatives.

- **Authorship.** Operation-specific assistance policies decide what help is allowed for each destination; the app's own boundary forbids essay text, outlines and translation of submission text everywhere. Output checks catch structure that works as an outline whatever it is labelled, and assistance history travels with copied material.

The architecture is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), each agent in [docs/AGENTS.md](docs/AGENTS.md) and [docs/AGENTS-V2.md](docs/AGENTS-V2.md). The mapping of all 103 requirements and 164 acceptance cases of volume one to code and tests is in [docs/TRACEABILITY.md](docs/TRACEABILITY.md), and the 180 acceptance cases of volume two in [docs/TRACEABILITY-V2.md](docs/TRACEABILITY-V2.md).

## How it is verified

- **Acceptance cases.** Every acceptance case in both specifications has a test named after it: 144 role cases and 20 cross-agent cases in volume one, 162 role cases and 18 cross-agent cases in volume two. `test/docs/traceability.test.ts` fails if a requirement loses its citation in the code or a case loses its test.
- **End to end.** Both cross-agent suites and both demos run the real agents together through `CounselorSystem`, with deterministic time, IDs and research providers.
- **Mutation check.** `npm run mutation` disables 126 safeguards one at a time and runs the tests that should notice. These cover permission checks, scope checks, validation rules, budgets, cancellation, deletion, PDF active-content detection, time zones, money and grades, and in volume two:
  - round-rule exceptions;
  - schedule capacity;
  - receipts;
  - cash timing;
  - award classification;
  - story retrieval and negation holds;
  - recording after a reconnect;
  - per-destination policy gates;
  - repetition scope;
  - inherited assistance history.

  Each must make at least one test fail. One case is marked equivalent (it cannot change behaviour), with the reason recorded in `scripts/mutations.json`. A case whose code has moved is reported as stale so the list stays current. The full run takes several minutes.

## Models

Every agent works without a model. The deterministic path covers every consequential decision, and the whole test suite runs with no model. When a model is configured (`model.AnthropicModelGateway`, default `claude-opus-5` with adaptive thinking), it is used only for bounded, validated steps:

- interpreting free-text answers;
- reading difficult document pages;
- structuring activity descriptions;
- drafting discriminating questions;
- reading public listing pages;
- classifying an unusual request;
- giving a general concept explanation;
- locating claims on an official page, where the rules did not cover the predicate (Agent 11; the quote must occur verbatim and the claim stays provisional until reviewed).

Each output must match a schema and, where it claims something, quote the student's or the document's exact words. Untrusted content (documents, web pages, student text) is always fenced as data. Check your provider's data-use terms before telling students how their data is handled.

## Integrating with a real deployment

This package holds the agents and their contracts. Some decisions and services belong to the deployment:

- **Persistence.** The record service, task state, document store, conversation store, catalog and registries are in-memory, behind small interfaces. Production needs durable storage behind the same interfaces, including the deletion ledger and backup-restore rules.
- **Identity.** Map your authenticated accounts to `Actor` (student, supporter, school counselor and so on). Grants are created by the student, or by a school administrator under a school-contract basis.
- **Public research providers.** Supply a `SearchProvider` and `FetchProvider`. The fetcher must also refuse private and loopback addresses at connection time.
- **Document security.** Supply a malware scanner.
- **Reviewed content.** Rule packages, opportunity-catalog entries, official college claims, scholarship records, numeric model cards and assistance policies need qualified review before they are used. The code refuses unreviewed rule packages and unverified sources, but the review workflow itself belongs to your team.
- **Human review staffing.** Configure staffing only when a named team really answers the queue.
- **Launch decisions.** Markets, languages, age model, retention and external-action integrations are decisions the specification lists under "Decisions to finalize before launch".

All institutions, programs, opportunities, people, dates and amounts in the tests, fixtures and demos are fictional.

## Project layout

```
src/
  agents/a01-orchestrator … a18-narrative       one module per role (agent, contracts, deterministic logic)
  agents/common                                  specialist contract, student-facts accessors
  policy/                                        operation-specific assistance policies and outline detection
  runtime/                                       tool gateway, budgets, cancellation, task graph, events, validation, grounding, human review, external actions
  model/                                         model gateway, Anthropic adapter, scripted test gateway
  shared/                                        typed contracts: claims, evidence, time, money, grades, tests, scope, permissions, envelopes, events
  system/                                        kernel, CounselorSystem, orchestration tools, catalog wiring
test/
  agents/        one suite per agent (its acceptance cases and more)
  system/        the cross-agent suites (volume one XT01–XT20, volume two XT01–XT18), kernel safeguards, access and deletion
  docs/          keeps the traceability matrix in step with the code
examples/        demo.ts (volume one), demo-v2.ts (volume two)
web/             website UI prototype (design only, sample data): open web/index.html
scripts/         mutation check (mutation-check.mjs, mutations.json)
docs/            ARCHITECTURE.md, AGENTS.md, AGENTS-V2.md, TRACEABILITY.md, TRACEABILITY-V2.md
```
