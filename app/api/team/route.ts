import { env } from 'cloudflare:workers';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { invites, memberLimits, members } from '@/db/schema';
import { requireMember, requireOwner } from '@/lib/server/auth';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { recordAudit } from '@/lib/server/audit';
import { newInviteToken, sha256 } from '@/lib/server/session';

export const dynamic = 'force-dynamic';
const TEAM_LIMIT = 4;
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const inviteSchema = z.object({ email: z.email().trim().toLowerCase().max(254) });
const revokeInviteSchema = z.object({ id: z.uuid() });

// Zaproszenia, które wygasły, nie blokują już miejsca. Wcześniej GET liczył je
// inaczej niż POST, więc panel pokazywał wolne miejsce, a serwer odbijał 409.
function pendingInviteCondition() {
  return and(isNull(invites.acceptedAt), gt(invites.expiresAt, new Date()));
}

export async function GET() {
  try {
    const member = await requireMember();
    const db = getDb();
    const isOwner = member.role === 'owner';
    // Limity dołączamy tylko ownerowi — to on nimi steruje, a reszcie
    // zespołu cudze progi do niczego nie są potrzebne.
    const team = await db
      .select({
        id: members.id,
        displayName: members.displayName,
        email: members.email,
        role: members.role,
        status: members.status,
        dailyTokens: memberLimits.dailyTokens,
        monthlyTokens: memberLimits.monthlyTokens,
        apiEnabled: memberLimits.enabled,
      })
      .from(members)
      .leftJoin(memberLimits, eq(memberLimits.memberId, members.id))
      .orderBy(asc(members.createdAt));
    const pending = await db
      .select({ id: invites.id, email: invites.email, expiresAt: invites.expiresAt })
      .from(invites)
      .where(pendingInviteCondition())
      .orderBy(asc(invites.createdAt));
    // Zaproszenie na adres istniejącego członka to link ponownego dostępu, a nie
    // rezerwacja miejsca. Liczone jako miejsce blokowałoby zaproszenie kolejnej
    // osoby i pokazywało w panelu np. „5 z 4”.
    const memberEmails = new Set(team.map((row) => row.email));
    const reservations = pending.filter((invite) => !memberEmails.has(invite.email));
    const reconnectLinks = pending.filter((invite) => memberEmails.has(invite.email));
    return json({
      // Adresy e-mail widzi tylko owner — reszcie zespołu do niczego nie
      // są potrzebne, a panel i tak wyświetla wyłącznie nazwy.
      members: team.map((row) => (isOwner ? row : { id: row.id, displayName: row.displayName, role: row.role, status: row.status })),
      pendingInvites: isOwner ? reservations : [],
      reconnectLinks: isOwner ? reconnectLinks : [],
      capacity: { used: team.length + reservations.length, total: TEAM_LIMIT },
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const owner = await requireOwner();
    const { email } = inviteSchema.parse(await readJson(request));
    const db = getDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS);

    // Adres należący już do zespołu daje link ponownego dostępu, a nie nowe
    // zaproszenie: nie zajmuje kolejnego miejsca i nie zakłada drugiego konta.
    const [existingMember] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
    if (!existingMember) {
      // Tabele mają najwyżej cztery wiersze, więc liczymy w pamięci — dzięki temu
      // te same reguły co w GET decydują o tym, co jest zajętym miejscem.
      const teamEmails = await db.select({ email: members.email }).from(members);
      const pending = await db.select({ email: invites.email }).from(invites).where(pendingInviteCondition());
      const memberEmails = new Set(teamEmails.map((row) => row.email));
      const reservations = pending.filter((invite) => !memberEmails.has(invite.email));
      if (teamEmails.length + reservations.length >= TEAM_LIMIT) throw new ApiError(409, 'All four seats are occupied or reserved.');
    }

    const id = crypto.randomUUID();
    const token = newInviteToken();
    const tokenHash = await sha256(token);
    await db
      .insert(invites)
      .values({ id, email, tokenHash, createdBy: owner.id, expiresAt })
      .onConflictDoUpdate({ target: invites.email, set: { tokenHash, acceptedAt: null, expiresAt, createdBy: owner.id } });
    await recordAudit({ actorId: owner.id, actorLabel: owner.displayName, action: 'invite.created', targetType: 'invite', targetId: id, targetLabel: email, detail: { kind: existingMember ? 'reconnect' : 'new invitation' } });
    return json(
      {
        invite: { id, email, expiresInDays: 7, joinPath: `/join?token=${encodeURIComponent(token)}`, kind: existingMember ? 'reconnect' : 'invite' },
        signInRequired: false,
        authProvider: env.OWNER_ACCOUNT_USER_ID || env.OWNER_EMAIL ? 'app-session-or-chatgpt' : 'app-session',
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Enter a valid email address.' }, { status: 400 });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const owner = await requireOwner();
    const { id } = revokeInviteSchema.parse(await readJson(request));
    const db = getDb();
    const [invite] = await db.select({ id: invites.id }).from(invites).where(and(eq(invites.id, id), isNull(invites.acceptedAt))).limit(1);
    if (!invite) throw new ApiError(404, 'No unused invitation was found.');
    await db.delete(invites).where(eq(invites.id, id));
    await recordAudit({ actorId: owner.id, actorLabel: owner.displayName, action: 'invite.revoked', targetType: 'invite', targetId: id });
    return json({ revoked: true });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid invitation ID.' }, { status: 400 });
    return errorResponse(error);
  }
}
