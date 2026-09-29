import { z } from 'zod';
import type { ToolGateway } from '../../runtime/tool-gateway.js';

/**
 * Governance for any future numerical admissions model (13 "Requirements for
 * any future numerical model").
 *
 * The first release is qualitative: no model produces a number for a
 * student. This registry exists so that a model can only ever be referenced
 * after its card passes the rules the specification sets: features available
 * at prediction time only (no post-decision leakage), related applications
 * grouped by student, temporal evaluation on a locked set, calibration
 * reported per subgroup with an abstention rule, no sensitive attribute
 * inferred from text, independent approval, and a retirement condition. A
 * withdrawn version stops being used at once, and every result that cited it
 * is made stale.
 */

export const FeatureSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9_]+$/),
    /** When the value exists relative to the decision. */
    availableAt: z.enum(['application_time', 'after_submission', 'post_decision']),
    provenance: z.enum(['student_record', 'institution_data', 'inferred_from_text', 'derived']),
    sensitive: z.boolean().default(false),
  })
  .strict();

export const SubgroupReportSchema = z
  .object({
    name: z.string().min(1),
    /** How the subgroup is recognised for a student, e.g. applicantCategory=first_year_international. */
    match: z.object({ applicantCategory: z.string().optional(), qualificationSystem: z.string().optional() }).strict(),
    n: z.number().int().nonnegative(),
    calibrationSlope: z.number(),
    calibrationIntercept: z.number(),
  })
  .strict();

export const ModelCardSchema = z
  .object({
    modelId: z.string().regex(/^[a-z0-9_]+$/),
    version: z.number().int().positive(),
    target: z.string().min(1),
    predictionTime: z.enum(['application_time']),
    supportedPopulation: z.object({ institutions: z.array(z.string()).min(1), applicantCategories: z.array(z.string()).min(1) }).strict(),
    dataRights: z.string().min(1),
    features: z.array(FeatureSchema).min(1),
    /** How rows from one student were kept together in training and evaluation. */
    splitGrouping: z.enum(['by_student', 'by_application', 'random']),
    evaluation: z
      .object({
        temporal: z.boolean(),
        lockedEvaluationSet: z.boolean(),
        brier: z.number().nullable(),
        logLoss: z.number().nullable(),
        overallCalibrationSlope: z.number().nullable(),
        subgroups: z.array(SubgroupReportSchema),
      })
      .strict(),
    retirementCondition: z.string().min(1),
    approvedBy: z.string().nullable(),
  })
  .strict();
export type ModelCard = z.infer<typeof ModelCardSchema>;

/** Minimum subgroup size, and the calibration-slope band outside which the model must abstain for that subgroup. */
export const MIN_SUBGROUP_N = 200;
export const SLOPE_BAND = [0.8, 1.2] as const;

export interface CardReview {
  approvable: boolean;
  issues: string[];
  /** Subgroups for which the model must abstain. */
  abstain: string[];
}

export function reviewModelCard(card: ModelCard): CardReview {
  const issues: string[] = [];
  const leaked = card.features.filter((f) => f.availableAt !== 'application_time');
  if (leaked.length > 0) issues.push(`features not available when the student applies would leak the outcome: ${leaked.map((f) => f.name).join(', ')} (13T10)`);
  if (card.splitGrouping !== 'by_student') issues.push('rows from the same student must be grouped when splitting training and evaluation data (13T11)');
  const inferred = card.features.filter((f) => f.sensitive && f.provenance === 'inferred_from_text');
  if (inferred.length > 0) issues.push(`sensitive attributes inferred from text may not be prediction inputs: ${inferred.map((f) => f.name).join(', ')} (13T16)`);
  if (!card.evaluation.temporal) issues.push('evaluation must be temporal, across admissions cycles');
  if (!card.evaluation.lockedEvaluationSet) issues.push('a locked evaluation set separate from tuning and calibration is required');
  if (card.evaluation.brier === null || card.evaluation.logLoss === null || card.evaluation.overallCalibrationSlope === null) issues.push('Brier score, log loss and calibration must all be reported');
  if (card.evaluation.subgroups.length === 0) issues.push('subgroup performance must be reported');
  if (!card.approvedBy) issues.push('the model needs independent approval');
  const abstain = card.evaluation.subgroups.filter((g) => g.n < MIN_SUBGROUP_N || g.calibrationSlope < SLOPE_BAND[0] || g.calibrationSlope > SLOPE_BAND[1]).map((g) => g.name);
  return { approvable: issues.length === 0, issues, abstain };
}

export type ModelStatus = 'approved' | 'rejected' | 'withdrawn';

export interface RegisteredModel {
  card: ModelCard;
  status: ModelStatus;
  review: CardReview;
  withdrawnReason: string | null;
}

export function modelRef(modelId: string, version: number): string {
  return `model:${modelId}@${version}`;
}

export class NumericModelRegistry {
  private readonly models = new Map<string, RegisteredModel>();
  private readonly listeners: Array<(c: { ref: string; reason: string }) => void> = [];

  onWithdraw(l: (c: { ref: string; reason: string }) => void): void {
    this.listeners.push(l);
  }

  /** A card that fails review is stored as rejected, never usable. */
  register(input: z.input<typeof ModelCardSchema>): RegisteredModel {
    const card = ModelCardSchema.parse(input);
    const review = reviewModelCard(card);
    const m: RegisteredModel = { card, status: review.approvable ? 'approved' : 'rejected', review, withdrawnReason: null };
    this.models.set(modelRef(card.modelId, card.version), m);
    return structuredClone(m);
  }

  withdraw(modelId: string, version: number, reason: string): boolean {
    const ref = modelRef(modelId, version);
    const m = this.models.get(ref);
    if (!m || m.status === 'withdrawn') return false;
    m.status = 'withdrawn';
    m.withdrawnReason = reason;
    for (const l of this.listeners) l({ ref, reason });
    return true;
  }

  list(): RegisteredModel[] {
    return [...this.models.values()].map((m) => structuredClone(m));
  }
}

export function registerModelTools(gateway: ToolGateway, registry: NumericModelRegistry): void {
  gateway.register({
    name: 'models.read_registry',
    description: 'Read the governed registry of numerical admissions models: cards, review results, abstention subgroups and status.',
    kind: 'read',
    args: z.object({ institutionId: z.string().min(1).optional() }).strict(),
    handler: async (inv, args): Promise<RegisteredModel[]> => {
      const out = registry.list().filter((m) => !args.institutionId || m.card.supportedPopulation.institutions.includes(args.institutionId));
      for (const m of out) inv.context.servedSourceIds.add(modelRef(m.card.modelId, m.card.version));
      return out;
    },
  });
}
