import { requireMember } from '@/lib/server/auth';
import { googleDriveConfigured } from '@/lib/server/google-drive';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireMember();
    return json({ configured: googleDriveConfigured(), mode: 'server-owned', authorization: 'application-acl', scope: 'drive.file' });
  } catch (error) { return errorResponse(error); }
}
