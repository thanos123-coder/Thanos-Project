/**
 * AI College Counselor: specialist agents 01-09 and the system that runs them.
 *
 * Most applications need only `CounselorSystem`: one object that wires the
 * record service, task state, document store, rule and calendar registries,
 * the opportunity catalog, the tool gateway and all nine agents behind a small
 * interface (ask, reply, confirm, status, cancel, resume, updates, uploads and
 * action approval). The namespaces below expose each agent's module for
 * integrations that need lower-level access.
 */
export const VERSION = '0.1.0';

export { CounselorSystem, type CounselorMessage, type CounselorResponse, type CounselorSystemOptions } from './system/counselor-system.js';
export { SystemKernel, type InvocationOutcome, type KernelOptions, type TaskSpec } from './system/kernel.js';
export { connectInstitutionClaims } from './system/institution-wiring.js';
export { connectOpportunityCatalog } from './system/opportunity-wiring.js';
export { registerOrchestrationTools, ROLE_PURPOSES, type InvokeOutcome } from './system/orchestration-tools.js';

export * as shared from './shared/index.js';
export * as runtime from './runtime/index.js';
export * as model from './model/index.js';

export * as leadCounselor from './agents/a01-orchestrator/index.js';
export * as intake from './agents/a02-intake/index.js';
export * as documents from './agents/a03-document-interpreter/index.js';
export * as record from './agents/a04-record-steward/index.js';
export * as goals from './agents/a05-goals/index.js';
export * as eligibility from './agents/a06-eligibility/index.js';
export * as planner from './agents/a07-planner/index.js';
export * as activities from './agents/a08-activities/index.js';
export * as opportunities from './agents/a09-opportunities/index.js';
export * as officialResearch from './agents/a11-research/index.js';
