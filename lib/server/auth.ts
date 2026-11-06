import 'server-only';

import { env } from 'cloudflare:workers';
import { count, eq } from 'drizzle-orm';
import { type ChatGPTUser, getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { invites, memberLimits, members, projects } from '@/db/schema';
import { ApiError } from './http';
import { getSessionMember, sha256 } from './session';

export type CurrentMember = typeof members.$inferSelect;
const MAX_MEMBERS = 4;

// The owner row never stores a real address: the owner signs in through the
// platform or the setup key, not through an invitation sent to an email.
export function newOwnerMember(providerUserId: string, displayName: string): CurrentMember {
  const id = crypto.randomUUID();
  const now = new Date();
  return {
    id,
    providerUserId,
    email: `owner-${id.slice(0, 12)}@invalid.example`,
    displayName: displayName.slice(0, 100),
    role: 'owner',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

// The first owner also gets a starter project, so the dashboard is not empty.
export function ownerInserts(db: ReturnType<typeof getDb>, owner: CurrentMember) {
  return [
    db.insert(members).values(owner),
    db.insert(memberLimits).values({ memberId: owner.id }),
    db.insert(projects).values({
      id: crypto.randomUUID(),
      ownerId: owner.id,
      name: 'AI Workspace Demo',
      description: 'A clean workspace for exploring private projects, file context and AI-assisted conversations.',
      visibility: 'private',
    }),
  ] as const;
}

// The name the platform gives a person, when it gives one. Only the full name
// counts: without it the platform falls back to the email address, and that
// can be a private relay address nobody wants to see as a name.
function platformName(identity: ChatGPTUser | null): string | null {
  const name = identity?.fullName?.trim().slice(0, 100);
  return name ? name : null;
}

// On Sites the platform knows each person's name, and nobody can rename
// themselves in the app. A member whose name differs from the platform's takes
// the platform's, at sign-in. That is how the first owner, once created as
// "Demo Owner", gets a real name. Only for the account the session belongs to.
export async function syncPlatformName(member: CurrentMember, identity: ChatGPTUser | null): Promise<CurrentMember> {
  const name = platformName(identity);
  if (!identity || !name || name === member.displayName) return member;
  if (member.providerUserId !== await sha256(`chatgpt:${identity.userId}`)) return member;
  await getDb().update(members).set({ displayName: name, updatedAt: new Date() }).where(eq(members.id, member.id));
  return { ...member, displayName: name };
}

export async function requireMember(): Promise<CurrentMember> {
  const sessionMember = await getSessionMember();
  if (sessionMember) return sessionMember;

  const identity =
    (await getChatGPTUser()) ??
    (process.env.NODE_ENV === 'development'
      ? {
          userId: 'local-sites-owner',
          email: 'owner@sites.test',
          displayName: 'Daniel',
          fullName: 'Daniel',
        }
      : null);
  if (!identity) throw new ApiError(401, 'Sign in to continue.');

  const email = identity.email.trim().toLocaleLowerCase('en-US');
  const providerUserId = await sha256(`chatgpt:${identity.userId}`);
  const db = getDb();
  const [existing] = await db
    .select()
    .from(members)
    .where(eq(members.providerUserId, providerUserId))
    .limit(1);

  if (existing) {
    if (existing.status !== 'active') {
      throw new ApiError(403, 'This account has been suspended.');
    }
    return syncPlatformName(existing, identity);
  }

  const [{ value: memberCount }] = await db.select({ value: count() }).from(members);
  const ownerEmail = env.OWNER_EMAIL?.trim().toLocaleLowerCase('en-US');
  const ownerAccountUserId = env.OWNER_ACCOUNT_USER_ID?.trim();
  const isLocalSitesIdentity =
    process.env.NODE_ENV === 'development' && email.endsWith('@sites.test');
  const mayBootstrapOwner =
    memberCount === 0 &&
    (identity.userId === ownerAccountUserId ||
      email === ownerEmail ||
      isLocalSitesIdentity ||
      env.ALLOW_FIRST_USER_BOOTSTRAP === 'true');

  if (!mayBootstrapOwner) {
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.email, email))
      .limit(1);
    if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
      throw new ApiError(403, 'No active invitation exists for this cloud.');
    }
    if (memberCount >= MAX_MEMBERS) {
      throw new ApiError(403, 'The four-member limit has been reached.');
    }
  }

  const now = new Date();
  const member: CurrentMember = mayBootstrapOwner
    ? newOwnerMember(providerUserId, platformName(identity) ?? 'Owner')
    : {
        id: crypto.randomUUID(),
        providerUserId,
        email,
        displayName: identity.displayName.slice(0, 100),
        role: 'member',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
  const { id } = member;
  try {
    if (mayBootstrapOwner) {
      await db.batch(ownerInserts(db, member));
    } else {
      await db.batch([
        db.insert(members).values(member),
        db.insert(memberLimits).values({ memberId: id }),
      ]);
    }
  } catch (error) {
    // The dashboard starts several requests in parallel. After a clean reset,
    // more than one request can observe an empty member table and attempt the
    // same identity bootstrap. The unique provider key chooses one winner;
    // every other request resumes with that completed account.
    const [concurrent] = await db
      .select()
      .from(members)
      .where(eq(members.providerUserId, providerUserId))
      .limit(1);
    if (concurrent?.status === 'active') return concurrent;
    throw error;
  }
  if (!mayBootstrapOwner) {
    await db.update(invites).set({ acceptedAt: now }).where(eq(invites.email, email));
  }
  return member;
}

export async function requireOwner() {
  const member = await requireMember();
  if (member.role !== 'owner') throw new ApiError(403, 'Only the owner can perform this operation.');
  return member;
}
