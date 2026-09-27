import { z } from 'zod';

/**
 * Structured outputs accept a subset of JSON Schema. In particular
 * `additionalProperties` other than `false` is not supported (a `z.record`
 * would silently become an always-empty object) and every node must have a
 * type. Model-facing schemas are checked with this function in the test suite
 * so that an unsupported construct fails loudly during development.
 */
export function modelSchemaProblems(schema: z.ZodType): string[] {
  let json: unknown;
  try {
    json = z.toJSONSchema(schema, { reused: 'ref' });
  } catch (e) {
    return [`schema cannot be converted to JSON Schema: ${e instanceof Error ? e.message : String(e)}`];
  }
  const problems: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    const hasType = 'type' in n || 'anyOf' in n || 'oneOf' in n || 'allOf' in n || '$ref' in n || 'const' in n || 'enum' in n;
    if (!hasType && path !== '$defs') problems.push(`${path || '<root>'}: node without a type (z.unknown/z.any are not allowed in model schemas)`);
    if (n['type'] === 'object') {
      const ap = n['additionalProperties'];
      if (ap !== undefined && ap !== false) problems.push(`${path || '<root>'}: object with additionalProperties (z.record is not supported in model schemas)`);
      if (!n['properties'] || Object.keys(n['properties'] as object).length === 0) problems.push(`${path || '<root>'}: object without properties`);
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === 'properties' && v && typeof v === 'object') {
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) walk(pv, `${path}.${pk}`);
      } else if (k === '$defs' && v && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) walk(dv, `$defs.${dk}`);
      } else if ((k === 'items' || k === 'additionalProperties') && v && typeof v === 'object') {
        walk(v, `${path}[]`);
      } else if ((k === 'anyOf' || k === 'oneOf' || k === 'allOf') && Array.isArray(v)) {
        v.forEach((x, i) => walk(x, `${path}|${i}`));
      }
    }
  };
  walk(json, '');
  return problems;
}
