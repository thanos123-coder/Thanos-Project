import { claimRef, type RoundRuleValue } from '../a11-research/claims.js';

/**
 * The round constraint engine (14 "Round rules as a constraint system").
 *
 * Each proposed application carries its institution's verified round rule.
 * The engine classifies every application into the categories rules restrict
 * (a private early action, a binding round, a foreign early round, …) and
 * checks every ordered pair in the whole set: an institution's restriction
 * applies to everything else the student proposes, whatever the other
 * institution's own rule says. An exception counts only with evidence that
 * the exact condition holds; an outcome-dependent round becomes available
 * only after that outcome is confirmed.
 */

export interface ProposedApplication {
  optionRef: string;
  institutionId: string;
  institutionName: string;
  country: string;
  control: 'public' | 'private' | 'unknown';
  round: string;
  rule: (RoundRuleValue & { claimId: string; status: string; retrievedAt: string }) | null;
  /** Exceptions the student claims, with the evidence offered for each. */
  exceptionEvidence: Array<{ condition: string; verified: boolean; detail: string }>;
}

export type Target = RoundRuleValue['restrictions'][number]['target'];

export function targetsOf(a: ProposedApplication, relativeTo: ProposedApplication): Set<Target> {
  const t = new Set<Target>();
  const kind = a.rule?.kind ?? (a.round.includes('early_decision') ? 'early_decision' : a.round.includes('restrictive') ? 'restrictive_early_action' : a.round.includes('early_action') ? 'early_action' : a.round === 'rolling' ? 'rolling' : 'regular');
  const early = kind === 'early_action' || kind === 'restrictive_early_action' || kind === 'early_decision';
  if (kind === 'early_action') {
    t.add('any_early_action');
    if (a.control === 'public') t.add('public_early_action');
    else t.add('private_early_action');
  }
  if (kind === 'restrictive_early_action') {
    t.add('restrictive_early_action');
    t.add('any_early_action');
    if (a.control !== 'public') t.add('private_early_action');
  }
  if (kind === 'early_decision') {
    t.add('early_decision');
    t.add('binding_round');
  }
  if (a.rule?.binding) t.add('binding_round');
  if (kind === 'rolling') t.add('rolling_admission');
  if (early && a.country !== relativeTo.country) t.add('foreign_early_round');
  return t;
}

export interface RoundConflict {
  restricting: string;
  restricted: string;
  target: Target;
  rule: string;
  sourceRef: string | null;
  /** An exception that would resolve the conflict if its evidence were confirmed. */
  pendingException: string | null;
}

export interface RoundCheck {
  conflicts: RoundConflict[];
  /** Exceptions that applied, with the evidence that established them. */
  exceptionsApplied: Array<{ restricting: string; restricted: string; condition: string; detail: string }>;
  /** Applications whose round rule is missing or not verified: the check is incomplete for them. */
  unverifiedRules: string[];
}

/**
 * Evaluate the full proposed set. Every application's restrictions are
 * applied to every other application (14T01). An exception applies only when
 * its exact condition holds: an institution's type or country can be
 * checked from the registry; a scholarship requirement needs evidence from
 * the scholarship record (14T02); anything else needs confirmation.
 */
export function checkRounds(apps: readonly ProposedApplication[]): RoundCheck {
  const conflicts: RoundConflict[] = [];
  const exceptionsApplied: RoundCheck['exceptionsApplied'] = [];
  const unverifiedRules = apps.filter((a) => !a.rule || a.rule.status !== 'verified').map((a) => a.optionRef);
  for (const a of apps) {
    if (!a.rule) continue;
    for (const b of apps) {
      if (a === b || a.institutionId === b.institutionId) continue;
      const bt = targetsOf(b, a);
      for (const r of a.rule.restrictions) {
        if (!bt.has(r.target)) continue;
        let resolved = false;
        let pending: string | null = null;
        for (const ex of r.exceptions) {
          if (ex.condition === 'public_institution' && b.control === 'public') {
            exceptionsApplied.push({ restricting: a.optionRef, restricted: b.optionRef, condition: ex.condition, detail: `${b.institutionName} is a public institution: “${ex.text}”` });
            resolved = true;
          } else if (ex.condition === 'foreign_institution' && b.country !== a.country) {
            exceptionsApplied.push({ restricting: a.optionRef, restricted: b.optionRef, condition: ex.condition, detail: `${b.institutionName} is outside ${a.country}: “${ex.text}”` });
            resolved = true;
          } else if (ex.condition === 'nonbinding_rolling' && b.rule?.kind === 'rolling' && !b.rule.binding) {
            exceptionsApplied.push({ restricting: a.optionRef, restricted: b.optionRef, condition: ex.condition, detail: `${b.institutionName} uses non-binding rolling admission: “${ex.text}”` });
            resolved = true;
          } else if (ex.condition === 'scholarship_requires_early' || ex.condition === 'other') {
            const ev = b.exceptionEvidence.find((e) => e.condition === ex.condition);
            if (ev?.verified) {
              exceptionsApplied.push({ restricting: a.optionRef, restricted: b.optionRef, condition: ex.condition, detail: `${ev.detail} (“${ex.text}”)` });
              resolved = true;
            } else pending = `“${ex.text}” could allow this, but ${ev ? ev.detail : 'no evidence has been given that it applies'}.`;
          }
          if (resolved) break;
        }
        if (!resolved) conflicts.push({ restricting: a.optionRef, restricted: b.optionRef, target: r.target, rule: a.rule.text, sourceRef: claimRef(a.rule.claimId), pendingException: pending });
      }
    }
  }
  return { conflicts, exceptionsApplied, unverifiedRules };
}
