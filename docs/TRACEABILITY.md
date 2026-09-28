# Traceability matrix

Every requirement (`nnRkk`) and acceptance case (`nnTkk`, `XTkk`) in the *Agents 01–09 Deep Specification*, mapped to the code that implements it and the test that checks it. The test named for each case is the executable form of the case's "required result". `test/docs/traceability.test.ts` fails if a listed requirement loses its citation in the code or a listed case loses its test.

Counts: 103 requirements, 164 acceptance cases (144 role cases and 20 cross-agent cases).

## Agent 01: Lead counselor and orchestrator

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 01R01 | Establish the task | `src/agents/a01-orchestrator/agent.ts` |
| 01R02 | Check authority and coverage | `src/agents/a01-orchestrator/planner.ts` |
| 01R03 | Read the smallest relevant snapshot | `src/agents/a01-orchestrator/planner.ts` |
| 01R04 | Identify consequential gaps | `src/agents/a01-orchestrator/agent.ts`, `src/agents/a01-orchestrator/planner.ts` |
| 01R05 | Build a bounded task graph | `src/agents/a01-orchestrator/planner.ts`, `src/runtime/task-graph.ts` |
| 01R06 | Execute and monitor | `src/agents/a01-orchestrator/agent.ts`, `src/runtime/task-graph.ts` |
| 01R07 | Validate returned results | `src/agents/a01-orchestrator/agent.ts`, `src/runtime/grounding.ts`, `src/runtime/validation.ts`, `src/shared/envelopes.ts` |
| 01R08 | Reconcile conflicts by evidence | `src/agents/a01-orchestrator/compose.ts` |
| 01R09 | Compose the answer | `src/agents/a01-orchestrator/compose.ts` |
| 01R10 | Commit only appropriate internal state | `src/agents/a01-orchestrator/agent.ts` |
| 01R11 | Close or checkpoint | `src/agents/a01-orchestrator/agent.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 01T01 | Simple request to correct an activity date | Routes a scoped mutation; does not invoke unrelated roles | `test/agents/a01-orchestrator.test.ts`: 01T01: correcting an activity date routes one scoped mutation and nothing else |
| 01T02 | New transcript plus a prerequisite question | Waits for validated extraction before final eligibility finding | `test/agents/a01-orchestrator.test.ts`: 01T02: a new transcript is read and validated before the prerequisite is checked |
| 01T03 | Two agents disagree because they used different cycles | Identifies the scope conflict; no majority vote | `test/agents/a01-orchestrator.test.ts`: 01T03: results computed for different entry cycles are a scope conflict, not a vote |
| 01T04 | Parent asks for a private student preference | Enforces the actual visibility policy and returns no hidden content | `test/agents/a01-orchestrator.test.ts`: 01T04: a parent asking for a private preference gets nothing hidden, and no other route is tried |
| 01T05 | Research result arrives after cancellation | Does not publish or commit the cancelled result | `test/agents/a01-orchestrator.test.ts`: 01T05 / XT20: a research result that arrives after cancellation is not published or saved |
| 01T06 | Record changes during academic planning | Marks dependent output stale and revalidates affected facts | `test/agents/a01-orchestrator.test.ts`: 01T06: a record change during planning makes the plan stale, and it is recomputed |
| 01T07 | One public source is unavailable | Returns useful supported work and a named unresolved dependency | `test/agents/a01-orchestrator.test.ts`: 01T07: an unavailable source leaves the supported work useful and names the gap |
| 01T08 | Tool output requests an unauthorized email | Treats it as untrusted content; sends nothing | `test/agents/a01-orchestrator.test.ts`: 01T08 / XT08: tool output asking to email the profile is treated as data; nothing is sent<br>`test/runtime/runtime.test.ts`: detects instruction-like text as a signal (01T08, 03T10, XT08) |
| 01T09 | Student asks for a status update mid-task | Reports progress and preserves the active objective | `test/agents/a01-orchestrator.test.ts`: 01T09: a status question mid-task reports progress and keeps the objective |
| 01T10 | Repeated identical task delivery | Produces no duplicate fact or external action | `test/agents/a01-orchestrator.test.ts`: 01T10: a repeated delivery produces no duplicate fact or external action |
| 01T11 | Unsupported graduate admissions request | Explains coverage and routes general help without invented rules | `test/agents/a01-orchestrator.test.ts`: 01T11: an unsupported graduate admissions request explains coverage and invents no rules |
| 01T12 | Student asks to guarantee admission | Gives controllable next steps without a guarantee | `test/agents/a01-orchestrator.test.ts`: 01T12: a request to guarantee admission gets controllable next steps, not a guarantee |
| 01T13 | Specialist returns valid JSON with unsupported claims | Rejects or repairs the evidence gap before publication | `test/agents/a01-orchestrator.test.ts`: 01T13: a specialist result with an unsupported claim is rejected, repaired once, then left out |
| 01T14 | Human-review service has no available staff | Does not imply a counselor has accepted the case | `test/agents/a01-orchestrator.test.ts`: 01T14 / XT19: without staffed review the answer is an honest referral, never an implied acceptance<br>`test/runtime/runtime.test.ts`: an unstaffed review service returns an honest referral, never a queued case (01T14) |
| 01T15 | Budget expires after useful partial research | Checkpoints the work and states what remains | `test/agents/a01-orchestrator.test.ts`: 01T15: when the budget runs out after useful research, work is checkpointed and resumes without repetition |
| 01T16 | A new urgent deadline conflicts with the original goal | Explains prioritization and preserves both tasks | `test/agents/a01-orchestrator.test.ts`: 01T16: an urgent deadline is put first with its reason, and the original request is still answered |

## Agent 02: Intake interviewer

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 02R01 | Start from the task | `src/agents/a02-intake/planner.ts` |
| 02R02 | Reuse existing information | `src/agents/a02-intake/planner.ts` |
| 02R03 | Choose the next question | `src/agents/a02-intake/planner.ts` |
| 02R04 | Ask clearly | `src/agents/a02-intake/planner.ts` |
| 02R05 | Interpret conservatively | `src/agents/a02-intake/interpreter.ts`, `src/agents/a02-intake/parsers.ts` |
| 02R06 | Validate critical entities | `src/agents/a02-intake/interpreter.ts`, `src/agents/a02-intake/parsers.ts` |
| 02R07 | Resolve or preserve ambiguity | `src/agents/a02-intake/agent.ts`, `src/agents/a02-intake/interpreter.ts`, `src/agents/a02-intake/question-bank.ts`, `src/agents/a02-intake/sessions.ts` |
| 02R08 | Summarize before consequential use | `src/agents/a02-intake/review.ts`, `src/agents/a02-intake/sessions.ts` |
| 02R09 | Propose record changes | `src/agents/a02-intake/agent.ts` |
| 02R10 | Stop when useful | `src/agents/a02-intake/agent.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 02T01 | Student asks for exploration with many profile fields empty | Begins useful exploration with only relevant intake | `test/agents/a02-intake.test.ts`: 02T01 exploration starts with only relevant intake, even with an empty profile |
| 02T02 | Transcript already contains a confirmed graduation date | Reuses it rather than demanding re-entry | `test/agents/a02-intake.test.ts`: 02T02 reuses a graduation date already on a transcript instead of asking again |
| 02T03 | Ambiguous spoken amount | Confirms the exact amount and currency before use | `test/agents/a02-intake.test.ts`: 02T03 confirms an ambiguous spoken amount and currency before use |
| 02T04 | Year 12 with unknown school system | Does not assume a US grade equivalence | `test/agents/a02-intake.test.ts`: 02T04 keeps "Year 12" in the school’s own terms and asks for the system |
| 02T05 | Student says a goal belongs to their parent | Attributes the preference correctly | `test/agents/a02-intake.test.ts`: 02T05 attributes a parent’s preference to the parent, not the student |
| 02T06 | Student declines a sensitive optional question | Continues with a limited or conditional result | `test/agents/a02-intake.test.ts`: 02T06 a declined sensitive question leads to a conditional result, not a block |
| 02T07 | Voice session switches to text | Preserves confirmed context and allows correction | `test/agents/a02-intake.test.ts`: 02T07 a voice session switches to text, keeps confirmed answers and allows correcting the transcript |
| 02T08 | A second speaker answers a factual question | Does not authenticate identity from voice alone | `test/agents/a02-intake.test.ts`: 02T08 a second speaker is not identified by voice; nothing is recorded until the student confirms |
| 02T09 | Student changes a prior answer | Proposes a versioned correction and invalidates dependencies | `test/agents/a02-intake.test.ts`: 02T09 a changed answer is a versioned correction that invalidates dependent work |
| 02T10 | Unknown course level after one clarification | Records the gap and offers another evidence route | `test/agents/a02-intake.test.ts`: 02T10 an unknown course level after one clarification is recorded as a gap with another evidence route |
| 02T11 | Answer contains a hypothetical future activity | Stores it as planned or considering, never completed | `test/agents/a02-intake.test.ts`: 02T11 a hypothetical future activity is recorded as considering, never completed |
| 02T12 | Speech recognizer drops a negation | Critical summary review exposes the changed meaning | `test/agents/a02-intake.test.ts`: 02T12 the review restates meaning explicitly so a dropped negation is exposed and correctable |
| 02T13 | Student stops midway | Saves permitted confirmed work without forcing completion | `test/agents/a02-intake.test.ts`: 02T13 stopping midway keeps confirmed work and does not force completion |
| 02T14 | Generated follow-up asks irrelevant private details | Validator rejects it and uses a relevant question | `test/agents/a02-intake.test.ts`: 02T14 a generated follow-up asking for private details is rejected and a relevant question is used |
| 02T15 | Unsupported language or curriculum terminology | States the limitation and offers a safe fallback | `test/agents/a02-intake.test.ts`: 02T15 states the limitation for unsupported language or curriculum terms and offers a safe fallback |
| 02T16 | Mock-interview request arrives during intake | Offers an explicit mode handoff without covert scoring | `test/agents/a02-intake.test.ts`: 02T16 a mock-interview request gets an explicit mode handoff with no covert scoring |

