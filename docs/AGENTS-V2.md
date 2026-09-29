# The second nine agents (10–18)

A reference for each role in the *Agents 10–18 Deep Specification*: what it does, how it is called, what its result guarantees, which tools it holds and whether it uses a model. The case-by-case mapping is in [TRACEABILITY-V2.md](TRACEABILITY-V2.md). The shared machinery, including the stores these roles add, is in [ARCHITECTURE.md](ARCHITECTURE.md). Agents 01–09 are described in [AGENTS.md](AGENTS.md).

These agents follow the same contract as the first nine:

- They implement `SpecialistAgent`.
- They read the record only through their scoped view and propose facts only through Agent 04.
- They cite only what was served to them.
- They never send, pay, submit, accept or withdraw anything.

Agent 01 starts them through `specialist.invoke`, as described in the routing section at the end. Each can also be run directly through the kernel.

Five judgments stay separate across these roles and are never merged into one score:

- **eligibility** (Agent 06);
- **fit** (12);
- **admissions uncertainty** (13);
- **affordability** (15);
- **feasibility** (10 and 14).

Only Agent 11 uses a model. Every number, date, rule, schedule and policy decision is computed in code.

---

## 10 · Project mentor and workload planner

`src/agents/a10-projects/` · contract `project_plan_v1` · tests `test/agents/a10-projects.test.ts`

Helps a student carry out a genuine project at a sustainable pace, and keeps an honest record of what happened.

| Action | What it does |
|---|---|
| `explore` | A small, one- or two-session way to test an interest, plus what the student wants to learn. It declines to invent an activity |
| `plan` | Checks the dependency graph and the context's assistance policy, flags safety areas, and schedules against the student's weekly hours minus their reserve. It offers a smaller version or a longer timeline when the plan does not fit. Only a plan that fits can be approved |
| `check_in` | Records statuses, with optional approximate hours, and re-plans only the affected milestones. Past weeks hold no new work. Repeated overruns open a review of the estimate or the scope. If the notebook is unreachable, the plan is unchanged and the update is returned for a retry |
| `assist` | The operation-level policy gate. For example, a generated research plan for a competition is refused, with its source cited |
| `add_evidence` | The evidence notebook. Entries with other people's private details are restricted, with a redaction and a minimal-evidence suggestion |
| `close` | What exists, what is unfinished, who did what, and measured quantities. It needs the student's confirmation before the record is updated, and stops reminders |
| `correct_completion` | The student's correction, saved as a new record version |

**Guarantees**

- Nothing is placed in time the student does not have, and no estimate is shortened.
- Work waiting on an approval or a responsible adult is blocked, together with everything that depends on it.
- A submission is never recorded as a publication, and an unapproved public release stays a private demo.
- Visits are never relabelled as people helped. Team, tool and mentor work stay separate from the student's own.
- The app's own text never infers character, motivation or health, and never uses admissions framing.

**Tools:** `projects.notebook` and `policy.check_operation`, plus the record and artifact tools.

---

## 11 · Official college and program researcher

`src/agents/a11-research/` · contract `evidence_packet_v1` · tests `test/agents/a11-research.test.ts`

Finds and stores scoped, anchored claims from official sources in the shared institution claim store.

| Action | What it does |
|---|---|
| `research` | Resolves the entity (institution, campus, program), reuses fresh evidence, fetches official pages, extracts typed claims and links conflicts |
| `statistics` | Cohort statistics with their definitions and denominators; never personal odds |
| `prompt_manifest` | Current writing prompts with their asks and limits |
| `refresh` | Re-checks claims before a consequential use |
| `student_evidence` | Private evidence the student supplied, kept separate from public claims |

**Guarantees**

- A claim's quote must occur in the retrieved passage.
- A claim with missing parts, such as a date without a time or zone, is provisional.
- Model-located claims are provisional until reviewed.
- Conflicting official statements stay a conflict, not a guess.
- Binding or imminent decisions need evidence from the last 72 hours.

