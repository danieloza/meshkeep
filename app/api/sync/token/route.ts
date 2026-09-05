import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { syncTokens } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { recordAudit } from '@/lib/server/audit';
import { newSyncTokenValue, sha256 } from '@/lib/server/session';

const createSchema = z.object({ label: z.string().trim().min(2).max(80).default('My computer') });
const revokeSchema = z.object({ id: z.uuid() });

export async function GET() {
  try {
    const member = await requireMember();
    const rows = await getDb().select({ id: syncTokens.id, label: syncTokens.label, expiresAt: syncTokens.expiresAt, lastUsedAt: syncTokens.lastUsedAt, createdAt: syncTokens.createdAt }).from(syncTokens).where(and(eq(syncTokens.memberId, member.id), isNull(syncTokens.revokedAt))).orderBy(desc(syncTokens.createdAt));
    return json({ tokens: rows });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const input = createSchema.parse(await readJson(request));
    const token = newSyncTokenValue();
    const row = { id: crypto.randomUUID(), tokenHash: await sha256(token), memberId: member.id, label: input.label, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), createdAt: new Date() };
    await getDb().insert(syncTokens).values(row);
    await recordAudit({ actorId: member.id, actorLabel: member.displayName, action: 'sync_token.created', targetType: 'sync_token', targetId: row.id, targetLabel: row.label });
    return json({ token, credential: { id: row.id, label: row.label, expiresAt: row.expiresAt } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Enter a device name.' }, { status: 400 });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const input = revokeSchema.parse(await readJson(request));
    await getDb().update(syncTokens).set({ revokedAt: new Date() }).where(and(eq(syncTokens.id, input.id), eq(syncTokens.memberId, member.id)));
    await recordAudit({ actorId: member.id, actorLabel: member.displayName, action: 'sync_token.revoked', targetType: 'sync_token', targetId: input.id });
    return json({ revoked: true });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid key ID.' }, { status: 400 });
    return errorResponse(error);
  }
}
