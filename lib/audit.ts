// Słownik events dziennika i bezpieczna serializacja szczegółów.
//
// ZASADA: w dzienniku nie ma treści rozmów, promptów, zawartości files ani
// sekretów. Zapisujemy, KTO zrobił CO i KOMU — nigdy o czym była rozmowa.
// `serializeDetail` jest tu, a nie w route handlerze, żeby ta reguła dała się
// przetestować i żeby nikt nie wsadził do dziennika całego obiektu żądania.

export const AUDIT_ACTIONS = [
  'invite.created',
  'invite.revoked',
  'member.joined',
  'member.reconnected',
  'member.suspended',
  'member.activated',
  'member.limits_changed',
  'settings.kill_switch_on',
  'settings.kill_switch_off',
  'project.deleted',
  'file.deleted',
  'file.pruned',
  'conversation.deleted',
  'sync_token.created',
  'sync_token.revoked',
  'backup.exported',
  'provider.configured',
  'provider.removed',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_LABELS: Record<AuditAction, string> = {
  'invite.created': 'Invitation created',
  'invite.revoked': 'Invitation revoked',
  'member.joined': 'Member joined',
  'member.reconnected': 'Access restored with reconnect link',
  'member.suspended': 'Account suspended',
  'member.activated': 'Account reactivated',
  'member.limits_changed': 'Limits changed',
  'settings.kill_switch_on': 'Model access disabled',
  'settings.kill_switch_off': 'Model access restored',
  'project.deleted': 'Project deleted',
  'file.deleted': 'File deleted',
  'file.pruned': 'Agent pruned locally deleted files',
  'conversation.deleted': 'Conversation deleted',
  'sync_token.created': 'Agent key created',
  'sync_token.revoked': 'Agent key revoked',
  'backup.exported': 'Backup exported',
  'provider.configured': 'Model provider configured',
  'provider.removed': 'Model provider removed',
};

// Zdarzenia, które opisują odebranie komuś dostępu — panel wyróżnia je wizualnie.
const SENSITIVE: ReadonlySet<AuditAction> = new Set([
  'member.suspended',
  'settings.kill_switch_on',
  'invite.revoked',
  'sync_token.revoked',
  'project.deleted',
  'file.deleted',
  'file.pruned',
  'conversation.deleted',
  'provider.removed',
]);

export function isSensitiveAction(action: string): boolean {
  return SENSITIVE.has(action as AuditAction);
}

const MAX_DETAIL_CHARS = 400;
const MAX_VALUE_CHARS = 80;

// Przyjmujemy wyłącznie płaskie pary klucz-wartość z prostymi typami. Obiekty,
// tablice i funkcje odrzucamy, bo to najprostsza droga, żeby do dziennika
// wpadła cała message użytkownika albo nagłówki żądania.
export function serializeDetail(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
    else if (typeof value === 'string') safe[key] = value.slice(0, MAX_VALUE_CHARS);
  }
  if (!Object.keys(safe).length) return null;
  const encoded = JSON.stringify(safe);
  return encoded.length > MAX_DETAIL_CHARS ? encoded.slice(0, MAX_DETAIL_CHARS) : encoded;
}