**Model use:** `research.locate_claims` finds passages for predicates the rules did not cover. Its output must quote the page verbatim.

---

## 12 · College and program fit matcher

`src/agents/a12-fit/` · contract `fit_shortlist_v1` · tests `test/agents/a12-fit.test.ts`

Builds an explainable shortlist from the student's own priorities.

**Actions:** `match`, `decide` and `set_priority`.

**Guarantees**

- Hard constraints use three-valued logic.
- Prestige proxies are capped.
- An option outside the researched catalog has every dimension unknown.
- Each card cites versioned claims.
- Program access is shown separately from admission.
- When an option's best case could overtake the one above it, the next research step is proposed.

---

## 13 · Admissions uncertainty advisor

`src/agents/a13-uncertainty/` · contract `admissions_uncertainty_v1` · tests `test/agents/a13-uncertainty.test.ts`

Interprets how selective an option is, without inventing personal odds.

**Actions:** `assess`, `clarify` and `improve`.

**Guarantees**

- Selection states come with definitions. A low admit rate is never called "plausible", and only a verified open or guaranteed route is called safe.
- Other roles' results, such as an essay score, are never selection evidence.
- A numerical model may be used only when all three hold:
  - it is registered and approved;
  - it is calibrated for the student's subgroup;
  - it is not withdrawn.
- Otherwise the assessment is qualitative.

---

## 14 · Application portfolio and round strategist

`src/agents/a14-portfolio/` · contract `portfolio_plan_v1` · tests `test/agents/a14-portfolio.test.ts`

Turns destinations into a versioned plan the student can afford, complete and defend.

| Action | What it does |
|---|---|
| `plan` | Round rules checked in code across every ordered pair, with exceptions only on evidence. Also checks platform choice limits, binding readiness, coverage gaps, a schedule worked back from official deadlines, fees against the budget, and alternative plans |
| `approve` | Records the student's approval. Nothing is submitted, paid or sent, and a later plan keeps the approval as history |
| `record_status` | Keeps submission, receipt and completeness as separate states, with evidence for each |
| `report_outcome` | An outcome-dependent round opens only after a confirmed outcome and a current rule |
| `missed_deadline` | Researches later routes, never promising an exception |

**Guarantees**

- Coverage never multiplies probabilities into a combined chance.
- A binding round is never called a free option.
- A fallback the student would not attend is not counted.
- An unaffordable fallback is not a financial fallback. Neither is a cash-timing gap: enough over the year but short when bills are due.
- A conflicted deadline is not an official date.
- Changed deadlines, affordability or assessments are listed as changes, with the tasks affected.

**Tools:** `scholarships.read` for nominations and scholarship dates that control the schedule, and `actions.propose`, which is never used to send anything.

---

## 15 · Affordability and financial aid planner

`src/agents/a15-affordability/` · contract `affordability_ledger_v1` · tests `test/agents/a15-affordability.test.ts`

Comparable cost scenarios and funding reconciliation, in exact decimal arithmetic.

**Actions:** `compare`, `review_award_letter`, `explore_budget`, `appeal_help` and `share_summary`.

**Guarantees**

- Gift aid, loans and work are separate, and an unclassified award is not counted as a grant.
- An outside award is netted using the institution's verified interaction rule.
- The same award from two sources is counted once.
- Upfront cash timing is shown. The stored result carries any shortfall, so a plan does not read it as affordable.
- A reversed exchange rate is caught.
- Estimates stay conditional.

**Tools:** `finance.exchange_rate` and quarantined document parsing for award letters.

---

## 16 · Scholarship eligibility and matching advisor

`src/agents/a16-scholarships/` · contract `scholarship_matches_v1` · tests `test/agents/a16-scholarships.test.ts`

Verified opportunities with eligibility reasons, dependencies and next steps, from the maintained scholarship catalog.

