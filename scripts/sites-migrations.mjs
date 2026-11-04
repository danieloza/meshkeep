// Builds the migration line for the MeshKeep database on OpenAI Sites.
//
// That database was migrated with an older line before this repository had
// its own, and migrations are recorded by file name. So its line is a frozen
// prefix, `deploy/sites/migrations` (0000-0005, what that database has applied),
// followed by every migration from 0006 on in `drizzle/`, copied unchanged.
// The public 0005 changes nothing; it only takes the number, so that the names
// match from 0006 on.
//
//   node scripts/sites-migrations.mjs <output directory>
//
// The output replaces `drizzle/` in the source handed to Sites. See
// `deploy/sites/README.md`.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The public line up to the point where both lines share names. Renaming or
// renumbering one of these would make the lines drift apart again, so it fails.
export const PUBLIC_HEAD = [
  '0000_high_mimic',
  '0001_chat_context_and_instructions',
  '0002_file_texts',
  '0003_search_index',
  '0004_model_effort',
  '0005_bridge_to_public',
];

// The frozen prefix, by content. The Sites database has applied all of it,
// so an edit would change nothing there and would only make a fresh install
// differ from the one that exists. Line endings are normalised before hashing,
// because Git converts them on Windows checkouts.
//
// Two files differ from what ran, without changing the result. 0004 deleted
// the demo data once; here it does nothing, because that database has applied
// it and a new one has nothing to delete. 0005 lost the site's address from
// its first comment line; its statements are the ones that ran.
export const SITES_PREFIX = {
  '0000_odd_havok': '8e379d445d14809eb9d85e604a0dce58e8a0ff1aeb8c9283a0b77ada6dd4c144',
  '0001_dapper_justice': '88eaff36d8a96c505f3d6a7bf442ff5f82a508bdac8826654e9d82c90125d351',
  '0002_naive_photon': 'b3f98a90317bf61d92ba290b96cc3346d174958d893f847bc0e2cf92862187c0',
  '0003_cheerful_alice': 'be2f9fa3836f586e94929bfb8a53cea5f7a6a941f0efa547799dcaab36761823',
  '0004_sanitize_public_demo': 'd93673fbfb9185f749d9bc030bbeabaf5b817f268a300556f380a989cdf3d504',
  '0005_bridge_to_public': '0bcfb7f5dd0a7751f81756e4daa3bc81bce45dfbb7c80ac97cebeae5ee555a9b',
};

const lf = (text) => text.replace(/\r\n/g, '\n');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function readLine(dir) {
  const migrations = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.slice(0, -'.sql'.length), sql: lf(readFileSync(join(dir, name), 'utf8')) }));
  const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8'));
  migrations.forEach(({ tag }, index) => {
    if (!tag.startsWith(`${String(index).padStart(4, '0')}_`)) throw new Error(`${dir}: ${tag} is out of sequence; expected number ${index}.`);
  });
  const journalTags = journal.entries.map((entry) => entry.tag);
  if (journalTags.join() !== migrations.map(({ tag }) => tag).join()) {
    throw new Error(`${dir}: meta/_journal.json lists ${journalTags.join(', ')}, the folder has ${migrations.map(({ tag }) => tag).join(', ')}.`);
  }
  return { migrations, journal };
}

export function sitesMigrationLine({ publicDir = join(ROOT, 'drizzle'), prefixDir = join(ROOT, 'deploy', 'sites', 'migrations') } = {}) {
  const pub = readLine(publicDir);
  const head = pub.migrations.slice(0, PUBLIC_HEAD.length).map(({ tag }) => tag);
  if (head.join() !== PUBLIC_HEAD.join()) {
    throw new Error(`The public migrations up to 0005 must stay ${PUBLIC_HEAD.join(', ')}; found ${head.join(', ')}.`);
  }

  const prefix = readLine(prefixDir);
  const expected = Object.keys(SITES_PREFIX);
  if (prefix.migrations.map(({ tag }) => tag).join() !== expected.join()) {
    throw new Error(`${prefixDir} must hold exactly ${expected.join(', ')}.`);
  }
  for (const { tag, sql } of prefix.migrations) {
    if (sha256(sql) !== SITES_PREFIX[tag]) throw new Error(`${tag} in ${prefixDir} was changed; the Sites database has already applied it.`);
  }

  const shared = pub.migrations.slice(PUBLIC_HEAD.length);
  const sharedEntries = pub.journal.entries.slice(PUBLIC_HEAD.length);
  // drizzle's own migrator applies what is newer than the last applied entry,
  // so a shared migration dated before the bridge would be skipped on Sites.
  let previous = prefix.journal.entries.at(-1).when;
  for (const entry of sharedEntries) {
    if (entry.when <= previous) throw new Error(`${entry.tag} is dated before the migration it follows.`);
    previous = entry.when;
  }

  return {
    migrations: [...prefix.migrations, ...shared],
    journal: { ...prefix.journal, entries: [...prefix.journal.entries, ...sharedEntries] },
  };
}

export function writeSitesMigrationLine(outDir, options) {
  const target = resolve(outDir);
  // Writing over an older copy could leave a migration there that the line no
  // longer has, and it would run on Sites.
  if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} is not empty.`);
  const line = sitesMigrationLine(options);
  mkdirSync(join(target, 'meta'), { recursive: true });
  for (const { tag, sql } of line.migrations) writeFileSync(join(target, `${tag}.sql`), sql);
  writeFileSync(join(target, 'meta', '_journal.json'), `${JSON.stringify(line.journal, null, 2)}\n`);
  return line;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('Usage: node scripts/sites-migrations.mjs <output directory>');
    process.exit(1);
  }
  try {
    const line = writeSitesMigrationLine(outDir);
    const shared = line.migrations.length - Object.keys(SITES_PREFIX).length;
    console.log(`Sites migration line written to ${resolve(outDir)}: ${Object.keys(SITES_PREFIX).length} frozen, ${shared} shared with drizzle/.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
