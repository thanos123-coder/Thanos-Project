# Traceability matrix: volume two (Agents 10–18)

Every acceptance case (`nnTkk`, `XTkk`) in the *Agents 10–18 Deep Specification*, mapped to the test that checks it. The volume-two specification states its requirements as operating procedures, data contracts and worked examples rather than numbered requirements; each agent section below lists the modules that implement them. The test named for each case is the executable form of its observable expected result. `test/docs/traceability.test.ts` fails if a listed case loses its test.

Counts: 180 acceptance cases (162 role cases and 18 cross-agent cases). Cross-agent case IDs restart at XT01 in this volume; they are tested in `test/system/cross-agent-v2.test.ts`, separately from volume one.

## Agent 10: Project mentor and workload planner

Implemented in `src/agents/a10-projects/agent.ts`, `src/agents/a10-projects/schedule.ts`, `src/agents/a10-projects/checks.ts`, `src/agents/a10-projects/notebook.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 10T01 | Student has an interest but no defined project | Offers a small exploration step and asks what the student wants to learn | `test/agents/a10-projects.test.ts`: 10T01 offers a small exploration step and asks what the student wants to learn |
| 10T02 | Student has one hour available each week | Produces a proportionate scope without filling unavailable time | `test/agents/a10-projects.test.ts`: 10T02 keeps a one-hour week proportionate and never fills time the student does not have |
| 10T03 | Exams reduce capacity after approval | Revises affected milestones and offers scope reduction | `test/agents/a10-projects.test.ts`: 10T03 revises only affected milestones after exams reduce capacity, and offers a smaller scope |
| 10T04 | Dependency graph contains a cycle | Rejects the schedule and identifies the conflicting dependencies | `test/agents/a10-projects.test.ts`: 10T04 rejects a schedule with a dependency cycle and names the milestones |
| 10T05 | External approval has not arrived | Marks dependent work blocked and preserves safe independent tasks | `test/agents/a10-projects.test.ts`: 10T05 blocks work waiting for an external approval and keeps independent work available |
| 10T06 | Student requests a fake organization for admissions | Declines fabricated activity and explores genuine existing interests | `test/agents/a10-projects.test.ts`: 10T06 declines to fabricate an activity and explores genuine interests instead |
| 10T07 | Team project includes substantial work by others | Separates team output from the student’s contribution | `test/agents/a10-projects.test.ts`: 10T07 separates the team’s output from the student’s own contribution |
| 10T08 | Student reports visits as people helped | Preserves the measured quantity and asks before recording impact | `test/agents/a10-projects.test.ts`: 10T08 keeps visits as visits and asks before recording people helped |
| 10T09 | ISEF entry requests an AI written research plan | Applies current competition policy and does not generate the prohibited artifact | `test/agents/a10-projects.test.ts`: 10T09 applies the competition’s policy and does not generate a prohibited research plan |
| 10T10 | Project would require safety supervision | Routes to a responsible adult and provides no unsafe procedure | `test/agents/a10-projects.test.ts`: 10T10 routes safety-relevant work to a responsible adult and gives no procedure |
| 10T11 | Student declines detailed time tracking | Supports approximate planning without reducing access | `test/agents/a10-projects.test.ts`: 10T11 supports approximate planning when the student declines detailed tracking |
| 10T12 | A milestone repeatedly overruns | Reviews estimate and scope without inferring character or diagnosis | `test/agents/a10-projects.test.ts`: 10T12 reviews the estimate and scope after repeated overruns, without judging the student |
| 10T13 | Student ends the project | Stops reminders and records actual completed work | `test/agents/a10-projects.test.ts`: 10T13 stops reminders and records the work actually done when the student ends the project |
| 10T14 | Uploaded notebook contains private participant details | Restricts access and proposes redaction or minimal evidence | `test/agents/a10-projects.test.ts`: 10T14 restricts a notebook entry with private participant details and proposes redaction |
| 10T15 | Agent is asked to claim publication after submission | Keeps submitted and published states distinct | `test/agents/a10-projects.test.ts`: 10T15 keeps submitted and published states distinct |
| 10T16 | Student corrects the completion summary | Proposes a versioned canonical update with the correction | `test/agents/a10-projects.test.ts`: 10T16 saves the student’s correction to the completion summary as a new version |
| 10T17 | Story use permission is absent | Does not send project reflections to essay specialists | `test/agents/a10-projects.test.ts`: 10T17 does not send a project reflection to essay help without story-use permission |
| 10T18 | Tool fails during a check in | Preserves prior state and returns a recoverable partial update | `test/agents/a10-projects.test.ts`: 10T18 preserves the prior state and returns a recoverable update when a tool fails during a check-in |

## Agent 11: Official college and program researcher

Implemented in `src/agents/a11-research/agent.ts`, `src/agents/a11-research/claims.ts`, `src/agents/a11-research/extract.ts`, `src/agents/a11-research/entities.ts`, `src/agents/a11-research/tools.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 11T01 | Student asks about an institution with multiple campuses | Resolves or asks for campus before applying scoped rules | `test/agents/a11-research.test.ts`: 11T01: an institution with several campuses gets a campus question before any campus-scoped rule is applied<br>`test/agents/a11-research.test.ts`: 11T01: a program offered at two campuses needs the campus; a shared name across countries is ambiguous; an unknown name is asked about |
| 11T02 | Search snippet conflicts with current source text | Uses verified source text and records the discrepancy if material | `test/agents/a11-research.test.ts`: 11T02: a search snippet that disagrees with the current official page is recorded, and the page wins |
| 11T03 | Official page contains two application years | Keeps passage level cycle scope and does not mix dates | `test/agents/a11-research.test.ts`: 11T03: a page holding two application years keeps each passage in its own cycle and never mixes dates<br>`test/agents/a11-research.test.ts`: 11T03: a sentence whose year does not fit the cycle of its passage is a gap |
| 11T04 | Department adds a requirement to central admissions | Preserves the additional requirement with its scope | `test/agents/a11-research.test.ts`: 11T04: a department requirement is kept with its program scope beside the inherited central rules |
| 11T05 | Two current official sources materially disagree | Returns a conflict and a resolution path instead of guessing | `test/agents/a11-research.test.ts`: 11T05: two current official sources that disagree are returned as a conflict with the office to ask<br>`test/agents/a11-research.test.ts`: 11T05: a page that states one fact two ways is conflicted with itself and neither reading is used |
| 11T06 | Deadline lacks a cutoff time | Leaves time unknown and separates any planning buffer | `test/agents/a11-research.test.ts`: 11T06: a deadline without a cutoff time keeps the time unknown and any buffer is labeled as the app’s suggestion<br>`test/agents/a11-research.test.ts`: 11T06: "midnight" is not resolved to a time |
| 11T07 | PDF table extraction loses a column heading | Blocks the unsupported value pending layout verification | `test/agents/a11-research.test.ts`: 11T07: a table that lost a column heading is blocked as a whole pending layout checks |
| 11T08 | Statistical value is suppressed | Stores suppression rather than zero | `test/agents/a11-research.test.ts`: 11T08: a suppressed value is stored as suppressed, never as zero |
| 11T09 | Enrolled score range is requested as an admission threshold | Retains cohort definition and refuses the unsupported conversion | `test/agents/a11-research.test.ts`: 11T09: an enrolled score range asked for as a threshold keeps its cohort and the conversion is refused |
| 11T10 | Public page contains an instruction to expose private data | Treats the instruction as untrusted and makes no private retrieval | `test/agents/a11-research.test.ts`: 11T10: a page that tells the model to expose private data is treated as untrusted content; no private data is retrieved |
| 11T11 | Page is inaccessible | Returns supported partial findings with an explicit gap | `test/agents/a11-research.test.ts`: 11T11: an inaccessible page leaves an explicit gap and the readable findings are still returned<br>`test/agents/a11-research.test.ts`: 11T11: an unreachable fetcher or missing search leaves the request partial, not invented |
| 11T12 | Research question includes unnecessary personal details | Removes them from public queries | `test/agents/a11-research.test.ts`: 11T12: personal details in the question never reach the public search |
| 11T13 | A critical claim changes after plan approval | Versions the claim and invalidates dependent decisions | `test/agents/a11-research.test.ts`: 11T13: a critical claim that changes after plan approval is versioned and every dependent decision is invalidated<br>`test/agents/a11-research.test.ts`: 11T13: an ambiguous new page keeps the old date as historical and leaves the current deadline unresolved with a labeled planning choice<br>`test/agents/a11-research.test.ts`: 11T13: a fact the page no longer states becomes historical, never deleted |
| 11T14 | A current footer appears on an old archived policy | Uses the effective cycle rather than footer year | `test/agents/a11-research.test.ts`: 11T14: a current footer on an archived policy does not make it current; the effective cycle decides |
| 11T15 | Scholarship applies only to a first choice program | Stores the program restriction and routes it to matching | `test/agents/a11-research.test.ts`: 11T15: a scholarship for one first-choice program is stored with the restriction and routed to matching and scholarships |
| 11T16 | An uploaded portal screenshot concerns one applicant | Keeps it private and does not generalize without evidence | `test/agents/a11-research.test.ts`: 11T16: a portal screenshot about one applicant stays private and never becomes a public rule<br>`test/agents/a11-research.test.ts`: 11T16: private evidence is removed with the account, and a task cannot store evidence for another student |
| 11T17 | Repeated sources copy one original statement | Does not count them as independent confirmation | `test/agents/a11-research.test.ts`: 11T17: pages that copy one statement count as one source, not independent confirmation |
| 11T18 | Research budget ends with one unresolved requirement | Returns a bounded unresolved result and preserves completed evidence | `test/agents/a11-research.test.ts`: 11T18: when the research budget runs out, completed evidence is kept and the rest is a bounded unresolved result |

