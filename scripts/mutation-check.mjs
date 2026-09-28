// Mutation check: disables one safeguard at a time and runs the tests that
// should notice. A safeguard whose removal no test detects is reported as a
// survivor. Cases live in scripts/mutations.json; a case whose `find` text no
// longer occurs exactly once is reported as stale so the list is kept current.
//
// Usage: npm run mutation [-- <case id> ...]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const { cases } = JSON.parse(readFileSync(new URL('./mutations.json', import.meta.url), 'utf8'));
const only = new Set(process.argv.slice(2));
const selected = only.size > 0 ? cases.filter((c) => only.has(c.id)) : cases;

let restore = null;
process.on('SIGINT', () => {
  restore?.();
  process.exit(130);
});

const survivors = [];
const stale = [];
for (const c of selected) {
  const original = readFileSync(c.file, 'utf8');
  const count = original.split(c.find).length - 1;
  if (count !== 1) {
    stale.push(c.id);
    console.log(`STALE    ${c.id}: pattern occurs ${count} times in ${c.file}`);
    continue;
  }
  restore = () => writeFileSync(c.file, original);
  writeFileSync(c.file, original.replace(c.find, () => c.replace));
  let detected;
  try {
    detected = spawnSync('npx', ['vitest', 'run', ...c.tests], { stdio: 'ignore' }).status !== 0;
  } finally {
    restore();
    restore = null;
  }
  const label = detected ? 'caught  ' : c.equivalent ? 'equiv.  ' : 'SURVIVED';
  console.log(`${label} ${c.id}: ${c.safeguard}`);
  if (!detected && !c.equivalent) survivors.push(c.id);
}
console.log(`\n${selected.length} cases, ${survivors.length} survivors${survivors.length ? `: ${survivors.join(', ')}` : ''}, ${stale.length} stale${stale.length ? `: ${stale.join(', ')}` : ''}`);
process.exit(survivors.length > 0 || stale.length > 0 ? 1 : 0);
