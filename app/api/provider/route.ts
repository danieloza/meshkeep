import { z } from 'zod';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { maskKey } from '@/lib/provider';
import { assertProviderKeyEncryptionConfigured, checkProvider, normalizeBaseUrl, removeProvider, resolveProvider, saveProvider, TEAM_SCOPE } from '@/lib/server/provider';
import { getDb } from '@/db';
import { providers } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const saveSchema = z.object({
  label: z.string().trim().min(1).max(60),
  baseUrl: z.string().trim().min(1).max(400),
  apiKey: z.string().trim().min(8).max(400),
  // Only the owner may write the team default; anyone may write their own.
  scope: z.enum(['team', 'mine']).default('mine'),
});

// The stored key is the one secret this application keeps in its own database.
// It is never returned here — the caller gets a mask, which is enough to tell
// which key is configured and useless to anyone who obtains the response.
function describe(row: { label: string; baseUrl: string; keyPreview: string; models: string } | undefined) {
  if (!row) return null;
  let modelCount = 0;
  try { modelCount = (JSON.parse(row.models) as unknown[]).length; } catch { modelCount = 0; }
  return { label: row.label, baseUrl: row.baseUrl, keyPreview: row.keyPreview, modelCount };
}

export async function GET() {
  try {
    const member = await requireMember();
    const rows = await getDb().select().from(providers);
    const effective = await resolveProvider(member);
    return json({
      mine: describe(rows.find((row) => row.scope === member.id)),
      team: describe(rows.find((row) => row.scope === TEAM_SCOPE)),
      canSetTeam: member.role === 'owner',
      // Which configuration actually answers this member's requests, so the
      // interface can say whose key pays for a message.
      effective: effective ? { label: effective.label, origin: effective.origin, modelCount: effective.models.length } : null,
    });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const input = saveSchema.parse(await readJson(request));
    if (input.scope === 'team' && member.role !== 'owner') {
      throw new ApiError(403, 'Only the owner can set the provider for the team.');
    }

    const url = normalizeBaseUrl(input.baseUrl);
    if (!url.ok) throw new ApiError(400, url.reason);
    assertProviderKeyEncryptionConfigured();

    // Verify before storing, so a wrong key is reported while the form is still
    // open rather than at somebody's first message.
    const probe = await checkProvider(url.url, input.apiKey);
    if (!probe.ok) throw new ApiError(400, probe.reason ?? 'The provider could not be verified.');

    const scope = input.scope === 'team' ? TEAM_SCOPE : member.id;
    await saveProvider(scope, { label: input.label, baseUrl: url.url, apiKey: input.apiKey, models: probe.models });

    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'provider.configured',
      targetType: 'provider',
      targetLabel: input.label,
      // The address is not a secret and says which service is in use; the key
      // never appears here, and `serializeDetail` would drop it anyway.
      detail: { scope: input.scope, address: url.url, models: probe.models.length },
    });
    return json({ saved: true, modelCount: probe.models.length, keyPreview: maskKey(input.apiKey) });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Fill in the name, address and key.' }, { status: 400 });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const requestedScope = new URL(request.url).searchParams.get('scope') === 'team' ? 'team' : 'mine';
    if (requestedScope === 'team' && member.role !== 'owner') {
      throw new ApiError(403, 'Only the owner can remove the team provider.');
    }
    const scope = requestedScope === 'team' ? TEAM_SCOPE : member.id;
    const [existing] = await getDb().select().from(providers).where(eq(providers.scope, scope)).limit(1);
    if (!existing) return json({ removed: false });

    await removeProvider(scope);
    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'provider.removed',
      targetType: 'provider',
      targetLabel: existing.label,
      detail: { scope: requestedScope },
    });
    return json({ removed: true });
  } catch (error) { return errorResponse(error); }
}
