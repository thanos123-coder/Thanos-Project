# AI College Counselor: agents 01–09

The first nine specialist agents of the AI College Counselor, and the system that runs them together. They are built to the *Agents 01–09 Deep Specification* and the whole-app blueprint. They are written in TypeScript and designed to sit behind both a mobile app and a website.

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

Agents 10–36 are not part of this volume. Where the specification hands work to them (essays, interviews, financial aid, timelines, human coordination), the agents return typed handoffs and say plainly that the service is not available yet.

## Quick start

Requires Node.js 22.12 or later.

```bash
npm install
npm run check      # typecheck + the full test suite (291 tests, no network, no model)
npm run demo       # the spec's worked interaction, end to end, with real agents
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
```

The system exposes these entry points: `ask`, `reply`, `confirm`, `status`, `cancel`, `resume`, `updates`, `uploadDocument`, `pendingActions`, `approveAction` and `rejectAction`. Lower-level access to every agent module is available through the namespaces exported from the package root (`leadCounselor`, `intake`, `documents`, `record`, `goals`, `eligibility`, `planner`, `activities`, `opportunities`, `shared`, `runtime`, `model`).

## What is enforced in code, not left to a prompt

- **One record, explicit ownership.** Only Agent 04 writes student facts. Every fact is a claim with its origin, confirmation, lifecycle, holder and evidence. Disagreeing sources become a conflict, and both values are kept.
- **Permissions at every call.** The tool gateway checks each call against the role's tool matrix, the task's allow-list, the argument schema, the tenant and student, the budget, and the person's live authorization. A revoked grant stops queued work. A denial is never retried through another role.
- **Minimum necessary data.** Each role sees only its data categories, and model prompts get a smaller set than local code does. Public search queries are built from a controlled vocabulary with no free-text field, so a name, birth date or grade cannot reach a search provider.
- **Nothing external without approval.** Agents can only *propose* messages, registrations and contact. Nothing is sent, paid, submitted or enrolled. Approval is a separate human step, and execution needs an integration this volume deliberately does not ship.
- **Deterministic decisions.** Eligibility, dates, time zones, money, budgets and ranking are computed by code. Unknown is never treated as "fine", and a missing deadline time zone stays unresolved. Aid is never counted as awarded, and sponsorship cannot reach the ranking.
- **Validated results.** Every specialist result is checked against its contract (schema, semantics, cited claims and sources, and summary grounding) before anyone sees it. The coordinator allows one bounded repair. A result that still fails validation is left out and named as a gap.
- **Change propagation.** A correction, a new rule version or a changed opportunity marks every dependent result stale. Deleting a document, fact or record purges every result and cached answer built from it.
- **Honest limits.** Unsupported coverage (for example graduate admissions) is stated rather than guessed. An unstaffed human review becomes a referral the student can take to a counselor, never a pretend escalation. No-result searches say what was searched and offer real alternatives.

The architecture is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), each agent in [docs/AGENTS.md](docs/AGENTS.md), and the mapping of all 103 requirements and 164 acceptance cases to code and tests in [docs/TRACEABILITY.md](docs/TRACEABILITY.md).

## Models

Every agent works without a model. The deterministic path covers every consequential decision, and the whole test suite runs with no model. When a model is configured (`model.AnthropicModelGateway`, default `claude-opus-5` with adaptive thinking), it is used only for bounded, validated steps:

- interpreting free-text answers;
- reading difficult document pages;
- structuring activity descriptions;
- drafting discriminating questions;
- reading public listing pages;
- classifying an unusual request;
- giving a general concept explanation.

Each output must match a schema and, where it claims something, quote the student's or the document's exact words. Untrusted content (documents, web pages, student text) is always fenced as data. Check your provider's data-use terms before telling students how their data is handled.

## Integrating with a real deployment

This package holds the agents and their contracts. Some decisions and services belong to the deployment:

- **Persistence.** The record service, task state, document store, conversation store, catalog and registries are in-memory, behind small interfaces. Production needs durable storage behind the same interfaces, including the deletion ledger and backup-restore rules.
- **Identity.** Map your authenticated accounts to `Actor` (student, supporter, school counselor and so on). Grants are created by the student, or by a school administrator under a school-contract basis.
- **Public research providers.** Supply a `SearchProvider` and `FetchProvider`. The fetcher must also refuse private and loopback addresses at connection time.
- **Document security.** Supply a malware scanner.
- **Reviewed content.** Rule packages and opportunity-catalog entries need qualified review before they are used. The code refuses unreviewed rule packages and unverified sources, but the review workflow itself belongs to your team.
- **Human review staffing.** Configure staffing only when a named team really answers the queue.
- **Launch decisions.** Markets, languages, age model, retention and external-action integrations are decisions the specification lists under "Decisions to finalize before launch".

All institutions, programs, opportunities, people, dates and amounts in the tests, fixtures and demo are fictional.

## Project layout

```
src/
  agents/a01-orchestrator … a09-opportunities   one module per role (agent, contracts, deterministic logic)
  agents/common                                  specialist contract, student-facts accessors
  runtime/                                       tool gateway, budgets, cancellation, task graph, events, validation, grounding, human review, external actions
  model/                                         model gateway, Anthropic adapter, scripted test gateway
  shared/                                        typed contracts: claims, evidence, time, money, grades, tests, scope, permissions, envelopes, events
  system/                                        kernel, CounselorSystem, orchestration tools, catalog wiring
test/
  agents/        one suite per agent (its acceptance cases and more)
  system/        the cross-agent acceptance suite (XT01–XT20)
  docs/          keeps the traceability matrix in step with the code
examples/demo.ts
docs/            ARCHITECTURE.md, AGENTS.md, TRACEABILITY.md
```