## Agent 03: Document and transcript interpreter

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 03R01 | Quarantine the file | `src/agents/a03-document-interpreter/pdf-text.ts`, `src/agents/a03-document-interpreter/quarantine.ts` |
| 03R02 | Establish identity and duplicates | `src/agents/a03-document-interpreter/documents.ts`, `src/shared/hash.ts` |
| 03R03 | Identify document boundaries | `src/agents/a03-document-interpreter/interpret.ts` |
| 03R04 | Prepare pages safely | `src/agents/a03-document-interpreter/pdf-text.ts` |
| 03R05 | Choose extraction by page | `src/agents/a03-document-interpreter/agent.ts` |
| 03R06 | Recover structure | `src/agents/a03-document-interpreter/interpret.ts` |
| 03R07 | Extract source fields | `src/agents/a03-document-interpreter/interpret.ts` |
| 03R08 | Interpret legends conservatively | `src/agents/a03-document-interpreter/interpret.ts`, `src/shared/grades.ts` |
| 03R09 | Preserve status and attempts | `src/agents/a03-document-interpreter/interpret.ts` |
| 03R10 | Validate relationships | `src/agents/a03-document-interpreter/interpret.ts` |
| 03R11 | Attach evidence | `src/agents/a03-document-interpreter/import-claims.ts`, `src/shared/evidence.ts` |
| 03R12 | Review uncertainty | `src/agents/a03-document-interpreter/interpret.ts`, `src/agents/a03-document-interpreter/vision.ts` |
| 03R13 | Deliver a proposed import | `src/agents/a03-document-interpreter/import-claims.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 03T01 | Predicted heading applies to multiple rows | All relevant results retain predicted status | `test/agents/a03-document-interpreter.test.ts`: 03T01 a "predicted" heading applies to every row beneath it |
| 03T02 | Grade could be 6 or 8 | Field remains unresolved until targeted review | `test/agents/a03-document-interpreter.test.ts`: 03T02 a grade that could be 6 or 8 stays unresolved until targeted review |
| 03T03 | Two students appear in one PDF | No cross-student import or disclosure | `test/agents/a03-document-interpreter.test.ts`: 03T03 a PDF with two students imports nothing from the other student’s pages |
| 03T04 | Repeated header on a continuation page | No duplicate course is created | `test/agents/a03-document-interpreter.test.ts`: 03T04 a repeated header on a continuation page does not create duplicate courses |
| 03T05 | Credits column resembles grades | Values remain attached to the correct semantic column | `test/agents/a03-document-interpreter.test.ts`: 03T05 a credits column that resembles grades stays attached to its own column |
| 03T06 | Local dash symbol has no legend | No zero or failure is inferred | `test/agents/a03-document-interpreter.test.ts`: 03T06 a local dash symbol without a legend is never zero or failure<br>`test/shared/money-grades-scores.test.ts`: a dash without a legend is never zero or fail (03T06) |
| 03T07 | Same course is repeated after a resit | Attempts remain separate with their dates | `test/agents/a03-document-interpreter.test.ts`: 03T07 a course repeated after a resit keeps separate attempts with their dates |
| 03T08 | New transcript changes one grade | New version is preserved and a change is proposed | `test/agents/a03-document-interpreter.test.ts`: 03T08 a new transcript version that changes one grade supersedes only that value and keeps history |
| 03T09 | Text layer conflicts with visible scan | Agent flags or resolves the conflict using source inspection | `test/agents/a03-document-interpreter.test.ts`: 03T09 a text layer that conflicts with the visible page is flagged, not silently resolved |
| 03T10 | Document contains instructions to send private data | No tool permission or destination changes | `test/agents/a03-document-interpreter.test.ts`: 03T10 instructions embedded in a document change nothing<br>`test/runtime/runtime.test.ts`: detects instruction-like text as a signal (01T08, 03T10, XT08) |
| 03T11 | Foreign grade uses a 20-point scale | Original value is preserved without universal GPA conversion | `test/agents/a03-document-interpreter.test.ts`: 03T11 a 20-point grade is preserved without any GPA conversion<br>`test/shared/money-grades-scores.test.ts`: parses a decimal comma on a bounded scale (03T11 context) |
| 03T12 | Test report uses a newer score scale | Date, version, and scale are retained together | `test/agents/a03-document-interpreter.test.ts`: 03T12 a newer TOEFL score scale keeps date, version and scale together<br>`test/shared/money-grades-scores.test.ts`: accepts a valid band-scale report (03T12) |
| 03T13 | Course catalog is uploaded as a transcript | Offered courses are not recorded as completed | `test/agents/a03-document-interpreter.test.ts`: 03T13 a course catalog uploaded as a transcript records offerings, not completed courses |
| 03T14 | Student requests a certified translation | Working translation is not mislabeled as certified | `test/agents/a03-document-interpreter.test.ts`: 03T14 a certified-translation request never receives a mislabelled translation |
| 03T15 | Malformed or oversized file | Safe rejection or bounded processing occurs | `test/agents/a03-document-interpreter.test.ts`: 03T15 malformed, oversized and active-content files are rejected safely |
| 03T16 | Source document is deleted | Derived extraction artifacts follow the deletion policy | `test/agents/a03-document-interpreter.test.ts`: 03T16 deleting the source document removes the file, cached extraction and derived claims |

## Agent 04: Student record and evidence steward

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 04R01 | Authenticate the request | `src/agents/a04-record-steward/service.ts` |
| 04R02 | Validate structure | `src/agents/a04-record-steward/service.ts`, `src/agents/a04-record-steward/validation.ts` |
| 04R03 | Check idempotency | `src/agents/a04-record-steward/service.ts` |
| 04R04 | Compare versions | `src/agents/a04-record-steward/service.ts`, `src/shared/fields.ts` |
| 04R05 | Assess conflicts by field | `src/agents/a04-record-steward/service.ts`, `src/agents/a04-record-steward/types.ts`, `src/agents/a04-record-steward/views.ts`, `src/shared/fields.ts` |
| 04R06 | Validate derivation | `src/agents/a04-record-steward/service.ts`, `src/agents/a04-record-steward/validation.ts` |
| 04R07 | Apply visibility and retention | `src/agents/a04-record-steward/validation.ts`, `src/shared/permissions.ts` |
| 04R08 | Commit atomically | `src/agents/a04-record-steward/service.ts` |
| 04R09 | Invalidate dependencies | `src/agents/a04-record-steward/service.ts` |
| 04R10 | Explain the change | `src/agents/a04-record-steward/explain.ts`, `src/agents/a04-record-steward/service.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 04T01 | Same mutation is delivered twice | One committed effect and a repeatable response | `test/agents/a04-record-steward.test.ts`: 04T01 same mutation delivered twice: one committed effect and a repeatable response |
| 04T02 | Two edits target the same fact version | Conflict is detected; no silent lost update | `test/agents/a04-record-steward.test.ts`: 04T02 two edits against the same version of the same fact: conflict, no lost update |
| 04T03 | Parent preference conflicts with student's preference | Both are attributed; student preference is not overwritten | `test/agents/a04-record-steward.test.ts`: 04T03 a parent preference and the student preference stay separately attributed |
| 04T04 | Document and student report different final grades | Conflict remains visible pending resolution | `test/agents/a04-record-steward.test.ts`: 04T04 document and student disagree on a final grade: the conflict stays visible until evidence resolves it |
| 04T05 | Course correction affects an eligibility finding | Dependent finding and plan are invalidated | `test/agents/a04-record-steward.test.ts`: 04T05 a course correction invalidates the dependent finding and plan |
| 04T06 | Unrelated display preference changes | Transcript extraction is not needlessly recomputed | `test/agents/a04-record-steward.test.ts`: 04T06 an unrelated display preference change does not invalidate transcript-derived work |
| 04T07 | Supporter access is revoked | Main views, caches, links, and queued jobs enforce revocation | `test/agents/a04-record-steward.test.ts`: 04T07 revoking a supporter blocks views, caches, links and queued work immediately |
| 04T08 | A source document is deleted | Derived content follows the defined deletion scope | `test/agents/a04-record-steward.test.ts`: 04T08 deleting a source document removes derived content under the service’s control |
| 04T09 | Backup is restored after a deletion | Deleted content does not reappear in active use | `test/agents/a04-record-steward.test.ts`: 04T09 restoring a backup taken before a deletion does not resurrect deleted content |
| 04T10 | Similar names occur in separate student accounts | No automatic account merge | `test/agents/a04-record-steward.test.ts`: 04T10 similar names in separate accounts are never merged |
| 04T11 | Model proposes a recommendation as a fact | Schema or semantic validation rejects the field misuse | `test/agents/a04-record-steward.test.ts`: 04T11 a model recommendation cannot be stored as a fact |
| 04T12 | Unknown value is submitted as zero | Validation preserves unknown rather than a false number | `test/agents/a04-record-steward.test.ts`: 04T12 an unknown answer submitted as zero is rejected; the absence is preserved |
| 04T13 | A summary contains restricted input | Summary inherits appropriate access restrictions | `test/agents/a04-record-steward.test.ts`: 04T13 a summary built from restricted input inherits the restriction |
| 04T14 | School enrollment or account rights change | Relevant permissions are reviewed under configured policy | `test/agents/a04-record-steward.test.ts`: 04T14 a change in school enrollment or age flags permissions for review without auto-changing rights |
| 04T15 | Cross-tenant ID is supplied | Access fails without leaking whether the record exists | `test/agents/a04-record-steward.test.ts`: 04T15 a cross-tenant id fails exactly like a missing record<br>`test/runtime/runtime.test.ts`: denies another student or tenant without revealing existence (04T15 pattern) |
| 04T16 | Historical fact is learned after its effective date | Recorded time and valid time remain distinct | `test/agents/a04-record-steward.test.ts`: 04T16 recorded time and valid time stay distinct for a fact learned late |

