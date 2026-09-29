# The nine agents

Agents 10–18 are described in [AGENTS-V2.md](AGENTS-V2.md).

A reference for each role: what it does, how it is called, what its result guarantees, which tools it holds and how it uses a model. The requirement-by-requirement mapping is in [TRACEABILITY.md](TRACEABILITY.md), and the shared machinery is in [ARCHITECTURE.md](ARCHITECTURE.md).

Every agent implements `SpecialistAgent { role, contracts, handle(ctx) }` (`src/agents/common/specialist.ts`). It receives a `TaskContext` and returns a result envelope, which the kernel validates against the agent's contract before anyone sees it. Agents 02–09 are normally started by Agent 01 through `specialist.invoke`. Each can also be run directly through the kernel, which is how their own test suites drive them.

Common to all nine:

- They read the record only through `record.read_scoped`, and write only by proposing changes to Agent 04.
- They cite only claims and sources that were served to them.
- They never send, pay, register, enroll or submit anything; at most they create a proposal for a person to approve.
- They name uncertainty specifically: what it affects and how to resolve it.
- They work fully without a model. A model, when configured, is used only for bounded steps whose output is schema-checked.

---

## 01 · Lead counselor and orchestrator

`src/agents/a01-orchestrator/` · contract `counselor_turn_v1` · tests `test/agents/a01-orchestrator.test.ts`

Turns a student's request into the smallest useful task graph, runs the specialists, validates and reconciles their results, and answers with the useful result first.

**Actions**

| Action | What it does |
|---|---|
| `request` | Classify the request, plan the graph, create or reuse an objective, run the graph and answer |
| `answer` | Record the student's reply to the pending question (through Agent 02), then resume the waiting work |
| `confirm_review` | Apply the student's approve / edit / leave-unresolved decisions on recorded answers, then resume |
| `status` | Report progress on an objective without changing it |
| `cancel` | Stop an objective or one branch of it; late results are discarded |
| `resume` | Continue from the last checkpoint. Work that was pending, waiting, stale, failed, cut short by the budget, or cancelled along with the whole objective runs again. A branch the student cancelled on its own stays cancelled |
| `review_updates` | List results that went out of date in the background (findings, plans, saved opportunities, shortlists), most important first, each with its reason and a suggested next step |

**Modules**

- `intents.ts`: deterministic classification. It recognizes control commands, corrections, eligibility, planning, exploration, experiences, opportunities, guarantee requests and requests that belong to later roles. A model fallback (`counselor.classify_request`) is used only when the rules find nothing, and it must quote the message verbatim.
- `planner.ts`: builds the nodes (correction, documents, eligibility, plan, exploration, experiences, opportunities, intake) with dependencies and accepted states. It also states coverage limits, such as graduate programs.
- `objectives.ts`: the objective store, which is also a derivative store so deletion reaches it. Its operations cover deliveries (dedup by delivery key), checkpoints, the running map used for branch cancellation, and the task tools.
- `compose.ts`: sections, reconciliation (scope, fact and rule conflicts; no majority vote), urgent priorities, handoffs to later roles, and `checkAnswer`.
- `agent.ts`: the wave runner, gap intake, the single repair, revalidation of stale results, human review or referral, and the answer.

**The answer guarantees**

- No guarantee of admission or of a score.
- No implied human review unless a case was really queued.
- A completed answer carries no open question.
- Proposals are never described as done.
- Conflicts are shown with both sides.
- Every result that failed validation is named as a gap.

**Model use:** request classification (fallback only) and a general concept explanation (`counselor.explain_concept`). The explanation refuses dates, amounts, scores and institution-specific rules. Agent 01 caps itself at 3 model calls and 1 repair per request.

---

## 02 · Intake interviewer

`src/agents/a02-intake/` · contract `intake_turn_v1` · tests `test/agents/a02-intake.test.ts`, `test/agents/a02/parsers.test.ts`

Asks only for missing, consequential facts, by text or voice, and keeps every answer easy to review and correct. Its product is proposed facts and unresolved questions, never a profile or a judgment.

**Actions:** `start` (for an objective, or `fill_gaps` with target field keys), `answer`, `review`, `confirm_review`, `correct`, `reinterpret`, `switch_mode`, `stop`.

**Modules**

