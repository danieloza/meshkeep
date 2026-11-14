// Parity of the application's passage choice with the simulation's "files,
// then passages" (ADR 0001, section 7, row B):
//
//   node scripts/eval-context-parity.mjs <set> [<run name>, default step-b]
//
// Reads what the application sent, per question and file, from a run of
// `npm run eval:context -- <set> --out <run name>`, and what the simulation
// chooses from `simulation-passages.json` (written by
// `scripts/eval-context-chunks.mjs`). Prints one row per file that either side
// sent by passages, and exits non-zero when any row differs, so a difference
// is always looked at and explained.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [setName, runName = 'step-b'] = process.argv.slice(2);
if (!setName) {
  console.error('Usage: node scripts/eval-context-parity.mjs <set> [<run name>]');
  process.exit(2);
}
const SET = fileURLToPath(new URL(`../eval/context/sets/${setName}/`, import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(SET, name), 'utf8'));
const run = read(`${runName}.json`);
const simulation = read('simulation-passages.json');

const describe = (entry) => (!entry ? 'not sent' : entry.whole ? 'whole' : entry.ordinals ? `[${entry.ordinals.join(', ')}]` : entry.status);
const rows = [];
for (const question of simulation.questions) {
  const result = run.questions.find((item) => item.id === question.id);
  if (!result) throw new Error(`${question.id} is missing from ${runName}.json.`);
  const sent = new Map((result.sent ?? []).map((entry) => [entry.file, entry]));
  const simulated = new Map(question.files.map((entry) => [entry.file, entry]));
  for (const file of new Set([...sent.keys(), ...simulated.keys()])) {
    const app = sent.get(file);
    const sim = simulated.get(file);
    if (!app?.ordinals && !sim?.ordinals) continue;
    const same = JSON.stringify(app?.ordinals ?? null) === JSON.stringify(sim?.ordinals ?? null);
    rows.push({ id: question.id, file, simulation: describe(sim), application: describe(app), same, note: app?.note ?? '' });
  }
}

console.log('| Question | File | Simulation | Application | Same | Application note |');
console.log('|---|---|---|---|---|---|');
for (const row of rows) console.log(`| ${row.id} | ${row.file} | ${row.simulation} | ${row.application} | ${row.same ? 'yes' : '**no**'} | ${row.note} |`);
const differing = rows.filter((row) => !row.same);
console.log(`\n${rows.length - differing.length} of ${rows.length} files sent by passages chose the same chunks${differing.length ? `; differ: ${differing.map((row) => row.id).join(', ')}` : ''}.`);
process.exit(differing.length ? 1 : 0);
