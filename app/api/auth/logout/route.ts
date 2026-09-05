import { assertSameOrigin, errorResponse, json } from '@/lib/server/http';
import { revokeCurrentSession } from '@/lib/server/session';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const cookie = await revokeCurrentSession();
    return json({ authenticated: false }, { headers: { 'Set-Cookie': cookie } });
  } catch (error) { return errorResponse(error); }
}
