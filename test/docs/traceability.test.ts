import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Keeps docs/TRACEABILITY.md honest: every requirement it lists must still be
 * cited in the code files named for it, and every acceptance case must still
 * have a test whose title names the case.
 */
const doc = readFileSync('docs/TRACEABILITY.md', 'utf8');
const rows = doc.split('\n').filter((l) => /^\| (0[1-9][RT]\d\d|XT\d\d) \|/.test(l));

describe('Traceability matrix', () => {
  it('lists all 103 requirements and 164 acceptance cases', () => {
    expect(rows.filter((r) => /^\| 0[1-9]R/.test(r))).toHaveLength(103);
    expect(rows.filter((r) => /^\| (0[1-9]T|XT)/.test(r))).toHaveLength(164);
  });

  it('every requirement is still cited where the matrix says it is implemented', () => {
    for (const row of rows.filter((r) => /^\| 0[1-9]R/.test(r))) {
      const id = /^\| (\S+) /.exec(row)![1]!;
      const files = [...row.matchAll(/`([^`]+\.ts)`/g)].map((m) => m[1]!);
      expect(files.length, `${id} has no implementing file`).toBeGreaterThan(0);
      for (const f of files) {
        expect(existsSync(f), `${f} (for ${id}) is missing`).toBe(true);
        expect(readFileSync(f, 'utf8').includes(id), `${f} no longer cites ${id}`).toBe(true);
      }
    }
  });

  it('every acceptance case still has a named test', () => {
    for (const row of rows.filter((r) => /^\| (0[1-9]T|XT)/.test(r))) {
      const id = /^\| (\S+) /.exec(row)![1]!;
      const files = [...row.matchAll(/`(test\/[^`]+\.test\.ts)`/g)].map((m) => m[1]!);
      expect(files.length, `${id} has no test`).toBeGreaterThan(0);
      for (const f of files) {
        const titles = [...readFileSync(f, 'utf8').matchAll(/\bit\((['"`])(.*?)\1/g)].map((m) => m[2]!);
        expect(titles.some((t) => t.includes(id)), `${f} has no test titled with ${id}`).toBe(true);
      }
    }
  });
});

/** The volume-two matrix: 162 role cases and 18 cross-agent cases, each with a test titled with its ID. */
const docV2 = readFileSync('docs/TRACEABILITY-V2.md', 'utf8');
const rowsV2 = docV2.split('\n').filter((l) => /^\| (1[0-8]T\d\d|XT\d\d) \|/.test(l));

describe('Traceability matrix, volume two', () => {
  it('lists all 180 acceptance cases, each once', () => {
    const ids = rowsV2.map((r) => /^\| (\S+) /.exec(r)![1]!);
    expect(ids.filter((i) => /^1[0-8]T/.test(i))).toHaveLength(162);
    expect(ids.filter((i) => /^XT/.test(i))).toHaveLength(18);
    expect(new Set(ids).size).toBe(180);
  });

  it('every case still has a named test, and cross-agent cases are tested against the whole system', () => {
    for (const row of rowsV2) {
      const id = /^\| (\S+) /.exec(row)![1]!;
      const files = [...row.matchAll(/`(test\/[^`]+\.test\.ts)`/g)].map((m) => m[1]!);
      expect(files.length, `${id} has no test`).toBeGreaterThan(0);
      if (id.startsWith('XT')) expect(files.every((f) => f === 'test/system/cross-agent-v2.test.ts'), `${id} must be tested in the volume-two cross-agent suite`).toBe(true);
      for (const f of files) {
        const titles = [...readFileSync(f, 'utf8').matchAll(/\bit\((['"`])(.*?)\1/g)].map((m) => m[2]!);
        expect(titles.some((t) => t.includes(id)), `${f} has no test titled with ${id}`).toBe(true);
      }
    }
  });

  it('every implementing module named for an agent exists', () => {
    for (const m of docV2.matchAll(/`(src\/[^`]+\.ts)`/g)) expect(existsSync(m[1]!), `${m[1]} is missing`).toBe(true);
  });
});