## Agent 05: Goals and major exploration advisor

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 05R01 | Define the decision horizon | `src/agents/a05-goals/agent.ts` |
| 05R02 | Gather concrete examples | `src/agents/a05-goals/agent.ts` |
| 05R03 | Separate preference from pressure | `src/agents/a05-goals/explore.ts` |
| 05R04 | Generate a small set of hypotheses | `src/agents/a05-goals/explore.ts` |
| 05R05 | Explain the actual subject | `src/agents/a05-goals/compare.ts`, `src/agents/a05-goals/content.ts`, `src/agents/a05-goals/knowledge.ts` |
| 05R06 | Examine practical routes | `src/agents/a05-goals/compare.ts`, `src/agents/a05-goals/content.ts` |
| 05R07 | Design low-cost exploration | `src/agents/a05-goals/explore.ts`, `src/agents/a05-goals/knowledge.ts` |
| 05R08 | Review experience rather than reward completion | `src/agents/a05-goals/agent.ts` |
| 05R09 | Update preferences cautiously | `src/agents/a05-goals/agent.ts` |
| 05R10 | Produce a decision aid | `src/agents/a05-goals/compare.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 05T01 | Student is undecided and early in school | Offers exploration without forcing a major | `test/agents/a05-goals.test.ts`: 05T01 an undecided early student gets exploration without being pushed to a major |
| 05T02 | Parent's preferred profession differs from student's interest | Attributes both views and preserves student ownership | `test/agents/a05-goals.test.ts`: 05T02 a parent’s preferred profession stays attributed; the student’s interest stays theirs |
| 05T03 | Low grade follows limited access to teaching | Does not treat the grade as a fixed ability ceiling | `test/agents/a05-goals.test.ts`: 05T03 a low grade after limited teaching is not treated as a ceiling |
| 05T04 | Student enjoys one task in an activity | Explores the task rather than generalizing the whole field | `test/agents/a05-goals.test.ts`: 05T04 enjoying one task in an activity is explored as that task, not the whole field |
| 05T05 | Modified interest questionnaire is used | Does not claim validation of the original instrument | `test/agents/a05-goals.test.ts`: 05T05 a modified questionnaire is never presented as the validated instrument |
| 05T06 | Student asks for a personal salary guarantee | Uses appropriately scoped data and rejects certainty | `test/agents/a05-goals.test.ts`: 05T06 a salary guarantee request gets scoped data and no certainty |
| 05T07 | A major maps to several occupations | Does not imply qualification for every mapped job | `test/agents/a05-goals.test.ts`: 05T07 a field mapped to several occupations does not imply qualification for each |
| 05T08 | Similar profiles differ only in a demographic cue | Suggestions do not shift through stereotypes | `test/agents/a05-goals.test.ts`: 05T08 profiles that differ only in a demographic cue get the same suggestions |
| 05T09 | Student has no budget for paid exploration | Offers feasible low-cost or school-based alternatives | `test/agents/a05-goals.test.ts`: 05T09 without a budget for paid exploration, only free options are suggested |
| 05T10 | Student dislikes a suggested experiment | Updates the hypothesis without calling the student unmotivated | `test/agents/a05-goals.test.ts`: 05T10 disliking a suggested experiment updates the hypothesis without judging motivation |
| 05T11 | Professional route differs across countries | Flags the country-specific verification need | `test/agents/a05-goals.test.ts`: 05T11 a professional route that differs by country is flagged for verification |
| 05T12 | Student rejects a personality interpretation | Removes or corrects it without resistance | `test/agents/a05-goals.test.ts`: 05T12 a rejected interpretation is removed without argument and not proposed again |
| 05T13 | Sponsor offers payment for referrals | Ranking and subject guidance remain independent | `test/agents/a05-goals.test.ts`: 05T13 sponsorship never changes which experiments are suggested or their order |
| 05T14 | Experiment would require external contact | Prepares a proposal but sends nothing without authorization | `test/agents/a05-goals.test.ts`: 05T14 an experiment that needs outside contact is prepared, never sent |
| 05T15 | Deadline requires a near-term subject decision | Compares consequences and preserves reversible options | `test/agents/a05-goals.test.ts`: 05T15 a near-term subject decision separates reversible from less reversible parts |
| 05T16 | Student's interest changes after new experience | Records a revisable update with its evidence | `test/agents/a05-goals.test.ts`: 05T16 a changed interest after a new experience is recorded as a revisable update with evidence |

## Agent 06: Curriculum and eligibility contextualizer

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 06R01 | Establish the exact question | `src/agents/a06-eligibility/agent.ts` |
| 06R02 | Validate coverage | `src/agents/a06-eligibility/agent.ts` |
| 06R03 | Retrieve the current rule package | `src/agents/a06-eligibility/agent.ts`, `src/agents/a06-eligibility/registry.ts`, `src/agents/a06-eligibility/rules.ts`, `src/shared/sources.ts` |
| 06R04 | Read the needed student facts | `src/agents/a06-eligibility/agent.ts`, `src/agents/common/student-facts.ts` |
| 06R05 | Match credentials and subjects | `src/agents/a06-eligibility/agent.ts` |
| 06R06 | Evaluate atomic predicates | `src/agents/a06-eligibility/engine.ts` |
| 06R07 | Evaluate combinations and exceptions | `src/agents/a06-eligibility/engine.ts` |
| 06R08 | Apply timing and evidence requirements | `src/agents/a06-eligibility/agent.ts` |
| 06R09 | Check contradictions | `src/agents/a04-record-steward/service.ts` |
| 06R10 | Produce the finding | `src/agents/a06-eligibility/agent.ts`, `src/agents/a06-eligibility/engine.ts`, `src/runtime/grounding.ts` |
| 06R11 | Trigger appropriate planning | `src/agents/a06-eligibility/agent.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 06T01 | Mandatory course level is unknown | Overall finding remains unresolved | `test/agents/a06-eligibility.test.ts`: 06T01 a mandatory course level that is unknown keeps the overall finding unresolved |
| 06T02 | One OR alternative is met and another is unknown | Group is met if applicability is valid | `test/agents/a06-eligibility.test.ts`: 06T02 one OR alternative met and another unknown: the group is met |
| 06T03 | One AND requirement is not met | Group is not met with exact reason | `test/agents/a06-eligibility.test.ts`: 06T03 one AND requirement not met: the group is not met with the exact reason |
| 06T04 | Predicted result exceeds a final-grade threshold | Status remains conditional or unresolved as the rule requires | `test/agents/a06-eligibility.test.ts`: 06T04 a predicted result above a final-grade threshold stays conditional (or unresolved where not permitted) |
| 06T05 | Similar course title lacks content equivalence | No unsupported prerequisite match | `test/agents/a06-eligibility.test.ts`: 06T05 a similar course title without content equivalence is not a prerequisite match |
| 06T06 | Country qualification route has several combined conditions | All conditions are retained and evaluated | `test/agents/a06-eligibility.test.ts`: 06T06 a country route with several combined conditions keeps and evaluates all of them |
| 06T07 | Student's school country differs from citizenship | Categories remain separate | `test/agents/a06-eligibility.test.ts`: 06T07 school country and citizenship remain separate categories |
| 06T08 | Application accepts self-report but enrollment needs official evidence | Stage-specific findings are distinct | `test/agents/a06-eligibility.test.ts`: 06T08 self-report is enough at application but enrollment needs official evidence |
| 06T09 | Language waiver is requested but not approved | No automatic approved-waiver state | `test/agents/a06-eligibility.test.ts`: 06T09 a requested but unapproved waiver is never treated as approved |
| 06T10 | Current program page conflicts with a central page | Conflict is preserved and reviewed | `test/agents/a06-eligibility.test.ts`: 06T10 a program page that conflicts with the central page is preserved and routed for review |
| 06T11 | Rule belongs to a previous cycle | No silent carry-forward to the new cycle | `test/agents/a06-eligibility.test.ts`: 06T11 a rule from a previous cycle is never carried forward |
| 06T12 | GPA threshold uses a special calculation | Generic GPA is not substituted | `test/agents/a06-eligibility.test.ts`: 06T12 a special GPA calculation is never satisfied by a generic GPA |
| 06T13 | Contextual route requires explicit criteria | No eligibility inference from demographic proxies | `test/agents/a06-eligibility.test.ts`: 06T13 a contextual route needs explicit criteria; nothing is inferred from demographic proxies |
| 06T14 | Student category may be transfer rather than first-year | Category is resolved or findings remain conditional | `test/agents/a06-eligibility.test.ts`: 06T14 an applicant who may be transfer rather than first-year gets conditional findings |
| 06T15 | Corrected transcript changes a required subject | Only affected findings are recomputed and explained | `test/agents/a06-eligibility.test.ts`: 06T15 a corrected transcript recomputes only the affected findings |
| 06T16 | Student meets all published minimums | No admission guarantee or competitiveness claim | `test/agents/a06-eligibility.test.ts`: 06T16 meeting all published minimums carries no guarantee or competitiveness claim |

