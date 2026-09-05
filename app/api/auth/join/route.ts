import { and, count, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { invites, memberLimits, members, sessions } from '@/db/schema';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { recordAudit } from '@/lib/server/audit';
import { newSession, sha256 } from '@/lib/server/session';

const joinSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/),
  displayName: z.string().trim().min(2).max(100),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = joinSchema.parse(await readJson(request));
    const db = getDb();
    const tokenHash = await sha256(input.token);
    const [invite] = await db
      .select()
      .from(invites)
      .where(and(eq(invites.tokenHash, tokenHash), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
      .limit(1);
    if (!invite) throw new ApiError(400, 'The invitation link is invalid, expired or has already been used.');

    const now = new Date();
    const [existingMember] = await db.select().from(members).where(eq(members.email, invite.email)).limit(1);

    // Link ponownego dostępu. Adres należy już do zespołu, więc nie zakładamy
    // drugiego konta ani nie zajmujemy kolejnego miejsca — podpinamy nową sesję
    // do istniejącego członka. Bez tej ścieżki wygaśnięcie sesji zamykało konto
    // na zawsze: token zaproszenia jest jednorazowy, a logowanie przez ChatGPT
    // nie rozpoznaje kogoś, kto wszedł z linku.
    if (existingMember) {
      if (existingMember.status !== 'active') throw new ApiError(403, 'This account has been suspended.');
      const reconnected = await newSession(existingMember.id);
      await db.batch([
        db.insert(sessions).values(reconnected.row),
        db.update(invites).set({ acceptedAt: now, tokenHash: null }).where(eq(invites.id, invite.id)),
      ]);
      await recordAudit({ actorId: existingMember.id, actorLabel: existingMember.displayName, action: 'member.reconnected', targetType: 'member', targetId: existingMember.id, targetLabel: existingMember.displayName });
      return json(
        { authenticated: true, reconnected: true, member: { displayName: existingMember.displayName } },
        { headers: { 'Set-Cookie': reconnected.cookie } },
      );
    }

    const [{ value: memberCount }] = await db.select({ value: count() }).from(members);
    if (memberCount >= 4) throw new ApiError(409, 'The four-member limit has been reached.');

    const memberId = crypto.randomUUID();
    const session = await newSession(memberId);
    await db.batch([
      db.insert(members).values({
        id: memberId,
        providerUserId: `invite:${invite.id}`,
        email: invite.email,
        displayName: input.displayName,
        role: 'member',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(memberLimits).values({ memberId }),
      db.insert(sessions).values(session.row),
      db.update(invites).set({ acceptedAt: now, tokenHash: null }).where(eq(invites.id, invite.id)),
    ]);
    await recordAudit({ actorId: memberId, actorLabel: input.displayName, action: 'member.joined', targetType: 'member', targetId: memberId, targetLabel: input.displayName });
    return json(
      { authenticated: true, reconnected: false, member: { displayName: input.displayName } },
      { status: 201, headers: { 'Set-Cookie': session.cookie } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Check the link and display name.' }, { status: 400 });
    return errorResponse(error);
  }
}