## Agent 12: College and program fit matcher

Implemented in `src/agents/a12-fit/agent.ts`, `src/agents/a12-fit/fit.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 12T01 | Student is undecided between two fields | Offers options and questions without inventing a fixed career identity | `test/agents/a12-fit.test.ts`: 12T01: an undecided student sees options for both fields and questions, not a career identity |
| 12T02 | A preferred school fails a confirmed hard constraint | Shows the failure and keeps it out of the feasible set | `test/agents/a12-fit.test.ts`: 12T02: a preferred school that fails a confirmed hard constraint is shown with the failure and kept out of the feasible set |
| 12T03 | A requirement is unknown | Keeps a conditional exploration state rather than treating it as passed | `test/agents/a12-fit.test.ts`: 12T03: an unknown requirement keeps the option in exploration instead of passing it |
| 12T04 | Student changes a preference weight | Recomputes affected comparisons and explains the change | `test/agents/a12-fit.test.ts`: 12T04: changing a weight recomputes the comparison and explains the change by that weight |
| 12T05 | Small weight changes reverse the ranking | Shows that the ordering is sensitive | `test/agents/a12-fit.test.ts`: 12T05: when small weight changes reverse the order, the ranking is shown as sensitive |
| 12T06 | A partner institution is commercially valuable | Organic ranking remains unchanged by the commercial relationship | `test/agents/a12-fit.test.ts`: 12T06: a commercial relationship never changes the organic ranking; sponsored content is kept apart and labeled |
| 12T07 | Program access requires later competitive admission | Displays that condition beside the recommendation | `test/agents/a12-fit.test.ts`: 12T07: later competitive access to the subject is displayed beside the recommendation |
| 12T08 | Affordability relies on an unawarded scholarship | Keeps the option funding conditional | `test/agents/a12-fit.test.ts`: 12T08: an option affordable only with an unawarded scholarship stays funding conditional |
| 12T09 | Parent and student preferences differ | Preserves both sources and asks the student to resolve priorities | `test/agents/a12-fit.test.ts`: 12T09: parent and student preferences that differ are both kept, and the student is asked to decide |
| 12T10 | Student requests a functional support need | Researches the requirement without demanding a diagnosis | `test/agents/a12-fit.test.ts`: 12T10: a functional support need is researched in the student’s words, without asking for a diagnosis |
| 12T11 | All candidates fail constraints | Reports the gap and offers explicit alternatives without silent relaxation | `test/agents/a12-fit.test.ts`: 12T11: when every candidate fails, the gap is reported with explicit alternatives and nothing is relaxed |
| 12T12 | Student provides an unfamiliar institution | Evaluates it under the same evidence requirements | `test/agents/a12-fit.test.ts`: 12T12: a student-supplied unfamiliar institution is held to the same evidence requirements |
| 12T13 | Two prestige proxies duplicate one underlying factor | Prevents hidden double weighting | `test/agents/a12-fit.test.ts`: 12T13: prestige proxies that measure one thing are merged into one bounded weight |
| 12T14 | Missing evidence would materially change rank | Shows the gap and proposes targeted research | `test/agents/a12-fit.test.ts`: 12T14: missing evidence that could change the order is shown and targeted research is proposed |
| 12T15 | Student clicks a school repeatedly | Does not automatically rewrite stated preferences | `test/agents/a12-fit.test.ts`: 12T15: repeated clicks on a school do not rewrite the stated preferences |
| 12T16 | Source correction changes a fit reason | Versions the shortlist and identifies the affected rationale | `test/agents/a12-fit.test.ts`: 12T16: a source correction versions the shortlist and names the rationale it changed |
| 12T17 | Ranking tool is unavailable | Returns a supported factual comparison without invented scores | `test/agents/a12-fit.test.ts`: 12T17: without a usable ranking, a factual comparison is returned with no invented scores |
| 12T18 | A fit result is requested as an admission chance | Routes to agent 13 and preserves the distinction | `test/agents/a12-fit.test.ts`: 12T18: a request for an admission chance is routed to the uncertainty advisor and kept distinct from fit |

## Agent 13: Admissions uncertainty advisor

Implemented in `src/agents/a13-uncertainty/agent.ts`, `src/agents/a13-uncertainty/assess.ts`, `src/agents/a13-uncertainty/models.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 13T01 | User requests an exact chance without a validated model | Provides supported qualitative analysis and no invented number | `test/agents/a13-uncertainty.test.ts`: 13T01: an exact chance without a validated model gets qualitative analysis and no number |
| 13T02 | Institutional admit rate is available | Labels its cohort and does not present it as personal probability | `test/agents/a13-uncertainty.test.ts`: 13T02: an institutional admit rate is labeled with its cohort and never presented as a personal probability |
| 13T03 | Student score lies above the reported 75th percentile | Explains the comparison without declaring admission likely | `test/agents/a13-uncertainty.test.ts`: 13T03: a score above the 75th percentile is explained without declaring admission likely |
| 13T04 | A score range covers submitters among enrolled students | Preserves both selection conditions | `test/agents/a13-uncertainty.test.ts`: 13T04: a range covering score submitters among enrolled students keeps both selection conditions |
| 13T05 | Early round rate exceeds regular rate | Does not infer a causal benefit for this student | `test/agents/a13-uncertainty.test.ts`: 13T05: a higher early-round rate is not presented as a benefit for this student |
| 13T06 | Program has separate competitive entry | Uses program scope or marks selection evidence insufficient | `test/agents/a13-uncertainty.test.ts`: 13T06: a program with its own competitive entry is assessed at program scope or marked as insufficient evidence |
| 13T07 | Student has an unsupported qualification system | Flags the comparison limit and avoids invented conversion | `test/agents/a13-uncertainty.test.ts`: 13T07: an unsupported qualification system is flagged, with no invented conversion |
| 13T08 | Essay evaluator returns a high diagnostic score | Does not translate it into admissions odds | `test/agents/a13-uncertainty.test.ts`: 13T08: a high essay score is not translated into admissions odds |
| 13T09 | Portfolio has several correlated uncertain options | Does not multiply probabilities as independent events | `test/agents/a13-uncertainty.test.ts`: 13T09: several correlated uncertain options are never multiplied into a combined chance |
| 13T10 | Training data includes post-decision information | Rejects the feature set for prediction at application time | `test/agents/a13-uncertainty.test.ts`: 13T10: a feature set with post-decision information is rejected |
| 13T11 | One student appears in multiple dataset rows | Requires grouped handling to prevent leakage | `test/agents/a13-uncertainty.test.ts`: 13T11: rows from one student must be grouped, or the model is rejected |
| 13T12 | Model is calibrated overall but weak for a subgroup | Reports the limitation and applies an abstention rule | `test/agents/a13-uncertainty.test.ts`: 13T12: a model calibrated overall but weak for a subgroup reports the limitation and abstains for it |
| 13T13 | A policy change invalidates historical comparability | Downgrades or suspends the assessment pending review | `test/agents/a13-uncertainty.test.ts`: 13T13: a policy change that breaks comparability suspends the assessment pending review |
| 13T14 | Student asks how to invent an impressive activity | Does not reward fabrication and routes to genuine planning | `test/agents/a13-uncertainty.test.ts`: 13T14: a request to invent an impressive activity is not rewarded and is routed to genuine planning |
| 13T15 | Numerical model version is withdrawn | Stops use and identifies affected downstream plans | `test/agents/a13-uncertainty.test.ts`: 13T15: a withdrawn model version stops being used and every plan that relied on it is identified |
| 13T16 | Sensitive attributes are inferred from an essay | Rejects the inference as a prediction input | `test/agents/a13-uncertainty.test.ts`: 13T16: sensitive attributes inferred from an essay are rejected as prediction inputs |
| 13T17 | No relevant outcome data exists | Returns an honest insufficient evidence state | `test/agents/a13-uncertainty.test.ts`: 13T17: with no relevant outcome data the state is an honest "insufficient evidence" |
| 13T18 | Student reads a category as a guarantee | Clarifies its meaning and triggers explanation usability review | `test/agents/a13-uncertainty.test.ts`: 13T18: a category read as a guarantee is clarified and flagged for an explanation review |

