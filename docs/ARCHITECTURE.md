# Architecture

This document explains how agents 01–09 are built and how they work together. It follows the specification's *Deployment structure*: one orchestration service, one record service, a document worker, a public-source service and bounded specialists. The nine roles are modules with their own contracts and permissions. Shared services own the records, rules, files and task state, so no specialist keeps its own copy of the student's profile.

## The pieces

```
                 app / website back end
                          │
                  CounselorSystem            src/system/counselor-system.ts
                          │  ask · reply · confirm · status · cancel · resume · updates · uploadDocument · delete… · approveAction
                          ▼
                    SystemKernel             src/system/kernel.ts
   ┌──────────────┬───────┴──────┬───────────────┬────────────────┬──────────────┐
 ToolGateway   RecordService   RulePackage    EventBus     ExternalAction   HumanReview
 (+ budgets,   (Agent 04:      Registry       (at-least-   Service          Service
 cancellation) claims,         (Agent 06      once, dedup,  (proposals       (staffed queue
               permissions,    rules)         dead letter)  only)            or referral)
               artifacts,
               deletion)
                          │
        specialists 01–09 (each: SpecialistAgent { role, contracts, handle(ctx) })
                          │
     system-level stores: ConversationStore · IntakeSessionStore · DocumentStore ·
     SubjectKnowledgeRegistry · TestCalendarRegistry · OpportunityCatalog · ObjectiveStore
```

| Service | Where | Owns |
|---|---|---|
| Record service (Agent 04) | `src/agents/a04-record-steward/service.ts` | Typed claims with evidence, conflicts, the record version, derived artifacts and their inputs, invalidation, deletion and the deletion ledger, backup and restore, the outbox of domain events |
| Permission service | `src/agents/a04-record-steward/permissions.ts` | Grants by data category and access level, purpose checks, live re-authorization, the permission snapshot |
| Tool gateway | `src/runtime/tool-gateway.ts` | The role × tool matrix and the check made on every call |
| Budgets, cancellation, task graph | `src/runtime/budget.ts`, `cancellation.ts`, `task-graph.ts` | Enforced effort limits, parent/child cancellation, dependency waves |
| Result validation | `src/runtime/validation.ts`, `grounding.ts` | Contract checks before any result is accepted |
| Event bus | `src/runtime/event-bus.ts` | At-least-once delivery, per-consumer dedup, retries, dead letters with an accountable owner |
| External actions | `src/runtime/external-actions.ts` | Proposals, explicit approval, idempotent execution through adapters (none shipped) |
| Human review | `src/runtime/human-review.ts` | A queue with a named owner when staffed; a referral when not |
| Model gateway | `src/model/` | Structured, schema-validated model calls; a null gateway when no model is configured; a scripted gateway for tests |
| Audit log | `src/runtime/audit.ts` | Privacy-conscious records of tool calls, denials, incidents and review requests (names and outcomes, never values) |