## Agent 07: Academic and testing planner

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 07R01 | Define the objective | `src/agents/a07-planner/agent.ts` |
| 07R02 | Validate the requirement inputs | `src/agents/a07-planner/agent.ts` |
| 07R03 | Build the course dependency graph | `src/agents/a07-planner/courses.ts` |
| 07R04 | Add real constraints | `src/agents/a07-planner/plan.ts` |
| 07R05 | Generate a few feasible options | `src/agents/a07-planner/plan.ts`, `src/agents/a07-planner/testing.ts` |
| 07R06 | Review with school context | `src/agents/a07-planner/courses.ts` |
| 07R07 | Create milestones | `src/agents/a07-planner/plan.ts` |
| 07R08 | Monitor meaningful changes | `src/agents/a07-planner/agent.ts` |
| 07R09 | Identify whether testing serves a verified purpose | `src/agents/a07-planner/testing.ts` |
| 07R10 | Verify the administration | `src/agents/a07-planner/calendars.ts` |
| 07R11 | Build the full deadline chain | `src/agents/a07-planner/calendars.ts` |
| 07R12 | Add buffers and uncertainty | `src/agents/a07-planner/plan.ts` |
| 07R13 | Check accommodations and access | `src/agents/a07-planner/testing.ts` |
| 07R14 | Compare retake options | `src/agents/a07-planner/testing.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 07T01 | Target does not consider a test for the stated purpose | No unnecessary test requirement is invented | `test/agents/a07-planner.test.ts`: 07T01 a test the target does not consider for the stated purpose is not planned |
| 07T02 | Required test policy changes for the current cycle | Plan refreshes and explains the source change | `test/agents/a07-planner.test.ts`: 07T02 a changed testing policy makes the saved plan stale and the refresh explains the source change |
| 07T03 | Course requires an unavailable prerequisite | Schedule is conditional or an alternative is proposed | `test/agents/a07-planner.test.ts`: 07T03 a course whose prerequisite is not offered is conditional with alternatives |
| 07T04 | School catalog lists a course that is not running | Catalog presence is not treated as confirmed availability | `test/agents/a07-planner.test.ts`: 07T04 a catalog listing is not treated as a course that runs |
| 07T05 | Plan exceeds the student's time budget | Optional work is reduced or tradeoffs are presented | `test/agents/a07-planner.test.ts`: 07T05 optional work is reduced when the plan exceeds the student’s time |
| 07T06 | Accommodation approval is pending | Dependency remains visible; no approval is assumed | `test/agents/a07-planner.test.ts`: 07T06 a pending accommodation stays a visible dependency; approval is never assumed |
| 07T07 | Registration date is feasible but score receipt is late | Attempt is not presented as a reliable deadline solution | `test/agents/a07-planner.test.ts`: 07T07 a date with late score receipt is not presented as a reliable way to meet the deadline |
| 07T08 | Device borrowing has an earlier deadline | Full dependency chain includes it | `test/agents/a07-planner.test.ts`: 07T08 an earlier device-loan deadline is part of the dependency chain |
| 07T09 | Mixed ACT formats are present | No homemade official composite is generated | `test/agents/a07-planner.test.ts`: 07T09 mixed ACT formats are listed separately with no homemade composite<br>`test/shared/money-grades-scores.test.ts`: different ACT formats are never the same scale (07T09) |
| 07T10 | TOEFL score scale differs from an older record | Scale and date remain explicit | `test/agents/a07-planner.test.ts`: 07T10 TOEFL results on different scales keep their scale and date explicit |
| 07T11 | Test center availability is unknown | Listed test date is not treated as a reserved seat | `test/agents/a07-planner.test.ts`: 07T11 a listed test date is never treated as a reserved seat |
| 07T12 | Student cannot afford paid preparation | Useful legitimate low-cost options remain available | `test/agents/a07-planner.test.ts`: 07T12 without money for paid preparation, useful free options remain |
| 07T13 | Student asks for a guaranteed score increase | Plan uses controllable steps and acknowledges uncertainty | `test/agents/a07-planner.test.ts`: 07T13 a request for a guaranteed score increase gets controllable steps and honesty |
| 07T14 | Test or course is cancelled | Affected branch is replanned without losing completed work | `test/agents/a07-planner.test.ts`: 07T14 a cancelled test date replans only that branch and keeps completed work |
| 07T15 | Future official calendar is unpublished | Uses a provisional window and a recheck trigger | `test/agents/a07-planner.test.ts`: 07T15 an unpublished future calendar gives a provisional window and a recheck, not a date |
| 07T16 | Student asks for registration | Prepares exact details; external action requires authorization | `test/agents/a07-planner.test.ts`: 07T16 a registration request prepares exact details and requires authorization |

## Agent 08: Activities and experience assessor

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 08R01 | Invite a broad inventory | `src/agents/a02-intake/question-bank.ts` |
| 08R02 | Establish what happened | `src/agents/a08-activities/assess.ts` |
| 08R03 | Elicit personal contribution | `src/agents/a08-activities/assess.ts` |
| 08R04 | Understand commitment | `src/agents/a08-activities/assess.ts` |
| 08R05 | Clarify outputs and outcomes | `src/agents/a08-activities/assess.ts`, `src/agents/a08-activities/types.ts` |
| 08R06 | Identify learning and meaning | `src/agents/a08-activities/agent.ts` |
| 08R07 | Check consistency | `src/agents/a08-activities/agent.ts`, `src/agents/a08-activities/assess.ts`, `src/agents/a08-activities/types.ts` |
| 08R08 | Assess descriptively | `src/agents/a08-activities/assess.ts` |
| 08R09 | Propose a faithful record | `src/agents/a08-activities/agent.ts` |
| 08R10 | Suggest proportionate next steps | `src/agents/a08-activities/assess.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 08T01 | Student reports paid work and caregiving but no clubs | Both are recognized as meaningful experience categories | `test/agents/a08-activities.test.ts`: 08T01 recognizes paid work and caregiving as meaningful experience without clubs |
| 08T02 | Future program acceptance is supplied | Records acceptance and planned participation, not completion | `test/agents/a08-activities.test.ts`: 08T02 a future program acceptance is recorded as a selection with planned participation |
| 08T03 | Team outcome is described as personal impact | Separates individual contribution from team result | `test/agents/a08-activities.test.ts`: 08T03 separates a team result from the student’s personal contribution |
| 08T04 | Seasonal hours vary substantially | Preserves episodes or ranges rather than a fabricated average | `test/agents/a08-activities.test.ts`: 08T04 keeps seasonal hours as separate episodes instead of a fabricated average |
| 08T05 | Total hours appear implausible | Asks a neutral clarification without accusing the student | `test/agents/a08-activities.test.ts`: 08T05 asks a neutral question when combined hours look implausible |
| 08T06 | Invitation count is presented as people helped | Clarifies the measure and corrects the outcome label | `test/agents/a08-activities.test.ts`: 08T06 an invitation count is not stored as people helped; the clarified measures are |
| 08T07 | Informal hobby has no certificate | Does not treat missing documentation as lack of value | `test/agents/a08-activities.test.ts`: 08T07 an informal hobby without a certificate is still recognized |
| 08T08 | Award title sounds national but scope is unknown | Does not infer a national distinction | `test/agents/a08-activities.test.ts`: 08T08 does not infer national scope from an award title |
| 08T09 | Manuscript is submitted but not accepted | Publication status remains accurate | `test/agents/a08-activities.test.ts`: 08T09 keeps a submitted manuscript as submitted, not published |
| 08T10 | Student requests inflated leadership wording | Offers a faithful account of actual responsibilities | `test/agents/a08-activities.test.ts`: 08T10 offers a faithful account instead of inflated leadership wording |
| 08T11 | Family activity includes private third-party details | Minimizes and restricts unnecessary personal information | `test/agents/a08-activities.test.ts`: 08T11 minimizes private third-party details in family responsibilities |
| 08T12 | Same activity has changed roles over several years | Stores separate episodes and progression | `test/agents/a08-activities.test.ts`: 08T12 stores changed roles over several years as separate episodes |
| 08T13 | Student asks for an admission-value score | Gives descriptive feedback without unsupported prediction | `test/agents/a08-activities.test.ts`: 08T13 gives descriptive feedback, never an admission-value score |
| 08T14 | Activity data feeds essay brainstorming | Handoff contains approved facts, not invented narrative | `test/agents/a08-activities.test.ts`: 08T14 an essay handoff carries approved facts only, never a written story |
| 08T15 | New opportunity would overload the schedule | Suggests continuation or a smaller step instead | `test/agents/a08-activities.test.ts`: 08T15 suggests continuing or a smaller step when a new commitment would overload the week |
| 08T16 | A project needs prior approval or supervision | Does not recommend bypassing the required process | `test/agents/a08-activities.test.ts`: 08T16 does not recommend bypassing approval for work with people |