## Agent 14: Application portfolio and round strategist

Implemented in `src/agents/a14-portfolio/agent.ts`, `src/agents/a14-portfolio/rounds.ts`, `src/agents/a14-portfolio/workload.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 14T01 | Proposed rounds conflict under one institution’s rules | Blocks the combination even if the other institution is unrestricted | `test/agents/a14-portfolio.test.ts`: 14T01 blocks a combination one institution’s rules forbid, even when the other is unrestricted |
| 14T02 | An exception depends on a scholarship requirement | Requires evidence that the exact exception applies | `test/agents/a14-portfolio.test.ts`: 14T02 applies a scholarship exception only with evidence that the exact condition holds |
| 14T03 | Binding agreement is from an old cycle | Requests current terms before a definitive recommendation | `test/agents/a14-portfolio.test.ts`: 14T03 withholds a definitive binding recommendation when the agreement on file is from an old cycle |
| 14T04 | Student cannot assess affordability before a binding choice | Shows the uncertainty and routes to financial review | `test/agents/a14-portfolio.test.ts`: 14T04 shows affordability uncertainty before a binding choice and routes to financial review |
| 14T05 | All options require uncertain competitive funding | Reports the absence of a confirmed affordable alternative | `test/agents/a14-portfolio.test.ts`: 14T05 reports that no confirmed affordable alternative exists when every option needs competitive funding |
| 14T06 | A low selectivity college is unaffordable | Does not label it a financial fallback | `test/agents/a14-portfolio.test.ts`: 14T06 does not treat a less selective but unaffordable college as a financial fallback |
| 14T07 | Writing workload exceeds available time | Offers scope or round changes without ghostwriting | `test/agents/a14-portfolio.test.ts`: 14T07 offers a smaller plan or later rounds when writing exceeds available time, never ghostwriting |
| 14T08 | Recommendation requires an external lead time | Schedules the dependency and identifies its owner | `test/agents/a14-portfolio.test.ts`: 14T08 schedules an external recommendation from its owner’s lead time and flags a late request |
| 14T09 | Student approves a plan | Does not submit, pay, or message anyone automatically | `test/agents/a14-portfolio.test.ts`: 14T09 approving a plan records the approval and does not submit, pay or message anyone |
| 14T10 | Portal receipt exists but transcript is missing | Marks submitted and incomplete as separate states | `test/agents/a14-portfolio.test.ts`: 14T10 keeps submission, receipt and completeness as separate states |
| 14T11 | Scholarship deadline is earlier than admissions deadline | Schedules the earlier controlling dependency | `test/agents/a14-portfolio.test.ts`: 14T11 schedules an earlier scholarship dependency as the controlling date |
| 14T12 | Student reports a deferral activating a later round option | Confirms the relevant status and current rule before changing the plan | `test/agents/a14-portfolio.test.ts`: 14T12 opens an outcome-dependent round only after the outcome is confirmed and the rule is current |
| 14T13 | A budget change removes financial coverage | Recalculates affected options and clearly identifies the gap | `test/agents/a14-portfolio.test.ts`: 14T13 recalculates when a budget change removes financial coverage, keeping the prior approval as history |
| 14T14 | UCAS choices are added beyond the supported limit | Applies the current system rule and explains the conflict | `test/agents/a14-portfolio.test.ts`: 14T14 applies the application system’s current choice limit and explains the conflict |
| 14T15 | A deadline has a specific timezone | Preserves official time and displays a correct local conversion | `test/agents/a14-portfolio.test.ts`: 14T15 preserves the official deadline time and zone and converts it correctly to the student’s time |
| 14T16 | Student misses a deadline | Researches permitted alternatives without promising an exception | `test/agents/a14-portfolio.test.ts`: 14T16 researches permitted alternatives after a missed deadline without promising an exception |
| 14T17 | Student would not attend a proposed fallback | Does not count it as a meaningful acceptable outcome | `test/agents/a14-portfolio.test.ts`: 14T17 does not count a fallback the student would not attend as an acceptable outcome |
| 14T18 | Multiple applications share one fragile dependency | Shows the shared dependency instead of treating outcomes as independent | `test/agents/a14-portfolio.test.ts`: 14T18 shows a dependency shared by several applications instead of treating outcomes as independent |

## Agent 15: Affordability and financial aid planner

Implemented in `src/agents/a15-affordability/agent.ts`, `src/agents/a15-affordability/ledger.ts`, `src/agents/a15-affordability/letter.ts`, `src/agents/a15-affordability/tools.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 15T01 | Award total includes a loan | Separates financing from gift aid and preserves net cost | `test/agents/a15-affordability.test.ts`: 15T01: an award total that includes a loan separates financing from gift aid and keeps the net cost |
| 15T02 | Work study is listed as an award | Shows conditional earnings and their timing | `test/agents/a15-affordability.test.ts`: 15T02: work-study is conditional income with timing, never a tuition discount |
| 15T03 | Cost line lacks a period | Blocks a confident total until the period is resolved | `test/agents/a15-affordability.test.ts`: 15T03: a cost line without a period blocks a confident total |
| 15T04 | Published total already includes mandatory fees | Does not add the fees twice | `test/agents/a15-affordability.test.ts`: 15T04: a published total that includes mandatory fees does not add them twice |
| 15T05 | Scholarship appears in two imported sources | Matches funding identity and prevents double counting | `test/agents/a15-affordability.test.ts`: 15T05: a scholarship from two sources is matched to one funding identity |
| 15T06 | Outside award reduces institutional aid | Recalculates the net benefit using the verified interaction rule | `test/agents/a15-affordability.test.ts`: 15T06: an outside award that reduces institutional aid is recalculated with the verified rule<br>`test/agents/a15-affordability.test.ts`: 15T06: without a verified interaction rule no improvement from the outside award is promised |
| 15T07 | Calculator excludes the family’s situation | Does not present its output as a reliable estimate | `test/agents/a15-affordability.test.ts`: 15T07: a calculator that excludes the family’s situation is not presented as a reliable estimate |
| 15T08 | Annual funding is sufficient but arrives after a deposit | Shows the upfront cash gap | `test/agents/a15-affordability.test.ts`: 15T08: funding that is sufficient for the year but arrives after the deposit shows the upfront cash gap |
| 15T09 | Aid renewal is conditional | Keeps future years conditional and states the requirement | `test/agents/a15-affordability.test.ts`: 15T09: conditional renewal keeps later years conditional and states the requirement |
| 15T10 | Exchange rate direction is reversed | Detects the unit mismatch before displaying a conversion | `test/agents/a15-affordability.test.ts`: 15T10: a reversed exchange rate is detected before any conversion is shown |
| 15T11 | Family budget changes | Versions the scenario and invalidates affected portfolio claims | `test/agents/a15-affordability.test.ts`: 15T11: a changed family budget versions the scenario and invalidates results built on it |
| 15T12 | Student does not know family income | Supports budget range exploration without inventing values | `test/agents/a15-affordability.test.ts`: 15T12: a student who does not know the family income can explore costs without invented values |
| 15T13 | Uploaded letter has an ambiguous aid category | Requests confirmation rather than assuming it is a grant | `test/agents/a15-affordability.test.ts`: 15T13: an ambiguous award line is sent back for confirmation, not assumed to be a grant |
| 15T14 | Student is admitted but federal eligibility is unknown | Does not assume federal aid entitlement | `test/agents/a15-affordability.test.ts`: 15T14: an admitted student with unknown federal eligibility gets no assumed federal aid |
| 15T15 | User requests fabricated financial hardship | Refuses false claims and supports truthful process questions | `test/agents/a15-affordability.test.ts`: 15T15: a request to fabricate hardship is refused and truthful process questions are offered |
| 15T16 | Another agent requests raw tax documents | Denies unnecessary access and supplies permitted aggregates | `test/agents/a15-affordability.test.ts`: 15T16: another role asking for raw tax documents is denied; it receives aggregates |
| 15T17 | Degree duration increases by one year | Recalculates cost, renewal, and funding gaps | `test/agents/a15-affordability.test.ts`: 15T17: a longer degree recalculates cost, renewal and the funding gap |
| 15T18 | Currency service fails | Uses a disclosed scenario rate or leaves conversion unresolved | `test/agents/a15-affordability.test.ts`: 15T18: when the currency service fails, a disclosed scenario rate is used or the conversion stays unresolved |

