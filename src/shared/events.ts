import { z } from 'zod';

/**
 * Shared event contract (spec, Implementation contracts). Events carry
 * references, never sensitive payloads; consumers retrieve the authorized
 * current view when they run, so a permission change takes effect even for an
 * event created earlier.
 */

export const EVENT_TYPES = [
  'student_fact.changed',
  'student_fact.deleted',
  'conflict.opened',
  'conflict.resolved',
  'derived_artifact.invalidated',
  'derived_artifact.deleted',
  'permission.granted',
  'permission.revoked',
  'document.deleted',
  'deletion.completed',
  'rule_package.changed',
  'source.changed',
  'opportunity.changed',
  'task.cancelled',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DomainEventSchema = z
  .object({
    eventId: z.string().min(1),
    type: z.enum(EVENT_TYPES),
    tenantId: z.string().min(1),
    /** Absent for shared public events (rule packages, sources, opportunities). */
    studentId: z.string().optional(),
    entityRef: z.string().optional(),
    oldVersion: z.number().int().nonnegative().optional(),
    newVersion: z.number().int().nonnegative().optional(),
    /** Field keys (not values) that changed. */
    changedFields: z.array(z.string()).default([]),
    recordVersion: z.number().int().nonnegative().optional(),
    causeRef: z.string().min(1),
    occurredAt: z.string().min(1),
    /** Always false: sensitive payloads never travel in events. */
    sensitivePayloadIncluded: z.literal(false),
  })
  .strict();
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventInput = z.input<typeof DomainEventSchema>;
