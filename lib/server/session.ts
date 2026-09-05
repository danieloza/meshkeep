import 'server-only';

import { cookies } from 'next/headers';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { members, sessions, syncTokens } from '@/db/schema';
import { ApiError } from './http';

const SESSION_COOKIE = 'meshkeep_session';
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_RENEW_AFTER_MS = SESSION_LIFETIME_MS / 2;
// The cookie deliberately outlives the rolling D1 session. The database row
// remains the source of truth, so a cookie without a live row is useless.
const SESSION_COOKIE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

function randomToken(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  values.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function newInviteToken() {
  return randomToken(32);
}

export function newSyncTokenValue() {
  return `meshkeep_${randomToken(32)}`;
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((item) => item.toString(16).padStart(2, '0'))
    .join('');
}

export async function newSession(memberId: string) {
  const token = randomToken();
  const now = new Date();
  return {
    row: {
      id: crypto.randomUUID(),
      tokenHash: await sha256(token),
      memberId,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
      createdAt: now,
      lastSeenAt: now,
    },
    cookie: serializeSessionCookie(token, new Date(now.getTime() + SESSION_COOKIE_LIFETIME_MS)),
  };
}

export async function getSessionMember() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length < 40 || token.length > 100) return null;
  const tokenHash = await sha256(token);
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select({ member: members, session: sessions })
    .from(sessions)
    .innerJoin(members, eq(members.id, sessions.memberId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || row.member.status !== 'active') return null;
  // Renew active sessions before they expire without rotating the cookie on
  // every request.
  if (row.session.expiresAt.getTime() - now.getTime() < SESSION_RENEW_AFTER_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS), lastSeenAt: now })
      .where(eq(sessions.id, row.session.id));
  }
  return row.member;
}

export async function revokeCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && token.length >= 40 && token.length <= 100) {
    await getDb().delete(sessions).where(eq(sessions.tokenHash, await sha256(token)));
  }
  return serializeExpiredSessionCookie();
}

export async function requireSyncToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer (meshkeep_[A-Za-z0-9_-]{40,100})$/.exec(authorization);
  if (!match) throw new ApiError(401, 'A valid sync agent key is required.');
  const tokenHash = await sha256(match[1]);
  const db = getDb();
  const [row] = await db
    .select({ token: syncTokens, member: members })
    .from(syncTokens)
    .innerJoin(members, eq(members.id, syncTokens.memberId))
    .where(and(eq(syncTokens.tokenHash, tokenHash), isNull(syncTokens.revokedAt), gt(syncTokens.expiresAt, new Date())))
    .limit(1);
  if (!row || row.member.status !== 'active') throw new ApiError(401, 'The agent key has expired or was revoked.');
  await db.update(syncTokens).set({ lastUsedAt: new Date() }).where(eq(syncTokens.id, row.token.id));
  return row.member;
}

function serializeSessionCookie(token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=${expiresAt.toUTCString()}; Max-Age=${Math.floor(SESSION_COOKIE_LIFETIME_MS / 1000)}`;
}

function serializeExpiredSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
}