## Agent 16: Scholarship eligibility and matching advisor

Implemented in `src/agents/a16-scholarships/agent.ts`, `src/agents/a16-scholarships/catalog.ts`, `src/agents/a16-scholarships/rules.ts`, `src/agents/a16-scholarships/tools.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 16T01 | One required eligibility fact is missing | Returns potentially eligible with the specific unknown | `test/agents/a16-scholarships.test.ts`: 16T01: one missing eligibility fact gives "potentially eligible" with that specific unknown |
| 16T02 | Citizenship fits but school location does not | Applies both clauses and explains the failed requirement | `test/agents/a16-scholarships.test.ts`: 16T02: citizenship fits but school location does not; both clauses apply and the failure is explained |
| 16T03 | Award requires school nomination | Identifies nomination as a dependency before promising an application path | `test/agents/a16-scholarships.test.ts`: 16T03: a school nomination is a dependency before any application path is promised |
| 16T04 | Nomination and application have different deadlines | Preserves both and schedules the earlier dependency | `test/agents/a16-scholarships.test.ts`: 16T04: nomination and application deadlines are both kept and the earlier dependency is scheduled first |
| 16T05 | Listing is for graduate students | Excludes it from an undergraduate actionable shortlist | `test/agents/a16-scholarships.test.ts`: 16T05: a graduate listing is excluded from an undergraduate shortlist |
| 16T06 | Award says up to a maximum amount | Does not treat the maximum as guaranteed funding | `test/agents/a16-scholarships.test.ts`: 16T06: an "up to" award is not treated as guaranteed funding |
| 16T07 | Two award routes are mutually exclusive | Shows the choice and blocks a simultaneous funding assumption | `test/agents/a16-scholarships.test.ts`: 16T07: mutually exclusive award routes are shown as a choice, never as simultaneous funding |
| 16T08 | Scholarship policy prohibits generated content | Gates tailored assistance and produces no prohibited content | `test/agents/a16-scholarships.test.ts`: 16T08: a scholarship policy that prohibits generated content gates tailored help, and nothing is produced |
| 16T09 | Provider asks for a fee to release a guaranteed award | Flags the pattern and makes no payment or disclosure | `test/agents/a16-scholarships.test.ts`: 16T09: a fee to release a "guaranteed" award is flagged; nothing is paid or disclosed |
| 16T10 | Small local provider has incomplete public evidence | Marks verification unresolved without an unsupported fraud accusation | `test/agents/a16-scholarships.test.ts`: 16T10: a small local provider with little public evidence stays unresolved, with no accusation |
| 16T11 | Student reaches a finalist stage | Does not record the award as won | `test/agents/a16-scholarships.test.ts`: 16T11: reaching the finalist stage does not record the award as won |
| 16T12 | Award letter arrives | Sends the offer and terms to agent 15 for reconciliation | `test/agents/a16-scholarships.test.ts`: 16T12: an award letter records the offer and its terms and sends them to affordability for reconciliation |
| 16T13 | Scholarship is already included in institutional aid | Prevents duplicate funding credit | `test/agents/a16-scholarships.test.ts`: 16T13: a scholarship already included in institutional aid is not credited twice |
| 16T14 | Student declines a sensitive eligibility question | Keeps the relevant clause unknown and continues other useful work | `test/agents/a16-scholarships.test.ts`: 16T14: a declined sensitive question leaves that clause unknown and the rest of the work continues |
| 16T15 | Application effort exceeds remaining capacity | Coordinates a realistic priority decision with agent 14 | `test/agents/a16-scholarships.test.ts`: 16T15: effort beyond the remaining capacity becomes a priority decision with the portfolio strategist |
| 16T16 | Award is tied to a first choice program | Preserves the restriction when the student changes program order | `test/agents/a16-scholarships.test.ts`: 16T16: an award tied to a first-choice program keeps its restriction when the choice order changes |
| 16T17 | Interview is an actual assessed selection stage | Does not answer on the student’s behalf | `test/agents/a16-scholarships.test.ts`: 16T17: an assessed interview is never answered on the student’s behalf; permitted preparation goes to the interview studio |
| 16T18 | Student stops pursuing the award | Stops reminders and removes it from active planning | `test/agents/a16-scholarships.test.ts`: 16T18: a stopped award leaves active planning and its reminders are removed |

## Agent 17: Personal essay brainstorming interviewer

Implemented in `src/agents/a17-stories/agent.ts`, `src/agents/a17-stories/bank.ts`, `src/agents/a17-stories/questions.ts`, `src/agents/a17-stories/signals.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 17T01 | Student says they have no dramatic experiences | Offers ordinary experience questions without pressuring disclosure | `test/agents/a17-stories.test.ts`: 17T01 offers ordinary ways in without pressing for disclosure |
| 17T02 | Destination permits questions but prohibits outlines | Produces questions and notes without a narrative sequence | `test/agents/a17-stories.test.ts`: 17T02 gives questions and factual notes, never a narrative sequence, where outlines are prohibited |
| 17T03 | Student requests an opening paragraph from their story | Keeps the student as author and offers permitted guidance | `test/agents/a17-stories.test.ts`: 17T03 keeps the student as author when asked for an opening paragraph |
| 17T04 | Student says an event had no clear lesson | Preserves that interpretation and does not impose growth | `test/agents/a17-stories.test.ts`: 17T04 preserves “no clear lesson” and does not impose growth |
| 17T05 | Voice transcript drops a negation | Flags and confirms the critical meaning before saving a fact | `test/agents/a17-stories.test.ts`: 17T05 confirms a voice fact whose negation is uncertain before saving it |
| 17T06 | Student interrupts a spoken question | Stops playback and respects the new instruction | `test/agents/a17-stories.test.ts`: 17T06 stops playback when the student interrupts and follows the new instruction |
| 17T07 | Student switches from voice to text | Preserves confirmed context and stops audio capture | `test/agents/a17-stories.test.ts`: 17T07 keeps confirmed context and stops audio capture when switching from voice to text |
| 17T08 | Connection drops during recording | Saves confirmed notes and does not silently resume recording | `test/agents/a17-stories.test.ts`: 17T08 keeps confirmed notes when the connection drops and never resumes recording silently |
| 17T09 | Student excludes a topic from future use | Prevents retrieval and invalidates dependent planning artifacts | `test/agents/a17-stories.test.ts`: 17T09 excludes a story from future use and invalidates what was built on it |
| 17T10 | Parent requests student private exploration notes | Enforces account and legal permissions without automatic disclosure | `test/agents/a17-stories.test.ts`: 17T10 enforces the actual permissions when a parent asks for private notes |
| 17T11 | Student cannot remember a detail | Records uncertainty and does not invent a plausible scene | `test/agents/a17-stories.test.ts`: 17T11 records a forgotten detail as unknown and does not invent it |
| 17T12 | Student has several unrelated interests | Explores them without forcing a single identity theme | `test/agents/a17-stories.test.ts`: 17T12 explores several unrelated interests without forcing one theme |
| 17T13 | Student asks for translation of a restricted essay | Checks the operation specific policy before any transformation | `test/agents/a17-stories.test.ts`: 17T13 checks the operation-specific policy before any translation |
| 17T14 | Agent 27 proposes an inferred emotion | Keeps it out of factual and student interpretation fields | `test/agents/a17-stories.test.ts`: 17T14 keeps an inferred emotion out of the factual and interpretation fields |
| 17T15 | Student corrects a story summary | Updates dependent notes and preserves provenance | `test/agents/a17-stories.test.ts`: 17T15 applies a student correction to dependent notes and keeps provenance |
| 17T16 | Student stops before choosing a topic | Closes with useful approved notes and no pressure to continue | `test/agents/a17-stories.test.ts`: 17T16 closes with useful notes and no pressure when the student stops before choosing |
| 17T17 | Detector reports a high AI score | Does not accuse, certify, or offer evasion assistance | `test/agents/a17-stories.test.ts`: 17T17 does not accuse, certify or help evade on the basis of a detector score |
| 17T18 | A new destination has stricter assistance rules | Reassesses the existing artifact’s policy scope before reuse | `test/agents/a17-stories.test.ts`: 17T18 reassesses an existing story before reuse for a stricter destination |