**Actions:** `shortlist`, `check`, `submit_lead`, `track` and `assist`.

**Guarantees**

- The eligibility engine reports only the clauses that decide the result.
- Sensitive facts are asked about, not assumed.
- A nomination is an explicit open condition.
- Trust status is separate from eligibility. A small provider that cannot be verified is "unresolved", never accused.
- Nothing is funding until an award is recorded.

---

## 17 · Personal essay brainstorming interviewer

`src/agents/a17-stories/` · contract `story_session_v1` · tests `test/agents/a17-stories.test.ts`

Helps the student find what they might write about, one question at a time, in text or voice. It keeps an editable story bank and never writes anything for submission.

| Action | What it does |
|---|---|
| `start` | Checks policy before the session. Tailored help is given only where every destination allows it; otherwise exploration is general and marked as not cleared. States what is saved and who can see it, and records topics to avoid |
| `answer` | Reads the student's turn. A request to write, translate or fabricate is declined with a permitted alternative. Discomfort gets a pause or another topic. Several interests become separate threads. Notes are candidates with source spans. A voice fact whose meaning a negation would flip is held for confirmation. Inferred emotions or traits are never stored |
| `control` | Interrupt, pause, resume, switch mode, stop, disconnect and reconnect. Audio capture is never turned back on without the student |
| `confirm` | Confirms, rejects or corrects notes. A misheard name is corrected everywhere, with history kept |
| `set_use` | Private, discuss only, possible writing material, or do not use. "Do not use" removes the story from every retrieval and makes what cited it stale |
| `close` | Factual options (no outline), the student's selection, and the next step. No topic is required. Notes are shared for drafting only with approval |
| `review` | The student's own stories, under the story-bank permission |
| `detector_report` | A detector score is never an accusation, a certification or a reason to help evade |
| `reassess` | A stricter new destination re-checks the story's assistance history before reuse |

**Tools:** `story.bank`, `conversation.read_turn` and `policy.check_operation`.

---

## 18 · Narrative portfolio coordinator

`src/agents/a18-narrative/` · contract `narrative_review_v1` · tests `test/agents/a18-narrative.test.ts`

Looks across a student's responses only in the ways each destination allows.

| Action | What it does |
|---|---|
| `register_draft` | A versioned draft with destinations, prompt field, declared provenance and assistance history. A copy carries its source's history, declared or detected from shared passages |
| `review` | Policy per operation and destination set. Then prompt manifest, lengths (including shared limits), required and optional fields, possibly unanswered asks, anchored repetition within one application, other institutions named, school claims needing a source, and facts that disagree with the record. A coverage map that would be an outline is withheld and the allowed subset offered. It closes when nothing material is left |
| `dispose` | Keep, revise, investigate, dismiss or defer. A dismissed finding is not raised again, and the student's meaning is kept |
| `resolve_fact` | The record is corrected as a new version, or the student revises the draft; the draft is never rewritten |
| `add_destination` | Re-checks the assistance history for the new destination set, or for a scholarship's own rules, and pauses further help when it is not cleared |

**Guarantees**

- No persona, brand or single theme is imposed, and there is no narrative score.
- A similarity signal without matching text is not shown.
- Reuse of the same essay across separate applications is not penalized.

**Tools:** `drafts.registry`, `story.read_permitted`, `institutions.read` and `policy.check_operation`.

---

## Routing from Agent 01

Nine outcomes route plain requests to these roles. The interface can also pass structured inputs in `context`:

- `cycle`;
- `options`, each with an optional `round`;
- `specialistScopes`, a fully specified scope per role that each agent validates.

The planner uses the record's planned entry cycle when none is given, and asks for the entry year or the colleges rather than guessing. The application plan runs after the fit, uncertainty and affordability results it integrates.

A request to write an essay starts a brainstorming session. Its answer says first that the essay is never written for the student, and it carries the interviewer's session so the student can continue there. Feedback on a finished draft still goes to the later essay-review service.
