// What the connections panel and the chat say about model connections,
// without React, so it can be tested on its own.

import type { CheckStatus, ProviderConnection, ProviderModel } from '@/lib/contracts/providers';

export const STATUS_TEXT: Record<CheckStatus, string> = {
  ok: 'Works',
  rejected: 'Key rejected',
  unreachable: 'Unreachable',
  failed: 'Check failed',
};

export type Tone = 'ok' | 'danger' | 'warn' | 'muted';

export function statusTone(status: CheckStatus | null): Tone {
  if (status === 'ok') return 'ok';
  if (status === 'rejected') return 'danger';
  return status ? 'warn' : 'muted';
}

// "just now", "4 min ago", "2 h ago", "yesterday", "3 days ago".
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function statusLine(connection: Pick<ProviderConnection, 'status' | 'checkedAt'>, now = Date.now()): string {
  if (!connection.status || !connection.checkedAt) return 'Not checked yet';
  return `${STATUS_TEXT[connection.status]} · ${ago(connection.checkedAt, now)}`;
}

// How many models the chat offers from this connection.
export function chatModelCount(connection: Pick<ProviderConnection, 'models' | 'chatModels'>): number {
  return connection.chatModels === null ? connection.models.length : connection.chatModels.length;
}

// A connection needs attention when its key failed the last check, or when it
// offers models but the chat shows none of them: a long list, like
// OpenRouter's, starts that way until someone chooses.
export function needsAttention(connection: Pick<ProviderConnection, 'status' | 'models' | 'chatModels'>): boolean {
  const failing = connection.status !== null && connection.status !== 'ok';
  return failing || (connection.models.length > 0 && chatModelCount(connection) === 0);
}

export function summarize(connections: ProviderConnection[]) {
  const attention = connections.filter(needsAttention).length;
  return {
    total: connections.length,
    working: connections.filter((connection) => connection.status === 'ok' && !needsAttention(connection)).length,
    attention,
  };
}

// The chat lists the same model id once per connection that offers it, so an
// entry is told apart by both. The environment's key has no connection id.
export function modelKey(model: Pick<ProviderModel, 'id' | 'connectionId'>): string {
  return `${model.connectionId ?? ''}::${model.id}`;
}

// The chat's models grouped by connection, in the order the server sent them.
export function groupByConnection(models: ProviderModel[]): Array<{ label: string | null; models: ProviderModel[] }> {
  const groups: Array<{ key: string; label: string | null; models: ProviderModel[] }> = [];
  for (const model of models) {
    const key = model.connectionId ?? '';
    const group = groups.find((candidate) => candidate.key === key);
    if (group) group.models.push(model);
    else groups.push({ key, label: model.connectionLabel ?? null, models: [model] });
  }
  return groups.map(({ label, models: grouped }) => ({ label, models: grouped }));
}