Every store is in memory behind a small interface. A deployment swaps in durable storage behind the same interfaces (see the README's integration notes).

## One request, end to end

1. **The app calls `CounselorSystem.ask`.** The system first makes the same authorization check the kernel will make; a message from someone who may not act for this student is refused and nothing is stored. Otherwise the message is stored as a conversation turn. A repeated `deliveryKey` maps to the same turn, so a duplicate delivery has no second effect.
2. **The kernel builds a role-01 request envelope** (`kernel.buildRequest`). It holds the live record version, the actor's permission snapshot, the role's allowed tools, the role's budget, the completion contract `counselor_turn_v1` and an idempotency key.
3. **`kernel.invoke` checks the request before any private data is read.** It checks the schema, the registered specialist and contract, that the actor is a person (agents act only for people), live authorization, and that the permission snapshot is still current.
4. **Agent 01 classifies the request.** Rules run first. The model is used only as a fallback, and its reading must quote the message verbatim. Agent 01 then plans the smallest useful task graph (`planner.ts`) and creates or reuses an objective in the `ObjectiveStore`.
5. **Agent 01 runs the graph in waves** (`runWaves`). Each node is a `specialist.invoke` call, which starts a child task:
   - the child's actor, tenant and student come from the parent task, never from arguments;
   - its purpose is fixed by the role (`ROLE_PURPOSE`);
   - its budget and cancellation token are children of the parent's.

   Before each wave, and after each node, a checkpoint is saved so that `status` and `cancel` see live state.
6. **Each child result is validated against the child's own contract** (see *Validation* below) before the coordinator treats it as accepted. A rejected result gets one bounded repair. A denial stays blocked and is never retried through another role.
7. **Agent 01 reconciles the results.** Scope conflicts (cycle against cycle, or against the record's entry cycle), fact conflicts reported by Agent 04, and rule conflicts are surfaced, never settled by majority vote. Results that went stale while the graph ran are revalidated once.
8. **Missing facts go to Agent 02 as targeted gap intake.** The flow is question, then review, then `confirm_review`. Waiting work then resumes, and results already obtained are kept.
9. **Agent 01 composes the answer**, useful result first. `checkAnswer` rejects guarantee language, implied human review, a completed answer that still carries a question, proposals presented as done, and duplicate sections. The answer is then validated against `counselor_turn_v1` like any other result.

## The tool gateway

Agents never hold service references. They receive a `TaskContext` whose only capability is `ctx.call(tool, args)`. For every call, the gateway checks, in order:

1. that the task has not been cancelled;
2. that the tool exists;
3. that the role may use the tool (`ROLE_TOOL_MATRIX`);
4. that the tool was granted to this task (the task's allow-list, which can only narrow the matrix);
5. that the arguments match the tool's schema;
6. that any `tenantId` or `studentId` argument matches the task (object scope);
7. that budget is left (consumed before the work is done);
8. that the acting person is still authorized (revocation takes effect immediately).

A denial is recorded in the audit log (tool name and denial code, no values) and returned as an `AccessDeniedError`. Services check permissions again behind the gateway, as defense in depth.

| Role | Tools |
|---|---|
| 01 | `record.read_scoped`, `record.read_status`, `tasks.create`, `tasks.cancel`, `tasks.checkpoint`, `specialist.invoke`, `review.request`, `actions.propose`, `artifacts.read` |
| 02 | `record.read_scoped`, `record.propose_change`, `conversation.read_turn`, `conversation.redact_turn`, `intake.session` |
| 03 | `files.read_quarantined`, `files.parse_sandboxed`, `record.read_scoped`, `record.propose_change` |
| 04 | `record.read_scoped`, `record.propose_change`, `record.commit_validated`\*, `record.resolve_conflict`, `record.delete_scoped`, `permissions.manage`\*, `artifacts.put_derived`, `artifacts.read` |
| 05 | `record.read_scoped`, `record.propose_change`, `conversation.read_turn`, `sources.read_verified`, `artifacts.put_derived`, `actions.propose` |
| 06 | `record.read_scoped`, `rules.read_verified`, `artifacts.put_derived` |
| 07 | `record.read_scoped`, `rules.read_verified`, `calendars.read_verified`, `artifacts.read`, `artifacts.put_derived`, `actions.propose` |
| 08 | `record.read_scoped`, `record.propose_change`, `conversation.read_turn`, `artifacts.put_derived` |
| 09 | `record.read_scoped`, `research.search_public`, `research.fetch_public`, `opportunities.read_catalog`, `opportunities.upsert_catalog`, `rules.read_verified`, `artifacts.read`, `artifacts.put_derived`, `actions.propose` |

\* The matrix reserves these two capabilities for role 04, but this volume registers no tool for them. Commits happen inside the record service after it has validated a proposed mutation. Grants are managed by people through the permission service. Any call to either name is denied.

No role holds a tool that sends, pays, registers, enrolls or submits. `actions.propose` only creates a proposal.

## The record and its evidence

- **Claims.** Every student fact is a typed claim:
  - its field (entity, entity id, attribute) and holder;
  - its value;
  - its origin (student statement, document extraction, counselor entry and so on);
  - its confirmation (`unreviewed`, `student_confirmed`, `counselor_confirmed`, `issuer_verified`, `human_reviewed`);
  - its lifecycle (`considering`, `planned`, `enrolled`, `in_progress`, `completed`, `cancelled`, `current`);
  - its dispute state;
  - one or more evidence references: a conversation turn, a document anchor with page and region, or a review decision.
- **Mutations.** Agents *propose* mutations (`record.propose_change`). The service validates them against the field catalog (`src/shared/fields.ts`), the expected record version, lifecycle rules and permissions, then commits or rejects them. When two sources disagree, the field becomes a conflict and both values are kept.
- **Scoped views.** `record.read_scoped` returns a permission-filtered view for the calling role, in one of two modes:
  - `model_context` returns only the categories the role may place in a model prompt (`ROLE_MODEL_CONTEXT_CATEGORIES`);
  - `local` returns the wider set its deterministic code may evaluate (`ROLE_LOCAL_CATEGORIES`).

  For example, Agent 09 checks a citizenship condition locally. That status never reaches a model or a search provider.
- **Served claim IDs.** Every claim served to a task is recorded on the task context. A result may cite only claims and sources that were served to it.

## Derived artifacts, invalidation and deletion

- **Artifacts.** Findings, plans, matches, shortlists and objectives are stored as derived artifacts (`artifacts.put_derived`). Each artifact records what it was built from: claim IDs, field-key patterns (including wildcards), rule versions, source IDs, the record version and the producing task.
- **Invalidation.** A change to any of those inputs marks every dependent artifact `stale`, with a reason:
  - a correction to a field;
  - a new rule-package version (`RulePackageRegistry.onChange` calls `invalidateEverywhereByRuleOrSource`);
  - a material change to a curated opportunity (`connectOpportunityCatalog`).

  Consumers see the stale state and recompute; nothing silently keeps an old answer.
- **Deletion.** Deleting a claim, a document or the whole record (`deleteFact`, `deleteDocument`, `deleteAccount`) purges every artifact built from it. It also purges every registered derivative store: conversations, intake sessions, documents and the objective store, including cached answers. Each deletion is written to the deletion ledger, and processors are notified. A backup restore re-applies the ledger, so deleted content does not come back. Account deletion takes precedence over work in flight: the student's running tasks are cancelled, and all access ends before the stores are purged, so nothing still running can read or re-create deleted content.

## Events

`src/shared/events.ts` defines the event contract. An event carries only references: an entity ref, versions, the *names* of changed fields, a cause ref, and `sensitivePayloadIncluded: false`. It never carries values. Consumers read the authorized current view when they run, so a permission change takes effect even for an event created earlier.

The record service writes events to an outbox. The kernel moves them to the bus after each task and drains the bus. Delivery is at least once:

- each consumer handles an event ID once, so duplicates have no effect;
- a failing consumer gets up to three attempts, then the event goes to a dead-letter queue with an accountable owner;
- `retryDeadLetters` is the recovery procedure.

No agent in this volume depends on an event to stay correct. Dependents are marked stale in the same step that commits a change, and every agent reads the current state when it runs. The bus is the integration point for the app's notifications and for the later roles.

## Budgets and cancellation

- **Budgets.** Each role has a default budget (`DEFAULT_ROLE_BUDGETS`) covering tool calls, model calls, revisions, and optionally time and tokens. A child budget can never exceed what its parent has left, and all child usage also counts against the parent. The role-01 budget is therefore the aggregate for the whole request. Agent 01 also caps its own model calls (3) and repairs (1), keeps back 5 tool calls so it can always save the objective and finish the answer, and gives each child in a wave an equal share of what remains, capped at the child role's default. An exhausted budget stops work before the call. The answer then names what was not done.
- **Cancellation.** Cancellation tokens form a tree. `cancel` can stop a whole objective or one branch; for example, `cancel(…, '09')` stops only the opportunity search. A result that arrives after cancellation is never published.

## Validation

`validateResult` runs on every specialist result, including Agent 01's own:

- **Envelope.** The envelope schema is checked, along with the task identity and role (not repairable), the completion contract, and that the permission snapshot is unchanged (not repairable; the result must be regenerated).
- **Inputs.** The result must not be computed from an older record version. Cited claims and sources must have been served to the task. An uncertainty must say what it affects, not just "may be inaccurate".
- **Contract.** The payload is checked against the contract's schema. Failed, blocked and cancelled results carry a standard error payload instead.
- **Semantics.** The contract's semantic checks run. For example: no admission probability; an "action ready" opportunity must have a current cycle and a resolved deadline time zone; a plan must not promise a score gain.
- **Grounding.** Every date, amount and percentage in the summary must appear in the structured payload.

A result that fails validation is not shown. Agent 01 names it as a gap.

## Models and untrusted content

- **Model calls.** Models are optional. Every model call goes through `ModelGateway.generate`, returns a schema-validated object or a typed failure, consumes the task's model budget, and carries a stable `purpose`:
  - `counselor.classify_request`, `counselor.explain_concept`;
  - `intake.interpret_answer`;
  - `document.transcribe_layout`, `document.working_translation`;
  - `goals.discriminating_questions`;
  - `activities.structure_experience`;
  - `opportunities.read_listing`.

  Every caller has a deterministic path for when no model is configured or the call fails.
- **Untrusted content.** Documents, web pages, search results and student text are fenced with an unguessable boundary and labelled as data (`fenceUntrusted`). Instruction-like patterns are detected and surfaced as a review signal (`detectInjectionSignals`). Detection is a signal, not the defense. The defense is architectural: no text, however phrased, can change what the gateway permits.
- **Verbatim quotes.** Model outputs that claim something the student or a document said must quote it verbatim. The quote is checked against the source text before it is used.

## Public research (Agent 09)

- **Queries.** Search queries are built from a strict schema (`GeneralizedQuerySchema`): topics from a controlled vocabulary, categories, country, a city checked against a place list, format, audience, cost focus and year. There is no free-text field, so no name, grade, birth date or address can reach a provider.
- **Fetching.** Pages are fetched only from public HTTPS URLs. `isPublicHttpsUrl` refuses IP-address hosts, `localhost` and internal name suffixes, credentials in URLs and non-standard ports. Because a public name can still resolve to a private address, the deployment's fetcher must also refuse private addresses at connection time. Login, CAPTCHA and paywall pages are not bypassed. Every page is hashed. A finalist is re-verified against its page hash before it is called action-ready.
- **Matching and ranking.**
  - Matching against the student's constraints runs locally and reuses Agent 06's rule engine.
  - Ranking is transparent: the features are listed and there is no sponsorship feature.
  - At most two results come from the same organizer.
  - An accessible alternative is always considered.

## Human review

`review.request` takes a minimum-necessary packet: the question, scope, facts with their provenance and status, source excerpts, competing interpretations, the consequence of delay, the deadline and the requested decision. Its outcome depends on staffing:

- **Staffed** (a named queue owner is configured): the case is queued, and the answer states the response expectation that was configured.
- **Not staffed:** the student gets a referral, meaning the question to take to a school counselor or admissions office and what to bring. The system never implies that someone has accepted a case.

## Adding agents 10–36

The later roles plug in the same way:

1. implement `SpecialistAgent`;
2. register its contracts;
3. add its row to `ROLE_TOOL_MATRIX`, `DEFAULT_ROLE_BUDGETS` and the data-category tables;
4. give it a purpose in `ROLE_PURPOSE`;
5. register it in `CounselorSystem`.

Agent 01 already routes requests that belong to later roles (essays, interviews, financial aid, timelines and so on) to typed handoffs (`laterRolesFrom`). Its planner is where a new role's nodes would be added.
