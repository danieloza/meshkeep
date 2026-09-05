import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { sessions } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { ApiError, assertSameOrigin, errorResponse, json } from '@/lib/server/http';
import { getSessionMember, newSession } from '@/lib/server/session';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const existing = await getSessionMember();
    if (existing) return json({ authenticated: true, member: { displayName: existing.displayName } });
    if (process.env.NODE_ENV !== 'development' && !(await getChatGPTUser())) {
      throw new ApiError(401, 'Sign in as the owner through ChatGPT to activate an application session.');
    }
    const member = await requireMember();
    const session = await newSession(member.id);
    await getDb().insert(sessions).values(session.row);
    return json(
      { authenticated: true, member: { displayName: member.displayName } },
      { headers: { 'Set-Cookie': session.cookie } },
    );
  } catch (error) { return errorResponse(error); }
}