- `question-bank.ts` and `planner.ts`: choose the next question by consequence for the current objective, and skip what the record already holds.
- `interpreter.ts` and `parsers.ts`: read dates and date windows, money and budgets, weekly hours, travel limits, places, qualification systems and year levels (kept in the school's own terms), and yes / no / skip / decline / don't-know answers, all deterministically. They also handle hedges, negations, other people's preferences (kept attributed to them) and facts volunteered along the way.
- `review.ts`: the review step. Consequential answers are recorded as unconfirmed until the student approves them.
- `sessions.ts`: the conversation and intake-session stores, both derivative stores, and the intake tools, including turn redaction.

**Guarantees**

- Questions about prohibited private topics, and leading wording, fail the contract.
- Voice mode asks one main question at a time.
- There is no next question once the objective has enough information.
- A change of mode is offered, never assumed.
- Facts are proposed to Agent 04. There is no separate intake profile that could drift from the record.

**Model use:** interpreting a free-text answer that the parsers cannot read (`intake.interpret_answer`). Every candidate fact must quote the student's words verbatim and is then validated like a parsed one.

---

## 03 · Document and transcript interpreter

`src/agents/a03-document-interpreter/` · contract `document_import_v1` · tests `test/agents/a03-document-interpreter.test.ts`

Turns an authorized document into structured observations exactly as printed, each with a source anchor. It does not certify authenticity, recognize credentials, decide eligibility or convert grading systems.

**Scope:** `documentId`, optional version, `commit` (`immediately` or `after_review`), an optional working translation, `certifiedTranslationRequested`, and `verifyTextLayerWithVision`.

**Pipeline**

1. **Quarantine** (`quarantine.ts`). The real file type is sniffed, not taken from the filename. The quarantine also checks size, page and pixel limits, encryption, and the malware scan when a scanner is supplied.

   Active content in a PDF is read two independent ways: from the file's own text, including decompressed object streams and escaped names, and from what the parser resolves (scripts, attached files, links to local files or programs).
   - Attached files, Launch actions and links that open local files or programs are rejected.
   - Scripts and remote references are isolated, and nothing in the file is ever executed.
2. **Parse** in a sandbox. PDF text layers go through `pdf-text.ts` and `layout.ts`; CSV and JSON exports go through `structured.ts`.
3. **Interpret** (`interpret.ts`). This step covers the document class, identity match, grade scale, courses, levels, periods, statuses, offerings, tests, qualification and expected graduation. Ambiguous readings stay ambiguous, with their candidates listed.
4. **Import** (`import-claims.ts`). Claims are proposed to Agent 04 with page and region anchors.

**Guarantees**

- Authenticity is always `not_verified_by_issuer`.
- A preview row with alternative readings must be flagged for review.
- A working translation is labelled `planning_translation_not_certified`.
- Nothing is imported from a document whose subject does not match the account.
- Instructions inside a document are treated as data and flagged.

**Model use:** reading pages with no usable text layer (`document.transcribe_layout`, vision) and working translations (`document.working_translation`). Pages transcribed by a model are listed in the result.

---

## 04 · Student record and evidence steward

`src/agents/a04-record-steward/` · contracts `record_change_v1`, `record_explanation_v1` · tests `test/agents/a04-record-steward.test.ts`

Owns the one student record. Most of Agent 04 is the record service (`service.ts`), which every other role reaches through tools. The specialist handler (`agent.ts`) is its conversational entry point.

**Actions:** `apply_correction` (a student's correction, with their words as evidence) and `explain_fields` (what the record holds for a set of fields, where it came from, and whether it needs confirmation).

**The service**

- **Mutations** (`applyMutation`, `validation.ts`). Each is checked against the field catalog, the expected record version, lifecycle rules and permissions, then committed or rejected. Disagreement between sources becomes a conflict, and both values are kept.
- **Scoped views** (`views.ts`, `view-reader.ts`). Views are filtered by permission and by the calling role's data categories, in model-context or local mode.
- **Permissions** (`permissions.ts`). Grants are held per data category and access level. Every call re-authorizes against live grants. The permission snapshot lets a result computed under old permissions be rejected.
- **Derived artifacts.** Each records its inputs. Invalidation by field, rule version or source marks dependents stale.
- **Deletion.** A claim, a document or the whole account can be deleted. Every registered derivative store is purged, the deletion ledger is written, and processors are notified. A backup restore re-applies the ledger.
- **Explanations** (`explain.ts`, `whyDoYouThink`). They show where each value came from.

**Guarantees:** a correction that meets conflicting evidence is reported as a conflict, not as accepted. Every change reports the field names it touched and the artifacts it invalidated.

**Model use:** none. Access policy is never model-defined.

---

## 05 · Goals and major exploration advisor

`src/agents/a05-goals/` · contract `exploration_v1` · tests `test/agents/a05-goals.test.ts`

Turns the student's own examples into a few revisable hypotheses and small, feasible experiments. It does not diagnose personality, assign a major, predict a person's earnings or let a paid partnership steer a subject.

**Actions**

| Action | What it does |
|---|---|
| `goal_map` | Hypotheses from the student's recorded examples, plus experiments |
| `compare_options` | Compare two to four subjects on the student's own dimensions and ratings |
| `decision_aid` | Help with a school course choice or a university application, with a deadline |
| `explain_option` | What you study, occupations, earnings (always with geography, year and source) and routes |
| `respond_to_hypothesis` | Accept as tentative, reject or edit a hypothesis |
| `record_reflection` | Record what the student reflected after an experiment |
| `record_assessment` | Record an interest-inventory result with the instrument's name, version, language, form, licensing and consent |
| `prepare_contact` | Propose (never send) a message to a contact the student described |

**Modules:** `explore.ts` (hypotheses and evidence), `compare.ts`, `knowledge.ts` (the verified subject-knowledge registry and its tool), and `content.ts` (built-in reviewed subject profiles and experiments).

**Guarantees**

- Every hypothesis cites at least one of the student's own examples and is always `tentative`.
- Other people's preferences stay attributed to them.
- Personality, diagnostic, guarantee and motivation-judging language fails the contract.
- An experiment never contacts anyone and never requires public sharing.
- Sponsored content is disclosed.

**Model use:** drafting discriminating questions (`goals.discriminating_questions`). Each question is checked like any generated question.

---

## 06 · Curriculum and eligibility contextualizer

`src/agents/a06-eligibility/` · contract `eligibility_finding_v1` · tests `test/agents/a06-eligibility.test.ts`

Checks the student's actual record against a reviewed rule package for an exact institution, program, campus, degree level, entry cycle, applicant category and decision stage. It returns a finding requirement by requirement. It never predicts admission, certifies credentials, decides exceptions or treats a minimum as a competitive target.

**Scope:** one eligibility scope.

**Rule packages** (`rules.ts`, `registry.ts`)

- **Structure.** A package is a tree of `all`, `any`, `at_least` and `not` nodes over typed predicates: `subject_result`, `course_count`, `qualification`, `test_score`, `institution_gpa`, `completion_by`, `age`, `category`, `schooling_language_years`, `contextual_criterion` and `waiver_approved`.
- **What each rule records:** the stages it applies to, whether it is mandatory, the stages where future completion is permitted, the evidence expectation at each stage, and a verbatim quote from a source.
- **Refusals.** A draft package can neither affirm nor exclude eligibility. A package marked reviewed is refused at registration if it lacks its reviewer and review time, or if any rule cites a source that is not official or is stale or retracted. A new package version invalidates every finding built on the old one.

**Engine** (`engine.ts`)

- Each rule evaluates to `met`, `not_met`, `unknown` or `not_applicable`, both as-is and with permitted routes (such as future completion).
- The overall state is derived from the rule states.
- An unknown mandatory rule names what resolves it and who owns that.
- `mostUrgent` ranks the missing inputs, which Agent 01 uses to pick the intake question.

**Guarantees**

- The overall state must follow from the rule states.
- An unsupported case can only be `outside_supported_coverage` or `unresolved`.
- `admissionProbability` is always null, `institutionalDecision` is always false, and `competitivenessAssessed` is always false.
- Guarantee wording fails the contract.

**Model use:** none. Eligibility is computed by code.

---

## 07 · Academic and testing planner

`src/agents/a07-planner/` · contract `academic_plan_v1` · tests `test/agents/a07-planner.test.ts`

Turns verified findings, the student's goals and real constraints into a feasible course and testing plan, with dependencies, costs and alternatives. It never enrolls, registers or pays, and never promises a score gain.

**Actions**

- `plan`: targets with their purposes, the tests the student selected, school terms and completed milestones.
- `replan`: follows a named cause, such as a cancelled test administration or course, a changed policy or time budget, a score received, an accommodation decision or a changed goal. It reports what changed and what was kept.
- `request_registration`: proposes a registration for explicit approval.

**Modules**

- `courses.ts`: the course plan from the eligibility findings.
- `testing.ts`: the testing-policy matrix; which tests are needed, for which purpose, and which are not; attempt selection against the timing of score receipt; and preparation.
- `calendars.ts`: the verified test-calendar registry and its tool.
- `plan.ts`: milestones, workload and contingencies.

**Guarantees**

- An administration whose scores may arrive too late, or whose registration is closed, is never presented as feasible.
- Planning buffers are labelled as buffers. Official dates always carry a source.
- A test is never both "not needed" and planned for the same purpose.
- Seat availability is always `unknown`.
- `externalRegistrationsMade` is always false.

**Model use:** none. Dates, costs and feasibility are computed by code.

---

## 08 · Activities and experience assessor

`src/agents/a08-activities/` · contract `experience_record_v1` · tests `test/agents/a08-activities.test.ts`

Records what the student actually did, including paid work, caregiving and informal responsibilities. It describes the supported qualities with evidence.

**Actions**

| Action | What it does |
|---|---|
| `record` | Record a structured experience |
| `record_text` | Record an experience from the student's own words |
| `clarify_measure` | Add a measure to a recorded outcome |
| `review` | Check the recorded experiences for consistency and gaps |
| `describe` | A faithful summary. A request for an inflated title or an "admission value" is declined and explained |
| `next_step` | A next step that fits the student's stated capacity |
| `essay_handoff` | Hand approved facts, facts still to confirm, and reflection questions to the future essay role |

**Guarantees**

- Every described quality cites evidence.
- There is no admissions-impact score (`admissionsImpactScore` is always null).
- Prestige and guarantee language fails the contract.
- A planned episode is never described as completed.
- Team results stay separate from the student's own contribution.
- A fact cannot be both approved and awaiting confirmation.

**Model use:** structuring a free-text description (`activities.structure_experience`). Each structured statement must quote the student's words.

---

## 09 · Opportunity research scout

`src/agents/a09-opportunities/` · contract `opportunity_dossier_v1` · tests `test/agents/a09-opportunities.test.ts`

Finds opportunities the student can realistically access and explains why each might help. A good result can be three well-supported options, a local alternative, or an honest finding that nothing verified fits. It never applies, contacts an organizer, pays or enrolls.

**Actions**

- `shortlist`: search, match, rank and pick the finalists.
- `dossier`: one opportunity in detail, including "is it worth it?".
- `save`: save an opportunity, with notification of material changes.
- `refresh_saved`: what changed for a saved opportunity, in terms of the student's plan.
- `prepare_contact`: propose a message to the organizer's published contact.

**Modules**

- `brief.ts`: reads the request. Hard constraints are kept apart from preferences, and a budget the student has not confirmed is not used. Prestige framing is met with a question first.
- `catalog.ts`: curated entries, kept apart from discovered leads, with version history and material-change detection.
- `research.ts` and `tools.ts`: the controlled-vocabulary search, the SSRF-guarded fetch and lead recording.
- `extract.ts`: reads a listing page into a lead, with verbatim quotes.
- `match.ts`, which covers:
  - cycles and deadlines (time-zone aware);
  - eligibility, reusing Agent 06's engine, plus local requirements;
  - dates, format, travel, local session time, workload;
  - the full cost, including travel and never counting aid as awarded;
  - value, concerns, safety and organizer checks;
  - action readiness.
- `rank.ts`: transparent features with no sponsorship feature, dedup, at most two results per organizer, and an accessible alternative.

**Guarantees**

- An action-ready opportunity has a current cycle, a resolved deadline time zone and a freshly verified page.
- "Free" must agree with the listed costs.
- Guarantee and evasion wording fails the contract.
- A partial search failure or a budget limit is stated in the result.

**Model use:** reading a public listing page (`opportunities.read_listing`). Quotes must be verbatim, and the page is fenced as untrusted data.
