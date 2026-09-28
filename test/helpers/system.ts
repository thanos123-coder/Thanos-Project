import type { ModelGateway } from '../../src/model/gateway.js';
import type { FetchedPage, GeneralizedQuery, ResearchProviders, SearchHit } from '../../src/agents/a09-opportunities/research.js';
import type { ReviewStaffing } from '../../src/runtime/human-review.js';
import { FixedClock } from '../../src/shared/clock.js';
import type { ClaimInput } from '../../src/shared/facts.js';
import { SequentialIdGenerator } from '../../src/shared/ids.js';
import type { Actor } from '../../src/shared/permissions.js';
import { CounselorSystem, type CounselorMessage } from '../../src/system/counselor-system.js';
import { PAGE_TEXT } from '../fixtures/opportunities.js';
import { TENANT } from './kernel.js';

/** A whole counselor system with deterministic time, ids and public research. */
export function makeSystem(opts: { model?: ModelGateway; reviewStaffing?: ReviewStaffing; now?: string; search?: (q: GeneralizedQuery) => Promise<SearchHit[]> | SearchHit[] } = {}) {
  const clock = new FixedClock(opts.now ?? '2026-09-27T10:00:00Z');
  const ids = new SequentialIdGenerator();
  const searches: Array<{ query: GeneralizedQuery; text: string }> = [];
  const fetches: string[] = [];
  const pages = new Map<string, Partial<FetchedPage>>();
  let hits: SearchHit[] = [];
  const research: ResearchProviders = {
    search: { search: async (query, text) => (searches.push({ query, text }), opts.search ? await opts.search(query) : hits) },
    fetch: {
      fetch: async (url) => {
        fetches.push(url);
        const o = pages.get(url);
        const text = o?.text ?? PAGE_TEXT[url];
        if (text === undefined && !o) throw new Error('not found');
        return { finalUrl: url, status: 200, contentType: 'text/html', text: text ?? '', ...o };
      },
    },
  };
  const options: ConstructorParameters<typeof CounselorSystem>[0] = { clock, ids, research, documents: { fingerprintSecret: 'test-secret' } };
  if (opts.model) options.model = opts.model;
  if (opts.reviewStaffing) options.reviewStaffing = opts.reviewStaffing;
  const system = new CounselorSystem(options);
  const student: Actor = { id: 'acct_student_1', kind: 'student', tenantId: TENANT };
  const studentId = system.createStudent({ tenantId: TENANT, ownerActorId: student.id });
  let n = 0;
  const seed = (claims: ClaimInput[], actor: Actor = student) => {
    const r = system.kernel.records.applyMutation({ actor, viaRole: 'ui', purpose: 'counseling' }, TENANT, studentId, { mutationId: `seed_${++n}`, operation: 'add_claims', claims, targetClaimIds: [], expectedRecordVersion: system.kernel.records.recordVersion(TENANT, studentId)!, reason: 'test seed' });
    if (r.outcome !== 'accepted') throw new Error(`seed rejected: ${r.reasons.join('; ')}`);
    return r;
  };
  const ask = (text: string, extra: Omit<CounselorMessage, 'text'> = {}, actor: Actor = student) => system.ask(actor, TENANT, studentId, { text, ...extra });
  const ok = async (text: string, extra: Omit<CounselorMessage, 'text'> = {}, actor: Actor = student) => {
    const r = await ask(text, extra, actor);
    if (!r.accepted) throw new Error(`counselor answer rejected: ${r.issues.join('; ')} / ${r.summary}`);
    return r;
  };
  /** Specialist tasks started under the lead counselor, by role, in order. */
  const invoked = () => system.kernel.audit.list({ kind: 'tool_call', name: 'specialist.invoke' }).length;
  const ui = { actor: student, viaRole: 'ui', purpose: 'counseling' as const };
  const record = () => system.kernel.records.readScoped(ui, { tenantId: TENANT, studentId, role: '04', mode: 'local' });
  return { system, clock, ids, student, studentId, seed, ask, ok, searches, fetches, pages, setHits: (x: SearchHit[]) => (hits = x), invoked, ui, record };
}