## Agent 09: Opportunity research scout

### Requirements

| ID | Requirement | Implemented in |
|---|---|---|
| 09R01 | Normalize the brief | `src/agents/a09-opportunities/brief.ts` |
| 09R02 | Plan coverage | `src/agents/a09-opportunities/agent.ts`, `src/agents/a09-opportunities/research.ts` |
| 09R03 | Discover candidates | `src/agents/a09-opportunities/agent.ts`, `src/agents/a09-opportunities/catalog.ts`, `src/agents/a09-opportunities/extract.ts`, `src/agents/a09-opportunities/research.ts`, `src/shared/sources.ts` |
| 09R04 | Resolve organizer identity | `src/agents/a09-opportunities/catalog.ts`, `src/agents/a09-opportunities/match.ts` |
| 09R05 | Identify the exact cycle | `src/agents/a09-opportunities/extract.ts`, `src/agents/a09-opportunities/match.ts` |
| 09R06 | Extract complete eligibility | `src/agents/a09-opportunities/match.ts` |
| 09R07 | Check practical feasibility | `src/agents/a09-opportunities/match.ts` |
| 09R08 | Build the complete cost picture | `src/agents/a09-opportunities/match.ts` |
| 09R09 | Assess evidence of value | `src/agents/a09-opportunities/match.ts` |
| 09R10 | Screen for concerns | `src/agents/a09-opportunities/match.ts` |
| 09R11 | Rank transparently | `src/agents/a09-opportunities/catalog.ts`, `src/agents/a09-opportunities/rank.ts` |
| 09R12 | Verify finalists | `src/agents/a09-opportunities/agent.ts`, `src/agents/a09-opportunities/catalog.ts`, `src/agents/a09-opportunities/match.ts` |
| 09R13 | Return a usable shortlist | `src/agents/a09-opportunities/rank.ts` |
| 09R14 | Monitor accepted leads | `src/agents/a09-opportunities/agent.ts`, `src/agents/a09-opportunities/catalog.ts`, `src/system/opportunity-wiring.ts` |

