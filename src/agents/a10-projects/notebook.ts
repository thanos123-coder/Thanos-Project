import { z } from 'zod';
import { AccessDeniedError } from '../../shared/errors.js';
import type { DerivativeStore } from '../a04-record-steward/types.js';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { detectPrivateDetails } from './checks.js';

/**
 * The project evidence notebook (10 "Data and output contract"). It holds a
 * link, a short note, a reference to a photograph of permitted work, or the
 * student's own explanation. It does not demand third-party material: an
 * entry that contains another person's private details (a participant's
 * name, contact details, health information) is restricted at once, kept out
 * of every agent's context, and paired with a redacted version and a
 * minimal-evidence suggestion for the student to choose (10T14).
 */

export const NOTEBOOK_KINDS = ['link', 'note', 'photo', 'explanation', 'check_in'] as const;
export type NotebookKind = (typeof NOTEBOOK_KINDS)[number];

export interface NotebookEntry {
  entryId: string;
  tenantId: string;
  studentId: string;
  projectId: string;
  kind: NotebookKind;
  text: string;
  url: string | null;
  createdAt: string;
  access: 'normal' | 'restricted';
  privateKinds: string[];
  redactionProposal: string | null;
  status: 'active' | 'redacted' | 'removed';
}

/** What agents see: a restricted entry's text is never returned, only that it exists and what could replace it. */
export interface NotebookView {
  entryId: string;
  projectId: string;
  kind: NotebookKind;
  text: string | null;
  url: string | null;
  createdAt: string;
  access: 'normal' | 'restricted';
  privateKinds: string[];
  redactionProposal: string | null;
  status: NotebookEntry['status'];
}

export const MINIMAL_EVIDENCE_NOTE = 'Keep a short note of what you did and where the originals are held (for example, “ran a survey with 12 classmates; responses kept by my teacher”) instead of the details themselves.';

export class ProjectNotebook {
  private readonly entries = new Map<string, NotebookEntry>();
  private n = 0;

  constructor(private readonly now: () => string) {}

  add(input: { tenantId: string; studentId: string; projectId: string; kind: NotebookKind; text: string; url: string | null }): NotebookEntry {
    const found = detectPrivateDetails(input.text);
    this.n += 1;
    const e: NotebookEntry = { entryId: `nb_${this.n}`, ...input, createdAt: this.now(), access: found.found ? 'restricted' : 'normal', privateKinds: found.kinds, redactionProposal: found.found ? found.redacted : null, status: 'active' };
    this.entries.set(e.entryId, e);
    return structuredClone(e);
  }

  list(tenantId: string, studentId: string, projectId: string): NotebookEntry[] {
    return [...this.entries.values()].filter((e) => e.tenantId === tenantId && e.studentId === studentId && e.projectId === projectId && e.status !== 'removed').map((e) => structuredClone(e));
  }

  /** The student accepts the redaction: the private details are gone from the entry, not hidden. */
  applyRedaction(tenantId: string, studentId: string, entryId: string): NotebookEntry | undefined {
    const e = this.entries.get(entryId);
    if (!e || e.tenantId !== tenantId || e.studentId !== studentId || e.access !== 'restricted' || e.redactionProposal === null) return undefined;
    e.text = e.redactionProposal;
    e.access = 'normal';
    e.privateKinds = [];
    e.redactionProposal = null;
    e.status = 'redacted';
    return structuredClone(e);
  }

  remove(tenantId: string, studentId: string, entryId: string): boolean {
    const e = this.entries.get(entryId);
    if (!e || e.tenantId !== tenantId || e.studentId !== studentId) return false;
    e.status = 'removed';
    e.text = '';
    e.redactionProposal = null;
    return true;
  }

  /** Account deletion removes every entry for the student, not just hides it. */
  purgeByStudent(tenantId: string, studentId: string): number {
    let n = 0;
    for (const [id, e] of [...this.entries]) {
      if (e.tenantId !== tenantId || e.studentId !== studentId) continue;
      this.entries.delete(id);
      n += 1;
    }
    return n;
  }

  /** The record service's hook for deletion (notebook entries are keyed by student, not by document or claim). */
  asDerivativeStore(): DerivativeStore {
    return { name: 'project_notebook', purgeByDocument: () => 0, purgeByClaims: () => 0, purgeByStudent: (t, s) => this.purgeByStudent(t, s) };
  }

  /** Raw access for the student's own interface and tests; never exposed through a tool. */
  get(entryId: string): NotebookEntry | undefined {
    const e = this.entries.get(entryId);
    return e ? structuredClone(e) : undefined;
  }
}

export function viewOf(e: NotebookEntry): NotebookView {
  return { entryId: e.entryId, projectId: e.projectId, kind: e.kind, text: e.access === 'restricted' ? null : e.text, url: e.url, createdAt: e.createdAt, access: e.access, privateKinds: e.privateKinds, redactionProposal: e.redactionProposal, status: e.status };
}

export function registerProjectTools(gateway: ToolGateway, notebook: ProjectNotebook): void {
  gateway.register({
    name: 'projects.notebook',
    description: 'Add to or read the student’s project evidence notebook. Entries with other people’s private details are restricted and never returned; a redaction can be applied only by the student.',
    kind: 'write',
    args: z.discriminatedUnion('op', [
      z.object({ op: z.literal('add'), projectId: z.string().regex(/^[a-z0-9_]+$/), kind: z.enum(NOTEBOOK_KINDS), text: z.string().min(1).max(4000), url: z.string().url().nullable().default(null) }).strict(),
      z.object({ op: z.literal('list'), projectId: z.string().regex(/^[a-z0-9_]+$/) }).strict(),
      z.object({ op: z.literal('apply_redaction'), entryId: z.string().min(1) }).strict(),
    ]),
    handler: async (inv, args): Promise<NotebookView | NotebookView[] | null> => {
      if (args.op === 'list') return notebook.list(inv.tenantId, inv.studentId, args.projectId).map(viewOf);
      if (args.op === 'apply_redaction') {
        if (inv.actor.kind !== 'student') throw new AccessDeniedError('not_found_or_denied', 'Only the student can change their notebook');
        const e = notebook.applyRedaction(inv.tenantId, inv.studentId, args.entryId);
        return e ? viewOf(e) : null;
      }
      return viewOf(notebook.add({ tenantId: inv.tenantId, studentId: inv.studentId, projectId: args.projectId, kind: args.kind, text: args.text, url: args.url }));
    },
  });
}
