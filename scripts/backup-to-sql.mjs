// Zamienia kopię z /api/admin/backup na plik SQL do odtworzenia bazy.
//
// Świadomie NIE wykonuje niczego na bazie — wypluwa SQL, który trzeba podać
// wranglerowi ręcznie. Odtwarzanie nadpisuje dane, więc ostatni krok ma być
// decyzją człowieka, a nie efektem ubocznym uruchomienia skryptu.
//
//   node scripts/backup-to-sql.mjs kopia.json odtworzenie.sql
//
// Potem, świadomie i po sprawdzeniu pliku:
//   npx wrangler d1 execute site-creator-d1 --local --file odtworzenie.sql \
//     --persist-to .wrangler/state --config dist/server/wrangler.json
//
// Na produkcji tę samą treść wykonuje się przez panel hostingu — lokalny
// wrangler nie ma dostępu do produkcyjnego D1.

import { readFileSync, writeFileSync } from 'node:fs';

// Kolejność ma znaczenie: klucze obce wymagają, żeby rodzic istniał wcześniej.
const TABLE_ORDER = [
  ['members', 'members'],
  ['memberLimits', 'member_limits'],
  ['invites', 'invites'],
  ['syncTokens', 'sync_tokens'],
  ['projects', 'projects'],
  ['projectMembers', 'project_members'],
  ['files', 'files'],
  ['conversations', 'conversations'],
  ['messages', 'messages'],
  ['usageEvents', 'usage_events'],
  ['appSettings', 'app_settings'],
  ['auditEvents', 'audit_events'],
];

// Drizzle zwraca nazwy pól w camelCase; baza trzyma snake_case.
const column = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  // Znaczniki czasu wracają z JSON-a jako tekst ISO, a w bazie są liczbą ms.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return String(Date.parse(value));
  return `'${String(value).replaceAll("'", "''")}'`;
}

const [, , source, target] = process.argv;
if (!source || !target) {
  console.error('Usage: node scripts/backup-to-sql.mjs <backup.json> <output.sql>');
  process.exit(1);
}

const backup = JSON.parse(readFileSync(source, 'utf8'));
if (backup.format !== 'meshkeep-backup') {
  console.error(`This is not a MeshKeep backup (format: ${backup.format ?? 'missing'}).`);
  process.exit(1);
}

const lines = [
  `-- Odtworzenie z kopii z ${backup.exportedAt}`,
  '-- WARNING: deletes the current contents of restored tables.',
  '-- Sessions, token hashes and stored files are NOT restored.',
  'PRAGMA defer_foreign_keys = TRUE;',
  'DELETE FROM sessions;',
];

// Kasujemy od dzieci do rodziców, wstawiamy w odwrotnej kolejności.
for (const [, table] of [...TABLE_ORDER].reverse()) lines.push(`DELETE FROM ${table};`);

let total = 0;
for (const [key, table] of TABLE_ORDER) {
  const rows = backup.tables?.[key] ?? [];
  for (const row of rows) {
    const keys = Object.keys(row);
    lines.push(`INSERT INTO ${table} (${keys.map(column).join(', ')}) VALUES (${keys.map((k) => literal(row[k])).join(', ')});`);
    total += 1;
  }
  if (rows.length) lines.push(`-- ${table}: ${rows.length}`);
}

writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
console.log(`Zapisano ${target}: ${total} wierszy w ${TABLE_ORDER.length} tabelach.`);
console.log('Review the file before running it; restoration overwrites data.');
