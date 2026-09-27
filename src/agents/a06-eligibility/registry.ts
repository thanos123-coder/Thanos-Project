import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';
import { ValidationError } from '../../shared/errors.js';
import { RulePackageSchema, packageStructureIssues, packageVersionRef, type RulePackage, type RulePackageInput } from './rules.js';

/**
 * Versioned rule packages, reused across students ("Compile verified public
 * rules into reusable versioned packages"). A lookup for a cycle that has no
 * published package never falls back to the previous cycle; the previous cycle
 * is returned only as labelled historical context (06R03, 06T11).
 */

export type RuleLookup =
  | { status: 'found'; package: RulePackage }
  | { status: 'not_reviewed'; package: RulePackage }
  | { status: 'cycle_not_published'; historical: RulePackage[] }
  | { status: 'not_covered' };

export interface RuleLookupQuery {
  institutionRef: string;
  programRef: string;
  degreeLevel: RulePackage['degreeLevel'];
  entryCycle: string;
  campusRef?: string | null;
}

export type RulePackageListener = (change: { packageRef: string; previousRef: string | null; institutionRef: string; programRef: string; entryCycle: string }) => void;

export class RulePackageRegistry {
  private readonly versions = new Map<string, RulePackage[]>();
  private readonly listeners: RulePackageListener[] = [];

  onChange(l: RulePackageListener): void {
    this.listeners.push(l);
  }

  /** Add a new package or a new version of an existing package. */
  add(input: RulePackageInput): RulePackage {
    const pkg = RulePackageSchema.parse(input);
    const issues = packageStructureIssues(pkg);
    if (issues.length > 0) throw new ValidationError('Invalid rule package', issues);
    const existing = this.versions.get(pkg.id) ?? [];
    if (existing.some((p) => p.version === pkg.version)) throw new ValidationError(`Rule package ${pkg.id} version ${pkg.version} already exists`);
    const previous = existing[existing.length - 1];
    this.versions.set(pkg.id, [...existing, pkg]);
    for (const l of this.listeners) l({ packageRef: packageVersionRef(pkg), previousRef: previous ? packageVersionRef(previous) : null, institutionRef: pkg.institutionRef, programRef: pkg.programRef, entryCycle: pkg.entryCycle });
    return structuredClone(pkg);
  }

  latest(id: string): RulePackage | undefined {
    const v = this.versions.get(id);
    return v && v.length > 0 ? structuredClone(v[v.length - 1]!) : undefined;
  }

  find(q: RuleLookupQuery): RuleLookup {
    const latest = [...this.versions.values()]
      .map((v) => v[v.length - 1]!)
      .filter((p) => p.institutionRef === q.institutionRef && p.programRef === q.programRef && p.degreeLevel === q.degreeLevel && p.reviewStatus !== 'retired')
      .filter((p) => p.campusRef === null || q.campusRef === undefined || q.campusRef === null || p.campusRef === q.campusRef);
    if (latest.length === 0) return { status: 'not_covered' };
    const exact = latest.filter((p) => p.entryCycle === q.entryCycle);
    // Prefer a campus-specific package when the query names a campus.
    const chosen = exact.find((p) => q.campusRef && p.campusRef === q.campusRef) ?? exact[0];
    if (chosen) return chosen.reviewStatus === 'reviewed' ? { status: 'found', package: structuredClone(chosen) } : { status: 'not_reviewed', package: structuredClone(chosen) };
    return { status: 'cycle_not_published', historical: latest.sort((a, b) => b.entryCycle.localeCompare(a.entryCycle)).map((p) => structuredClone(p)) };
  }

  all(): RulePackage[] {
    return [...this.versions.values()].map((v) => structuredClone(v[v.length - 1]!));
  }
}

export function registerRuleTools(gateway: ToolGateway, registry: RulePackageRegistry): void {
  gateway.register({
    name: 'rules.read_verified',
    description: 'Look up the versioned rule package for an exact institution, program, degree level and entry cycle.',
    kind: 'read',
    args: z
      .object({
        institutionRef: z.string().min(1),
        programRef: z.string().min(1),
        degreeLevel: z.enum(['undergraduate_first_degree', 'foundation', 'associate', 'graduate', 'other']),
        entryCycle: z.string().min(4),
        campusRef: z.string().nullable().optional(),
      })
      .strict(),
    handler: async (inv, args): Promise<RuleLookup> => {
      const q: RuleLookupQuery = { institutionRef: args.institutionRef, programRef: args.programRef, degreeLevel: args.degreeLevel, entryCycle: args.entryCycle };
      if (args.campusRef !== undefined) q.campusRef = args.campusRef;
      const r = registry.find(q);
      if (r.status === 'found' || r.status === 'not_reviewed') for (const s of r.package.sources) inv.context.servedSourceIds.add(s.id);
      return r;
    },
  });
}
