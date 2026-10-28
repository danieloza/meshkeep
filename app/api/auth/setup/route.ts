import { env } from 'cloudflare:workers';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { members, sessions } from '@/db/schema';
import { recordAudit } from '@/lib/server/audit';
import { newOwnerMember, ownerInserts } from '@/lib/server/auth';
import { getAuthMode } from '@/lib/server/auth-mode';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { newSession, sha256 } from '@/lib/server/session';

const MIN_TOKEN_LENGTH = 32;
// A fixed provider key makes the unique index the arbiter: two parallel setup
// requests on an empty database cannot both create an owner.
const SETUP_OWNER_PROVIDER_ID = 'standalone:owner';

const setupSchema = z.object({
  token: z.string().min(MIN_TOKEN_LENGTH).max(200),
  displayName: z.string().trim().min(2).max(100).optional(),
});

// Hashing first gives both sides the same length, and the loop has no early
// exit, so the response time does not reveal how much of the key matched.
async function matchesSecret(given: string, expected: string) {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

// A standalone installation has no platform identity, so the owner proves
// ownership with OWNER_SETUP_TOKEN, a secret only whoever deployed the worker
// knows. The first use creates the owner. Later uses open a new session for
// that same owner, which is how the owner gets back in after a session ends.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (getAuthMode() !== 'standalone') throw new ApiError(404, 'Not found.');
    const expected = env.OWNER_SETUP_TOKEN?.trim() ?? '';
    if (expected.length < MIN_TOKEN_LENGTH) {
      throw new ApiError(503, 'Owner setup is not configured on this server.');
    }
    const input = setupSchema.parse(await readJson(request));
    if (!(await matchesSecret(input.token, expected))) {
      throw new ApiError(401, 'The owner setup key is incorrect.');
    }

    const db = getDb();
    const [existingOwner] = await db.select().from(members).where(eq(members.role, 'owner')).limit(1);
    if (existingOwner) {
      if (existingOwner.status !== 'active') throw new ApiError(403, 'This account has been suspended.');
      const session = await newSession(existingOwner.id);
      await db.insert(sessions).values(session.row);
      await recordAudit({ actorId: existingOwner.id, actorLabel: existingOwner.displayName, action: 'owner.recovered', targetType: 'member', targetId: existingOwner.id, targetLabel: existingOwner.displayName });
      return json(
        { authenticated: true, created: false, member: { displayName: existingOwner.displayName } },
        { headers: { 'Set-Cookie': session.cookie } },
      );
    }

    // Same rule as the platform sign-in: the owner is only created on an empty
    // workspace, never added next to members who are already there.
    const [{ value: memberCount }] = await db.select({ value: count() }).from(members);
    if (memberCount > 0) throw new ApiError(409, 'This workspace already has members.');

    const owner = newOwnerMember(SETUP_OWNER_PROVIDER_ID, input.displayName ?? 'Owner');
    const session = await newSession(owner.id);
    try {
      await db.batch([...ownerInserts(db, owner), db.insert(sessions).values(session.row)]);
    } catch {
      throw new ApiError(409, 'The owner was just created by another request. Sign in again with the same key.');
    }
    await recordAudit({ actorId: owner.id, actorLabel: owner.displayName, action: 'owner.setup', targetType: 'member', targetId: owner.id, targetLabel: owner.displayName });
    return json(
      { authenticated: true, created: true, member: { displayName: owner.displayName } },
      { status: 201, headers: { 'Set-Cookie': session.cookie } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Check the setup key and display name.' }, { status: 400 });
    return errorResponse(error);
  }
}