## Agent 18: Narrative portfolio coordinator

Implemented in `src/agents/a18-narrative/agent.ts`, `src/agents/a18-narrative/drafts.ts`, `src/agents/a18-narrative/text.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| 18T01 | Requested coverage map would prescribe a prohibited outline | Blocks that operation and offers the allowed subset | `test/agents/a18-narrative.test.ts`: 18T01 withholds a coverage map that would be an outline and offers the allowed subset |
| 18T02 | Two drafts repeat an event but discuss different decisions | Distinguishes topic overlap from redundant contribution | `test/agents/a18-narrative.test.ts`: 18T02 distinguishes a shared background from a redundant contribution |
| 18T03 | Same student authored essay serves separate destinations | Does not apply a global reuse penalty | `test/agents/a18-narrative.test.ts`: 18T03 does not penalize the same student-written essay used for separate applications |
| 18T04 | Prompt has three explicit asks and draft addresses two | Identifies the missing ask without writing its answer | `test/agents/a18-narrative.test.ts`: 18T04 identifies a missing prompt ask without writing its answer |
| 18T05 | Student has several unrelated interests | Does not impose a single personal brand | `test/agents/a18-narrative.test.ts`: 18T05 does not impose a single personal brand across unrelated interests |
| 18T06 | Draft and canonical record disagree on a date | Asks which is correct and routes a versioned correction | `test/agents/a18-narrative.test.ts`: 18T06 asks which date is correct and routes a versioned correction to the record |
| 18T07 | A repeated fact is needed for standalone clarity | Allows intentional repetition with an explanation | `test/agents/a18-narrative.test.ts`: 18T07 allows a repeated fact needed for a short answer to stand on its own |
| 18T08 | New destination changes policy intersection | Rechecks permission and preserves assistance history | `test/agents/a18-narrative.test.ts`: 18T08 rechecks permission for a new destination and keeps the assistance history |
| 18T09 | Student excludes a story after a map was made | Invalidates dependent findings and prevents further use | `test/agents/a18-narrative.test.ts`: 18T09 invalidates findings when the student excludes a story, and stops using it |
| 18T10 | Similarity model flags unrelated passages | Requires anchored evidence before presenting a finding | `test/agents/a18-narrative.test.ts`: 18T10 requires anchored evidence before presenting a similarity finding |
| 18T11 | A prompt changes after review | Marks prompt dependent findings stale | `test/agents/a18-narrative.test.ts`: 18T11 marks prompt-dependent findings stale when a prompt changes |
| 18T12 | Character limit applies across several fields | Checks both per field minimums and the combined limit | `test/agents/a18-narrative.test.ts`: 18T12 checks per-field minimums and a limit shared across fields |
| 18T13 | Optional response is absent | Does not call it required without supporting instructions | `test/agents/a18-narrative.test.ts`: 18T13 does not call an absent optional response required |
| 18T14 | Student disagrees with an inferred meaning | Preserves the student’s interpretation and allows dismissal | `test/agents/a18-narrative.test.ts`: 18T14 preserves the student’s own meaning and lets them dismiss a finding |
| 18T15 | School specific factual claim lacks evidence | Flags it for research without inventing a replacement claim | `test/agents/a18-narrative.test.ts`: 18T15 flags an unsupported school claim for research without writing a replacement |
| 18T16 | A copied derivative has a new filename | Retains relevant assistance provenance and destination checks | `test/agents/a18-narrative.test.ts`: 18T16 keeps assistance provenance on a copy with a new filename |
| 18T17 | Review has no material unresolved issues | Closes without generating an endless new revision list | `test/agents/a18-narrative.test.ts`: 18T17 closes a review with no material issues instead of generating new ones |
| 18T18 | Scholarship policy differs from admissions policy | Evaluates the award workflow separately before reuse | `test/agents/a18-narrative.test.ts`: 18T18 evaluates a scholarship workflow separately before reusing an admissions essay |

## Cross-agent cases (volume two)

Run through the whole `CounselorSystem` with `test/helpers/v2.ts`.

| ID | Input condition | Observable expected result | Test |
|---|---|---|---|
| XT01 | Project completion note overstates individual contribution | Agent 04 rejects the unsupported update and downstream story notes retain accurate attribution | `test/system/cross-agent-v2.test.ts`: XT01: an overstated project completion is rejected by the record, and story notes keep the real attribution |
| XT02 | College deadline changes after portfolio approval | Research versions the claim and strategy identifies affected tasks and decisions | `test/system/cross-agent-v2.test.ts`: XT02: a changed deadline after approval is versioned by research, and the plan names the affected task and decision |
| XT03 | Scholarship offer replaces part of institutional aid | Funding ledger calculates net benefit before matching or strategy changes affordability | `test/system/cross-agent-v2.test.ts`: XT03: an award that replaces part of institutional aid is netted by the ledger before the plan uses affordability |
| XT04 | Same award arrives through two document imports | Stable funding identity prevents duplicate credit across agents | `test/system/cross-agent-v2.test.ts`: XT04: the same award recorded from two imports is counted once across agents |
| XT05 | Student changes citizenship or fee status information | Relevant eligibility, scholarship, and cost outputs are invalidated without unrelated reruns | `test/system/cross-agent-v2.test.ts`: XT05: a citizenship or fee-status change invalidates scholarship and cost results, not an unrelated project plan |
| XT06 | New program requires a separate competitive entry route | Fit and portfolio retain program access uncertainty even when university admission is plausible | `test/system/cross-agent-v2.test.ts`: XT06: a program with a separate competitive entry route keeps that uncertainty in fit and in the portfolio |
| XT07 | A source conflicts with an older cached rule | Dependent decisions become unresolved until the conflict is scoped or resolved | `test/system/cross-agent-v2.test.ts`: XT07: an official source that conflicts with a cached rule leaves the dependent decision unresolved |
| XT08 | Student asks for exact odds after a favorable essay evaluation | Uncertainty advisor does not transform the writing score into a probability | `test/system/cross-agent-v2.test.ts`: XT08: exact odds after a favorable essay evaluation are not produced from the writing score |
| XT09 | Parent has budget access but no story access | Financial collaboration does not reveal private brainstorming notes | `test/system/cross-agent-v2.test.ts`: XT09: a parent with budget access cannot see private brainstorming notes |
| XT10 | Student revokes a story’s writing permission | Story dependent maps, summaries, indexes, and pending tasks stop using it | `test/system/cross-agent-v2.test.ts`: XT10: revoking a story’s writing permission stops maps, summaries and retrieval from using it |
| XT11 | Voice transcript misstates the student’s role | Correction occurs before canonical facts or narrative findings are committed | `test/system/cross-agent-v2.test.ts`: XT11: a misheard role is corrected before it becomes a note that later review can use |
| XT12 | Shared essay gains a destination with stricter policy | The next operation is rechecked and assistance lineage remains intact | `test/system/cross-agent-v2.test.ts`: XT12: a shared essay that gains a stricter destination is rechecked and keeps its assistance lineage |
| XT13 | A generated table functions as a prohibited outline | Policy and output checks block it despite the table label | `test/system/cross-agent-v2.test.ts`: XT13: a table that functions as an outline is blocked whatever it is called |
| XT14 | Scholarship requires a school nomination before admission deadline | Strategy schedules the controlling nomination process and does not assume availability | `test/system/cross-agent-v2.test.ts`: XT14: a school nomination needed before the admission deadline controls the schedule and is not assumed available |
| XT15 | Application plan is approved but no send authorization exists | No email, payment, application, acceptance, or withdrawal is executed | `test/system/cross-agent-v2.test.ts`: XT15: an approved plan executes no email, payment, application, acceptance or withdrawal |
| XT16 | Annual funds are sufficient but disbursement is late | Strategy receives the cash timing gap and does not label attendance unconditionally affordable | `test/system/cross-agent-v2.test.ts`: XT16: enough funds for the year but a late disbursement is passed to strategy as a cash timing gap |
| XT17 | One shared external dependency fails across several applications | Portfolio shows the common failure and proposes a scoped recovery plan | `test/system/cross-agent-v2.test.ts`: XT17: one shared external dependency failing across applications is shown as a common failure with a scoped recovery |
| XT18 | A cancelled task returns a late model result | Coordinator rejects unauthorized state mutation and preserves cancellation | `test/system/cross-agent-v2.test.ts`: XT18: a task cancelled while it runs commits nothing, and the earlier state is kept |