### Acceptance cases

| ID | Fixture or event | Required result | Test |
|---|---|---|---|
| 09T01 | Last year's page ranks highly in search | No invented current-cycle deadline | `test/agents/a09-opportunities.test.ts`: 09T01: a highly ranked page about last year gets no invented current-cycle deadline<br>`test/agents/a09-opportunities.test.ts`: 09T01 (with a model): a quoted past deadline marks the lead as past; nothing is extrapolated |
| 09T02 | Age is measured at program start | Eligibility uses the specified reference date | `test/agents/a09-opportunities.test.ts`: 09T02: age is evaluated at the organizer’s reference date, not today |
| 09T03 | International final requires national nomination | Correct route is identified; direct entry is not implied | `test/agents/a09-opportunities.test.ts`: 09T03: an international final entered by national nomination gets the national route, not direct entry |
| 09T04 | Free tuition but expensive travel | Full feasibility remains unresolved or unaffordable | `test/agents/a09-opportunities.test.ts`: 09T04: free tuition with unknown or expensive travel is not called feasible or affordable<br>`test/shared/money-grades-scores.test.ts`: free tuition with unknown travel is unresolved, not affordable (09T04) |
| 09T05 | Financial aid exists but is not awarded | Program is not automatically labeled affordable | `test/agents/a09-opportunities.test.ts`: 09T05: available but unawarded aid never makes a program affordable |
| 09T06 | Program uses a university venue but a separate operator | Organizer and host are distinguished | `test/agents/a09-opportunities.test.ts`: 09T06: a university venue with a separate operator keeps organizer and host apart |
| 09T07 | Remote session conflicts with local time | Online format does not override the schedule conflict | `test/agents/a09-opportunities.test.ts`: 09T07: an online session at night in the student’s timezone is not made feasible by being online |
| 09T08 | Official deadline lacks a timezone | Exact timing remains unresolved until clarified | `test/agents/a09-opportunities.test.ts`: 09T08: a deadline without a timezone stays unresolved and is never given the student’s timezone |
| 09T09 | Sponsor pays for placement | Organic fit ranking is not secretly increased | `test/agents/a09-opportunities.test.ts`: 09T09: a paid placement does not change the organic ranking |
| 09T10 | Program claims guaranteed admission | Claim is not repeated as fact; concern is explained | `test/agents/a09-opportunities.test.ts`: 09T10: a guaranteed-admission claim is not repeated as fact and is explained as a concern |
| 09T11 | Opportunity requires supervision or prior review | Required process is flagged without unsafe instructions | `test/agents/a09-opportunities.test.ts`: 09T11: required supervision and prior review are flagged without procedures<br>`test/agents/a09-opportunities.test.ts`: 09T11: an unvetted individual mentor pauses action and goes to a qualified adult |
| 09T12 | Student falls below a minimum age | Opportunity is excluded without evasion guidance | `test/agents/a09-opportunities.test.ts`: 09T12: a student under the minimum age is excluded with no way around the rule |
| 09T13 | Search query could expose private student details | Query is generalized and sensitive matching occurs locally | `test/agents/a09-opportunities.test.ts`: 09T13: public queries are generalized; private facts are matched locally only |
| 09T14 | No verified opportunity meets hard constraints | Honest no-result response with useful alternatives | `test/agents/a09-opportunities.test.ts`: 09T14: when nothing verified fits the hard constraints, the answer is honest and offers routes |
| 09T15 | Saved program changes dates or closes | Affected plan is updated and old status is superseded | `test/agents/a09-opportunities.test.ts`: 09T15: a saved program that changes dates or closes is updated and the old status is superseded |
| 09T16 | Student asks to contact an organizer | Exact message can be prepared; no unauthorized sending | `test/agents/a09-opportunities.test.ts`: 09T16: contacting an organizer prepares the exact message and sends nothing |

