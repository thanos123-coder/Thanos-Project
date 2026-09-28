import { z } from 'zod';

/**
 * Entity resolution and coverage (11 "Entity resolution and coverage").
 *
 * "Maintain stable IDs for institution, campus, administrative school,
 * program, degree, delivery mode, and entry route. Store common aliases
 * separately. An institution name alone is not a reliable join key."
 * "Use a coverage register for supported destinations. Record which categories
 * of claims are maintained, the relevant official domains, the last review,
 * and known gaps."
 */

/** A platform (Common App, UCAS) owns its own formats and procedures; each institution controls its additional requirements (11 "Source selection"). */
export const ENTITY_KINDS = ['institution', 'platform', 'campus', 'school', 'program', 'route'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const EntityIdSchema = z.string().regex(/^[a-z0-9_]+$/).max(120);

export const InstitutionEntitySchema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum(ENTITY_KINDS),
    name: z.string().min(1).max(200),
    /** Common alternative names, stored separately from the official name. */
    aliases: z.array(z.string().min(1).max(200)).max(20).default([]),
    /** The entity this one belongs to: a campus or school to its institution, a program to its campus or school. */
    parentId: EntityIdSchema.nullable(),
    country: z.string().regex(/^[A-Z]{2}$/),
    /** Institutions only: the domains whose pages can speak for the institution. */
    officialDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(20).default([]),
    attributes: z
      .object({
        degree: z.string().max(80).optional(),
        deliveryMode: z.enum(['in_person', 'online', 'hybrid']).optional(),
        jurisdiction: z.string().max(80).optional(),
        /** Institutions: public or private control, which some round restrictions depend on (14 "Round rules"). */
        control: z.enum(['public', 'private', 'unknown']).optional(),
        /** Programs: how entry to the field happens (11 "Worked example"). */
        accessRoute: z.enum(['direct_entry', 'later_competitive_selection', 'open_after_prerequisites', 'unknown']).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type InstitutionEntity = z.infer<typeof InstitutionEntitySchema>;
export type InstitutionEntityInput = z.input<typeof InstitutionEntitySchema>;

/** Offices that control different kinds of facts (11 "Claim level evidence procedure", step 2). */
export const OFFICES = ['admissions', 'financial_aid', 'registrar', 'department', 'scholarship_office', 'housing', 'application_platform', 'external_provider', 'government'] as const;
export type Office = (typeof OFFICES)[number];

export const OfficialPageSchema = z
  .object({
    pageId: z.string().regex(/^[a-z0-9_]+$/),
    entityId: EntityIdSchema,
    office: z.enum(OFFICES),
    url: z.string().url(),
    /** Predicate families the page is expected to answer. */
    covers: z.array(z.string().regex(/^[a-z_]+$/)).min(1),
    /** Applicant categories the page addresses, when the page itself says (a "first-year applicants" page). */
    categories: z.array(z.string().regex(/^[a-z_]+$/)).default(['all']),
  })
  .strict();
export type OfficialPage = z.infer<typeof OfficialPageSchema>;

export const CoverageEntrySchema = z
  .object({
    institutionId: EntityIdSchema,
    status: z.enum(['maintained', 'exploratory']),
    /** Predicate families the maintaining team keeps current for this destination. */
    maintained: z.array(z.string().regex(/^[a-z_]+$/)),
    lastReviewedAt: z.string().nullable(),
    knownGaps: z.array(z.string().min(1)).default([]),
    maintainedBy: z.string().min(1),
  })
  .strict();
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

export type Resolution =
  | { status: 'resolved'; entity: InstitutionEntity; institution: InstitutionEntity; campus: InstitutionEntity | null; program: InstitutionEntity | null }
  | { status: 'needs_campus'; institution: InstitutionEntity; candidates: InstitutionEntity[]; question: string }
  | { status: 'ambiguous'; candidates: InstitutionEntity[]; question: string }
  | { status: 'unknown'; question: string };

function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export class InstitutionRegistry {
  private readonly entities = new Map<string, InstitutionEntity>();
  private readonly pages = new Map<string, OfficialPage>();
  private readonly coverage = new Map<string, CoverageEntry>();

  add(input: InstitutionEntityInput): InstitutionEntity {
    const e = InstitutionEntitySchema.parse(input);
    if (this.entities.has(e.id)) throw new Error(`Entity ${e.id} already exists; ids are never reused`);
    if (e.parentId !== null && !this.entities.has(e.parentId)) throw new Error(`Unknown parent ${e.parentId}`);
    const topLevel = e.kind === 'institution' || e.kind === 'platform';
    if (topLevel && e.parentId !== null) throw new Error(`A ${e.kind} has no parent`);
    if (!topLevel && e.parentId === null) throw new Error(`A ${e.kind} must belong to an institution, campus or school`);
    this.entities.set(e.id, e);
    return structuredClone(e);
  }

  addPage(input: z.input<typeof OfficialPageSchema>): OfficialPage {
    const p = OfficialPageSchema.parse(input);
    const owner = this.get(p.entityId);
    if (!owner) throw new Error(`Unknown entity ${p.entityId}`);
    if (p.office !== 'application_platform' && p.office !== 'external_provider' && p.office !== 'government' && !this.isOfficialUrl(p.entityId, p.url)) {
      throw new Error(`${p.url} is not on an official domain of ${this.institutionOf(p.entityId)?.name ?? p.entityId}`);
    }
    this.pages.set(p.pageId, p);
    return structuredClone(p);
  }

  setCoverage(input: z.input<typeof CoverageEntrySchema>): CoverageEntry {
    const c = CoverageEntrySchema.parse(input);
    if (!this.get(c.institutionId)) throw new Error(`Unknown institution ${c.institutionId}`);
    this.coverage.set(c.institutionId, c);
    return structuredClone(c);
  }

  get(id: string): InstitutionEntity | undefined {
    const e = this.entities.get(id);
    return e ? structuredClone(e) : undefined;
  }

  children(id: string, kind?: EntityKind): InstitutionEntity[] {
    return [...this.entities.values()].filter((e) => e.parentId === id && (kind === undefined || e.kind === kind)).map((e) => structuredClone(e));
  }

  /** The chain from an entity up to its institution, nearest first. */
  lineage(id: string): InstitutionEntity[] {
    const out: InstitutionEntity[] = [];
    let cur = this.entities.get(id);
    while (cur) {
      out.push(structuredClone(cur));
      cur = cur.parentId ? this.entities.get(cur.parentId) : undefined;
    }
    return out;
  }

  /** The top-level owner: an institution, or the platform itself. */
  institutionOf(id: string): InstitutionEntity | undefined {
    return this.lineage(id).find((e) => e.kind === 'institution' || e.kind === 'platform');
  }

  campusOf(id: string): InstitutionEntity | undefined {
    return this.lineage(id).find((e) => e.kind === 'campus');
  }

  coverageFor(institutionId: string): CoverageEntry | undefined {
    const c = this.coverage.get(institutionId);
    return c ? structuredClone(c) : undefined;
  }

  pagesFor(entityId: string): OfficialPage[] {
    const ids = new Set(this.lineage(entityId).map((e) => e.id));
    return [...this.pages.values()].filter((p) => ids.has(p.entityId)).map((p) => structuredClone(p));
  }

  /** A page speaks for an institution only when its host is one of the institution's official domains (or a subdomain). */
  isOfficialUrl(entityId: string, url: string): boolean {
    const inst = this.institutionOf(entityId);
    if (!inst) return false;
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return inst.officialDomains.some((d) => host === d || host.endsWith(`.${d}`));
  }

  /**
   * Resolve a name, alias or id. A multi-campus institution needs a campus
   * before campus-scoped rules can apply (11T01); several institutions sharing a
   * name need the student to say which one.
   */
  resolve(input: { institution: string; campus?: string | null; program?: string | null }): Resolution {
    const byId = this.entities.get(input.institution);
    const matches = byId && byId.kind === 'institution' ? [byId] : this.findByName(input.institution, 'institution');
    if (matches.length === 0) return { status: 'unknown', question: `Which institution do you mean by “${input.institution}”? It is not in the researched catalog yet.` };
    if (matches.length > 1) return { status: 'ambiguous', candidates: matches.map((m) => structuredClone(m)), question: `Several institutions match “${input.institution}”: ${matches.map((m) => `${m.name} (${m.country})`).join('; ')}. Which one do you mean?` };
    const institution = structuredClone(matches[0]!);
    const campuses = this.children(institution.id, 'campus');
    let campus: InstitutionEntity | null = null;
    if (input.campus) {
      const c = this.entities.get(input.campus) ?? campuses.find((x) => norm(x.name) === norm(input.campus!) || x.aliases.some((a) => norm(a) === norm(input.campus!)));
      if (!c || this.institutionOf(c.id)?.id !== institution.id) return { status: 'needs_campus', institution, candidates: campuses, question: `${institution.name} has no campus called “${input.campus}”. Which campus do you mean: ${campuses.map((x) => x.name).join(', ')}?` };
      campus = structuredClone(c);
    }
    let program: InstitutionEntity | null = null;
    if (input.program) {
      const wanted = norm(input.program);
      // Programs of this institution with that id, name or alias; a named campus narrows them to that campus (or to programs no campus owns).
      const candidates = [...this.entities.values()].filter(
        (e) =>
          e.kind === 'program' &&
          (e.id === input.program || norm(e.name) === wanted || e.aliases.some((a) => norm(a) === wanted)) &&
          this.institutionOf(e.id)?.id === institution.id &&
          (!campus || (this.campusOf(e.id)?.id ?? null) === campus.id || this.campusOf(e.id) === undefined),
      );
      const distinctCampuses = new Set(candidates.map((p) => this.campusOf(p.id)?.id ?? 'none'));
      if (candidates.length > 1 && distinctCampuses.size > 1) {
        return { status: 'needs_campus', institution, candidates: campuses.filter((c) => distinctCampuses.has(c.id)), question: `${institution.name} offers ${input.program} at more than one campus, with different rules or costs. Which campus do you mean?` };
      }
      if (candidates.length > 1) {
        // Programs with similar names may have different degrees or admissions offices.
        return { status: 'ambiguous', candidates: candidates.map((c) => structuredClone(c)), question: `${institution.name} has more than one program called ${input.program}: ${candidates.map((c) => `${c.name}${c.attributes.degree ? ` (${c.attributes.degree})` : ''}`).join('; ')}. Which one do you mean?` };
      }
      if (candidates.length === 0) return { status: 'unknown', question: `${institution.name} has no program called “${input.program}” in the researched catalog yet. Which program do you mean?` };
      program = structuredClone(candidates[0]!);
      if (!campus) campus = this.campusOf(program.id) ?? null;
    }
    // Campus-scoped rules cannot be applied until the campus is known when the institution has several (11T01).
    if (!campus && campuses.length > 1) return { status: 'needs_campus', institution, candidates: campuses, question: `${institution.name} has ${campuses.length} campuses (${campuses.map((c) => c.name).join(', ')}) with different rules or costs. Which campus are you considering?` };
    if (!campus && campuses.length === 1) campus = campuses[0]!;
    const entity = program ?? campus ?? institution;
    return { status: 'resolved', entity, institution, campus, program };
  }

  /** Every program (or institution without programs) in scope, with its lineage names: the candidate pool, never ordered by fame. */
  catalog(filter: { countries?: readonly string[] } = {}): Array<{ entity: InstitutionEntity; institution: InstitutionEntity; campus: InstitutionEntity | null; coverage: CoverageEntry | null }> {
    const out: Array<{ entity: InstitutionEntity; institution: InstitutionEntity; campus: InstitutionEntity | null; coverage: CoverageEntry | null }> = [];
    for (const e of this.entities.values()) {
      const inst = this.institutionOf(e.id);
      if (!inst || inst.kind !== 'institution') continue;
      if (filter.countries && !filter.countries.includes(inst.country)) continue;
      const hasPrograms = [...this.entities.values()].some((x) => x.kind === 'program' && this.institutionOf(x.id)?.id === inst.id);
      if (e.kind === 'program' || (e.kind === 'institution' && !hasPrograms)) out.push({ entity: structuredClone(e), institution: structuredClone(inst), campus: this.campusOf(e.id) ?? null, coverage: this.coverageFor(inst.id) ?? null });
    }
    return out.sort((a, b) => a.entity.id.localeCompare(b.entity.id));
  }

  private findByName(name: string, kind: EntityKind): InstitutionEntity[] {
    const n = norm(name);
    return [...this.entities.values()].filter((e) => e.kind === kind && (norm(e.name) === n || e.aliases.some((a) => norm(a) === n)));
  }
}
