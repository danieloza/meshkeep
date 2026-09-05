import 'server-only';

import { getDb } from '@/db';
import { auditEvents } from '@/db/schema';
import { type AuditAction, serializeDetail } from '@/lib/audit';

type AuditEntry = {
  actorId: string | null;
  actorLabel: string;
  action: AuditAction;
  targetType?: 'member' | 'invite' | 'project' | 'file' | 'conversation' | 'settings' | 'sync_token' | 'provider';
  targetId?: string;
  targetLabel?: string;
  detail?: Record<string, unknown>;
};

// Zapis dziennika nie może wywrócić operacji, która już się powiodła — w chwili
// wywołania zmiana jest zwykle zacommitowana, a wyjątek stąd zamieniłby udane
// zawieszenie konta w błąd 500. Dlatego łykamy wyjątek i zostawiamy ślad w
// logach platformy. Kompromis jest świadomy: dziennik może mieć lukę, ale nigdy
// nie zablokuje akcji bezpieczeństwa.
export async function recordAudit(entry: AuditEntry) {
  try {
    await getDb().insert(auditEvents).values({
      id: crypto.randomUUID(),
      actorId: entry.actorId,
      actorLabel: entry.actorLabel.slice(0, 100),
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel?.slice(0, 120) ?? null,
      detail: serializeDetail(entry.detail),
      createdAt: new Date(),
    });
  } catch (error) {
    console.error('Could not save the audit event:', entry.action, error instanceof Error ? error.message : 'unknown error');
  }
}
