import { z } from 'zod';
import type { PermissionService } from '../a04-record-steward/permissions.js';
import type { DerivativeStore } from '../a04-record-steward/types.js';
import { AssistanceOperationSchema, DestinationRefSchema, type AssistanceOperation, type DestinationRef } from '../../policy/assistance.js';
import type { ToolGateway, ToolInvocation } from '../../runtime/tool-gateway.js';
import { AccessDeniedError } from '../../shared/errors.js';
import { sha256Hex } from '../../shared/hash.js';

/**
 * The draft registry (18 "Artifact and destination model").
 *
 * Each response is a versioned artifact with its exact prompt, destinations,
 * cycle, field, the student's declared provenance and its assistance
 * history. A copy made for another destination keeps a link to its source
 * and carries the source's assistance history with it: a new filename does
 * not erase provenance (18T16). Uploading a draft never certifies it as
 * wholly student-written; the student's own declaration is recorded as such.
 * The student's decisions about findings (keep, revise, investigate,
 * dismiss, defer) are kept so the same finding is not raised again.
 */

export const DECLARED_PROVENANCE = ['student_written', 'student_with_help', 'unknown'] as const;
export const DISPOSITIONS = ['keep', 'revise', 'investigate', 'dismiss', 'defer'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const FactLinkSchema = z
  .object({
    /** The student's words in the draft that state the fact. */
    quote: z.string().min(1).max(400),
    /** The record field the fact concerns, e.g. episode:robotics_2025.definition. */
    fieldKey: z.string().min(1).max(200),
    /** Where in the field's value the fact sits, e.g. ["period", "start"]. */
    path: z.array(z.string().min(1)).max(6).default([]),
    asserted: z.unknown(),
  })
  .strict();
export type FactLink = z.infer<typeof FactLinkSchema>;

export const DraftInputSchema = z
  .object({
    artifactId: z.string().regex(/^[a-z0-9_]+$/).max(80),
    title: z.string().min(1).max(120),
    /** Responses in one application are compared with each other; the same essay sent to separate applications is not. */
    applicationId: z.string().regex(/^[a-z0-9_]+$/).max(80).nullable().default(null),
    cycle: z.string().regex(/^\d{4}$/),
    destinations: z.array(DestinationRefSchema).min(1).max(20),
    /** The prompt field this answers (the prompt id in the manifest). */
    fieldId: z.string().regex(/^[a-z0-9_]+$/).max(80),
    text: z.string().max(20000),
    declaredProvenance: z.enum(DECLARED_PROVENANCE).default('unknown'),
    assistance: z.array(z.object({ operation: AssistanceOperationSchema, detail: z.string().max(300).nullable().default(null) }).strict()).max(40).default([]),
    derivedFrom: z.object({ artifactId: z.string().min(1), version: z.number().int().positive() }).strict().nullable().default(null),
    storyIds: z.array(z.string().min(1)).max(20).default([]),
    /** Record entries the draft is about, e.g. project:club_page, so its claims can be compared with them. */
    recordRefs: z.array(z.string().regex(/^[a-z_]+:[a-z0-9_]+$/)).max(20).default([]),
    factLinks: z.array(FactLinkSchema).max(30).default([]),
  })
  .strict();
export type DraftInput = z.input<typeof DraftInputSchema>;

export interface AssistanceEvent {
  operation: AssistanceOperation;
  detail: string | null;
  destinations: DestinationRef[];
  /** When the help was given to an earlier artifact this one was copied from. */
  inheritedFrom: string | null;
}

export interface DraftArtifact {
  artifactId: string;
  tenantId: string;
  studentId: string;
  version: number;
  title: string;
  applicationId: string | null;
  cycle: string;
  destinations: DestinationRef[];
  fieldId: string;
  text: string;
  textHash: string;
  declaredProvenance: (typeof DECLARED_PROVENANCE)[number];
  assistance: AssistanceEvent[];
  derivedFrom: { artifactId: string; version: number } | null;
  storyIds: string[];
  recordRefs: string[];
  factLinks: FactLink[];
  /** Paused when the assistance already given is not cleared for a destination it now has (18T08). */
  status: 'active' | 'paused_for_policy';
  pauseReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredDisposition {
  fingerprint: string;
  disposition: Disposition;
  studentMeaning: string | null;
  at: string;
}

export class DraftRegistry implements DerivativeStore {
  readonly name = 'draft_registry';
  private readonly drafts = new Map<string, DraftArtifact[]>();
  private readonly dispositions = new Map<string, StoredDisposition>();
  private readonly listeners: Array<(e: { tenantId: string; studentId: string; artifactId: string; version: number }) => void> = [];

  constructor(private readonly now: () => string) {}

  onChange(l: (e: { tenantId: string; studentId: string; artifactId: string; version: number }) => void): void {
    this.listeners.push(l);
  }

  private key(t: string, s: string, id: string): string {
    return `${t}:${s}:${id}`;
  }

  put(tenantId: string, studentId: string, input: z.input<typeof DraftInputSchema>, extra: { status?: DraftArtifact['status']; pauseReason?: string | null } = {}): DraftArtifact {
    const d = DraftInputSchema.parse(input);
    const k = this.key(tenantId, studentId, d.artifactId);
    const history = this.drafts.get(k) ?? [];
    const prev = history.at(-1);
    // A copy carries its source's assistance history; later versions keep their own.
    let inherited: AssistanceEvent[] = [];
    if (d.derivedFrom && !prev) {
      const src = this.get(tenantId, studentId, d.derivedFrom.artifactId, d.derivedFrom.version);
      if (!src) throw new AccessDeniedError('not_found_or_denied', 'The source draft was not found');
      inherited = src.assistance.map((a) => ({ ...a, inheritedFrom: a.inheritedFrom ?? src.artifactId }));
    }
    const now = this.now();
    const a: DraftArtifact = {
      artifactId: d.artifactId,
      tenantId,
      studentId,
      version: (prev?.version ?? 0) + 1,
      title: d.title,
      applicationId: d.applicationId,
      cycle: d.cycle,
      destinations: d.destinations,
      fieldId: d.fieldId,
      text: d.text,
      textHash: sha256Hex(d.text),
      declaredProvenance: d.declaredProvenance,
      assistance: [...(prev?.assistance ?? inherited), ...d.assistance.map((x) => ({ operation: x.operation, detail: x.detail, destinations: d.destinations, inheritedFrom: null }))],
      derivedFrom: d.derivedFrom ?? prev?.derivedFrom ?? null,
      storyIds: d.storyIds,
      recordRefs: d.recordRefs,
      factLinks: d.factLinks,
      status: extra.status ?? prev?.status ?? 'active',
      pauseReason: extra.pauseReason ?? prev?.pauseReason ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    this.drafts.set(k, [...history, a]);
    if (prev) for (const l of this.listeners) l({ tenantId, studentId, artifactId: a.artifactId, version: a.version });
    return structuredClone(a);
  }

  setStatus(tenantId: string, studentId: string, artifactId: string, status: DraftArtifact['status'], reason: string | null, destinations?: DestinationRef[]): DraftArtifact | undefined {
    const cur = this.get(tenantId, studentId, artifactId);
    if (!cur) return undefined;
    const history = this.drafts.get(this.key(tenantId, studentId, artifactId))!;
    const next: DraftArtifact = { ...structuredClone(cur), version: cur.version + 1, status, pauseReason: reason, destinations: destinations ?? cur.destinations, updatedAt: this.now() };
    history.push(next);
    for (const l of this.listeners) l({ tenantId, studentId, artifactId, version: next.version });
    return structuredClone(next);
  }

  get(tenantId: string, studentId: string, artifactId: string, version?: number): DraftArtifact | undefined {
    const h = this.drafts.get(this.key(tenantId, studentId, artifactId));
    const a = version === undefined ? h?.at(-1) : h?.find((x) => x.version === version);
    return a ? structuredClone(a) : undefined;
  }

  list(tenantId: string, studentId: string, applicationId?: string | null): DraftArtifact[] {
    return [...this.drafts.entries()].filter(([k]) => k.startsWith(`${tenantId}:${studentId}:`)).map(([, h]) => structuredClone(h.at(-1)!)).filter((a) => applicationId === undefined || a.applicationId === applicationId);
  }

  dispose(tenantId: string, studentId: string, d: Omit<StoredDisposition, 'at'>): StoredDisposition {
    const s: StoredDisposition = { ...d, at: this.now() };
    this.dispositions.set(this.key(tenantId, studentId, d.fingerprint), s);
    return structuredClone(s);
  }

  dispositionsFor(tenantId: string, studentId: string): StoredDisposition[] {
    return [...this.dispositions.entries()].filter(([k]) => k.startsWith(`${tenantId}:${studentId}:`)).map(([, v]) => structuredClone(v));
  }

  purgeByDocument(): number {
    return 0;
  }

  purgeByClaims(): number {
    return 0;
  }

  purgeByStudent(tenantId: string, studentId: string): number {
    let n = 0;
    const prefix = `${tenantId}:${studentId}:`;
    for (const k of [...this.drafts.keys()]) {
      if (!k.startsWith(prefix)) continue;
      this.drafts.delete(k);
      n += 1;
    }
    for (const k of [...this.dispositions.keys()]) {
      if (!k.startsWith(prefix)) continue;
      this.dispositions.delete(k);
      n += 1;
    }
    return n;
  }
}

export function draftRef(artifactId: string, version?: number): string {
  return version === undefined ? `draft:${artifactId}` : `draft:${artifactId}@${version}`;
}

/**
 * Draft tools, under the writing-drafts permission. Writes accept only the
 * student's own drafts and decisions; nothing here can produce text.
 */
export function registerDraftTools(gateway: ToolGateway, registry: DraftRegistry, permissions: PermissionService): void {
  const check = (inv: ToolInvocation, access: 'read' | 'write') => {
    const d = permissions.authorize({ actor: inv.actor, tenantId: inv.tenantId, studentId: inv.studentId, category: 'writing_drafts', access, purpose: inv.purpose });
    if (!d.allowed) throw new AccessDeniedError('not_found_or_denied', 'Not found or not permitted');
  };
  gateway.register({
    name: 'drafts.registry',
    description: 'Register or read the student’s versioned drafts (with destinations, prompt field, declared provenance and assistance history), and record the student’s decisions about findings.',
    kind: 'write',
    args: z.discriminatedUnion('op', [
      z.object({ op: z.literal('put'), draft: z.custom<DraftInput>((v) => typeof v === 'object' && v !== null && 'artifactId' in v), status: z.enum(['active', 'paused_for_policy']).optional(), pauseReason: z.string().max(400).nullable().optional() }).strict(),
      z.object({ op: z.literal('get'), artifactId: z.string().min(1), version: z.number().int().positive().optional() }).strict(),
      z.object({ op: z.literal('list'), applicationId: z.string().nullable().optional() }).strict(),
      z.object({ op: z.literal('set_status'), artifactId: z.string().min(1), status: z.enum(['active', 'paused_for_policy']), reason: z.string().max(400).nullable(), destinations: z.array(DestinationRefSchema).max(20).optional() }).strict(),
      z.object({ op: z.literal('dispose'), fingerprint: z.string().min(1), disposition: z.enum(DISPOSITIONS), studentMeaning: z.string().max(600).nullable().default(null) }).strict(),
      z.object({ op: z.literal('dispositions') }).strict(),
    ]),
    handler: async (inv, args): Promise<unknown> => {
      const write = args.op === 'put' || args.op === 'set_status' || args.op === 'dispose';
      check(inv, write ? 'write' : 'read');
      if (write && args.op !== 'set_status' && inv.actor.kind !== 'student') throw new AccessDeniedError('not_found_or_denied', 'Only the student can add drafts or decide about findings');
      switch (args.op) {
        case 'put': {
          const extra: { status?: DraftArtifact['status']; pauseReason?: string | null } = {};
          if (args.status) extra.status = args.status;
          if (args.pauseReason !== undefined) extra.pauseReason = args.pauseReason;
          const a = registry.put(inv.tenantId, inv.studentId, args.draft, extra);
          inv.context.servedSourceIds.add(draftRef(a.artifactId, a.version));
          return a;
        }
        case 'get': {
          const a = registry.get(inv.tenantId, inv.studentId, args.artifactId, args.version);
          if (a) inv.context.servedSourceIds.add(draftRef(a.artifactId, a.version));
          return a ?? null;
        }
        case 'list': {
          const out = registry.list(inv.tenantId, inv.studentId, args.applicationId);
          for (const a of out) inv.context.servedSourceIds.add(draftRef(a.artifactId, a.version));
          return out;
        }
        case 'set_status': {
          const a = registry.setStatus(inv.tenantId, inv.studentId, args.artifactId, args.status, args.reason, args.destinations);
          if (a) inv.context.servedSourceIds.add(draftRef(a.artifactId, a.version));
          return a ?? null;
        }
        case 'dispose':
          return registry.dispose(inv.tenantId, inv.studentId, { fingerprint: args.fingerprint, disposition: args.disposition, studentMeaning: args.studentMeaning });
        case 'dispositions':
          return registry.dispositionsFor(inv.tenantId, inv.studentId);
        default:
          return null;
      }
    },
  });
}