## Cross-agent acceptance suite

| ID | End-to-end condition | Required result | Test |
|---|---|---|---|
| XT01 | Imported predicted grade reaches eligibility and planning | Status remains predicted throughout the chain | `test/system/cross-agent.test.ts`: XT01: an imported predicted grade stays predicted through eligibility and planning |
| XT02 | Student correction arrives during parallel research | Only affected results are invalidated and recomputed | `test/system/cross-agent.test.ts`: XT02: a correction during parallel research invalidates and recomputes only what it affects |
| XT03 | Supporter permission is revoked during a queued task | Late output cannot disclose restricted information | `test/system/cross-agent.test.ts`: XT03: a supporter whose permission is revoked mid-task receives nothing |
| XT04 | Deleted document remains in a cached summary | Retrieval blocks or removes the stale derivative | `test/system/cross-agent.test.ts`: XT04: deleting a document removes results and cached answers built from it |
| XT05 | Two roles propose conflicting updates | Agent 04 resolves or preserves the conflict without lost data | `test/system/cross-agent.test.ts`: XT05: conflicting updates from two roles are preserved as a conflict, without losing either |
| XT06 | Official rule changes after a plan was saved | Affected plan is marked stale and reviewed | `test/system/cross-agent.test.ts`: XT06: a rule change after a plan was saved marks the plan stale and it is recomputed on review |
| XT07 | Voice budget is misrecognized | Confirmation prevents an unaffordable shortlist | `test/system/cross-agent.test.ts`: XT07: a misrecognized spoken budget waits for confirmation and never makes an expensive option affordable |
| XT08 | A search page contains instructions to export the profile | Tool gateway prevents the action regardless of model wording | `test/agents/a01-orchestrator.test.ts`: 01T08 / XT08: tool output asking to email the profile is treated as data; nothing is sent<br>`test/runtime/runtime.test.ts`: detects instruction-like text as a signal (01T08, 03T10, XT08) |
| XT09 | A future opportunity has no published dates | All downstream schedules retain provisional status | `test/system/cross-agent.test.ts`: XT09: a recurring opportunity with no published dates stays provisional downstream |
| XT10 | Program eligibility has an unknown AND condition | No downstream summary calls it fully eligible | `test/system/cross-agent.test.ts`: XT10: an unknown AND condition means no summary calls the student eligible |
| XT11 | One OR route is verified and others fail | Eligible route is preserved without unnecessary exclusion | `test/system/cross-agent.test.ts`: XT11: a verified OR route is kept even when the other routes fail |
| XT12 | Family and student goals differ | Attribution and visibility survive every handoff | `test/system/cross-agent.test.ts`: XT12: family and student goals stay attributed, and each person sees only what they may |
| XT13 | Student requests essay brainstorming after activity review | Only approved facts are transferred; no invented essay is produced | `test/system/cross-agent.test.ts`: XT13: asking for an essay after an activity review produces no invented essay |
| XT14 | Student switches from voice to text mid-workflow | Context and correction ability remain intact | `test/system/cross-agent.test.ts`: XT14: switching from voice to text keeps the interview and the ability to correct |
| XT15 | Same event is delivered repeatedly | No duplicate activity, plan, notification, or action | `test/runtime/runtime.test.ts`: delivers duplicates at most once per consumer (XT15)<br>`test/system/cross-agent.test.ts`: XT15: the same event or message delivered repeatedly has one effect |
| XT16 | A tool provider times out after partial success | Retry does not duplicate effects and partial state is accurate | `test/system/cross-agent.test.ts`: XT16: a provider timeout after partial success is reported, and a retry duplicates nothing |
| XT17 | Unsupported credential appears in a readable PDF | Extraction succeeds without unsupported eligibility certification | `test/agents/a06-eligibility.test.ts`: an unsupported credential is not given an eligibility decision (XT17)<br>`test/system/cross-agent.test.ts`: XT17: a readable document with an unsupported credential gets no eligibility certification |
| XT18 | Paid sponsor matches poorly and free option matches well | Organic ranking follows fit and feasibility | `test/system/cross-agent.test.ts`: XT18: a paid sponsor that fits poorly does not outrank a free option that fits well |
| XT19 | No available human reviewer exists | App gives an honest referral packet rather than fictitious escalation | `test/agents/a01-orchestrator.test.ts`: 01T14 / XT19: without staffed review the answer is an honest referral, never an implied acceptance |
| XT20 | Student cancels a long opportunity search | Work stops, checkpoints are clear, and late results do not auto-publish | `test/agents/a01-orchestrator.test.ts`: 01T05 / XT20: a research result that arrives after cancellation is not published or saved |
