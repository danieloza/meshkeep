import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ago, chatModelCount, groupByConnection, modelKey, needsAttention, statusLine, summarize } from '@/features/providers/connections';
import type { ProviderConnection } from '@/lib/contracts/providers';

const now = Date.parse('2026-11-05T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    scope: 'mine',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyPreview: 'sk-a••••9d21',
    models: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    chatModels: null,
    effortModels: [],
    status: 'ok',
    checkedAt: minutesAgo(4),
    usage7d: [0, 0, 0, 0, 0, 0, 0],
    canManage: true,
    ...overrides,
  };
}

describe('connection status', () => {
  it('says how long ago, in words people use', () => {
    expect(ago(minutesAgo(0), now)).toBe('just now');
    expect(ago(minutesAgo(4), now)).toBe('4 min ago');
    expect(ago(minutesAgo(130), now)).toBe('2 h ago');
    expect(ago(minutesAgo(26 * 60), now)).toBe('yesterday');
    expect(ago(minutesAgo(3 * 24 * 60), now)).toBe('3 days ago');
  });

  it('describes the last check, or that there was none', () => {
    expect(statusLine(connection(), now)).toBe('Works · 4 min ago');
    expect(statusLine(connection({ status: 'rejected', checkedAt: minutesAgo(120) }), now)).toBe('Key rejected · 2 h ago');
    expect(statusLine(connection({ status: null, checkedAt: null }), now)).toBe('Not checked yet');
  });

  it('counts the models the chat offers: all of them, or the chosen ones', () => {
    expect(chatModelCount(connection())).toBe(2);
    expect(chatModelCount(connection({ chatModels: ['b'] }))).toBe(1);
  });

  it('needs attention for a failing key, or a model list with nothing in the chat', () => {
    expect(needsAttention(connection())).toBe(false);
    expect(needsAttention(connection({ status: 'rejected' }))).toBe(true);
    expect(needsAttention(connection({ status: 'unreachable' }))).toBe(true);
    expect(needsAttention(connection({ chatModels: [] }))).toBe(true);
    // A provider without a model list has nothing to choose from.
    expect(needsAttention(connection({ models: [], chatModels: [] }))).toBe(false);
    // Not yet checked is not a problem by itself.
    expect(needsAttention(connection({ status: null, checkedAt: null }))).toBe(false);
  });

  it('sums up the panel', () => {
    expect(summarize([connection(), connection({ status: 'rejected' }), connection({ chatModels: [] }), connection({ status: null, checkedAt: null })]))
      .toEqual({ total: 4, working: 1, attention: 2 });
  });
});

describe('chat model list', () => {
  it('tells apart the same model offered by two connections', () => {
    expect(modelKey({ id: 'gpt-5', connectionId: 'c1' })).not.toBe(modelKey({ id: 'gpt-5', connectionId: 'c2' }));
    expect(modelKey({ id: 'glm' })).toBe('::glm');
  });

  it('groups models by connection in the order they came', () => {
    const groups = groupByConnection([
      { id: 'a', label: 'A', connectionId: 'c1', connectionLabel: 'Mine' },
      { id: 'b', label: 'B', connectionId: 'c2', connectionLabel: 'Team' },
      { id: 'c', label: 'C', connectionId: 'c1', connectionLabel: 'Mine' },
    ]);
    expect(groups.map((group) => [group.label, group.models.map((model) => model.id)])).toEqual([['Mine', ['a', 'c']], ['Team', ['b']]]);
  });
});

// The migration rebuilds the providers table to give each row an id. Node 22's
// SQLite has no FTS5, which an earlier migration needs; CI runs this on Node 24.
function hasFts5() {
  const db = new DatabaseSync(':memory:');
  try { db.exec('CREATE VIRTUAL TABLE probe USING fts5(text)'); return true; } catch { return false; } finally { db.close(); }
}

describe.skipIf(!hasFts5() && process.versions.node.startsWith('22.'))('migration 0007', () => {
  it('keeps every existing connection, with a UUID of its own and all its models in the chat', () => {
    const dir = join(__dirname, '..', 'drizzle');
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
    const at = files.findIndex((name) => name.startsWith('0007_'));
    const db = new DatabaseSync(':memory:');
    for (const name of files.slice(0, at)) db.exec(readFileSync(join(dir, name), 'utf8'));
    db.exec(`INSERT INTO providers (scope, label, base_url, api_key_ciphertext, key_preview, models, effort_models) VALUES
      ('team', 'Team', 'https://a.example/v1', 'v1:team', 'sk-…aaaa', '[{"id":"m"}]', '["m"]'),
      ('00000000-0000-4000-8000-000000000009', 'Mine', 'https://b.example/v1', 'v1:mine', 'sk-…bbbb', '[]', '[]')`);
    db.exec(readFileSync(join(dir, files[at]), 'utf8'));

    const rows = db.prepare('SELECT id, scope, label, api_key_ciphertext AS key, effort_models AS effort, chat_models AS chat, check_status AS status FROM providers ORDER BY label').all() as Array<Record<string, string | null>>;
    expect(rows.map(({ id: _id, ...rest }) => rest)).toEqual([
      { scope: '00000000-0000-4000-8000-000000000009', label: 'Mine', key: 'v1:mine', effort: '[]', chat: null, status: null },
      { scope: 'team', label: 'Team', key: 'v1:team', effort: '["m"]', chat: null, status: null },
    ]);
    for (const row of rows) expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    // Two connections in one scope are now possible.
    db.exec(`INSERT INTO providers (id, scope, label, base_url, api_key_ciphertext, key_preview) VALUES ('00000000-0000-4000-8000-0000000000aa', 'team', 'Second', 'https://c.example/v1', 'v1:x', 'sk-…cccc')`);
    expect(db.prepare("SELECT count(*) AS n FROM providers WHERE scope = 'team'").get()).toEqual({ n: 2 });
  });
});
