import { z } from 'zod';
import { addConnectionRequest } from '@/lib/contracts/providers';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import {
  addConnection,
  assertProviderKeyEncryptionConfigured,
  checkProvider,
  describeConnection,
  effectiveProvider,
  MAX_CONNECTIONS,
  normalizeBaseUrl,
  scopeOf,
  usableConnections,
  weeklyUsage,
} from '@/lib/server/provider';

export const dynamic = 'force-dynamic';

// The keys are the one secret this application keeps in its own database.
// They never leave the server: the browser gets a mask, which is enough to
// tell keys apart and useless to anyone who obtains the response.
export async function GET() {
  try {
    const member = await requireMember();
    const rows = await usableConnections(member);
    const usage = await weeklyUsage(member, rows.map((row) => row.id));
    return json({
      connections: rows.map((row) => describeConnection(row, member, usage.get(row.id) ?? [0, 0, 0, 0, 0, 0, 0])),
      canSetTeam: member.role === 'owner',
      limit: MAX_CONNECTIONS,
      effective: await effectiveProvider(member),
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const input = addConnectionRequest.parse(await readJson(request));
    const scope = scopeOf(member, input.scope);
    const url = normalizeBaseUrl(input.baseUrl);
    if (!url.ok) throw new ApiError(400, url.reason);
    assertProviderKeyEncryptionConfigured();

    // Verify before storing, so a wrong key is reported while the form is
    // still open rather than at somebody's first message.
    const check = await checkProvider(url.url, input.apiKey);
    if (!check.ok) throw new ApiError(400, check.reason);

    const row = await addConnection(scope, { label: input.label, baseUrl: url.url, apiKey: input.apiKey, models: check.models });
    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'provider.configured',
      targetType: 'provider',
      targetId: row.id,
      targetLabel: row.label,
      // The address is not a secret and says which service is in use; the key
      // never appears here, and `serializeDetail` would drop it anyway.
      detail: { scope: input.scope, address: url.url, models: check.models.length },
    });
    return json({ connection: describeConnection(row, member, [0, 0, 0, 0, 0, 0, 0]) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Fill in the name, address and key.' }, { status: 400 });
    return errorResponse(error);
  }
}
