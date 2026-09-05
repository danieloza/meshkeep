import { env } from 'cloudflare:workers';
import { getDb } from '@/db';
import {
  appSettings,
  auditEvents,
  conversations,
  files,
  invites,
  memberLimits,
  members,
  providers,
  messages,
  projectMembers,
  projects,
  syncTokens,
  usageEvents,
} from '@/db/schema';
import { requireOwner } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export const BACKUP_FORMAT = 'meshkeep-backup';
export const BACKUP_VERSION = 1;

// Backup bazy D1. Świadome decyzje o tym, czego tu NIE ma:
//
// 1. Sesje pomijamy w całości — są krótkotrwałe, a odtworzenie ich z kopii
//    ożywiłoby ciasteczka, które w międzyczasie mogły wyciec.
// 2. Skróty tokenów zaproszeń i kluczy agenta są wycinane. Po odtworzeniu
//    owner wystawia nowe linki i klucze; stare mają nie działać.
// 3. Bajtów files z R2 tu nie ma — kopia zawiera ich metadane i sumy SHA-256,
//    żeby dało się sprawdzić, czego brakuje. To jest kopia BAZY, nie files,
//    i tak trzeba ją traktować.
export async function GET() {
  try {
    const owner = await requireOwner();
    const db = getDb();

    const [
      membersRows, memberLimitsRows, invitesRows, projectsRows, projectMembersRows,
      filesRows, conversationsRows, messagesRows, usageRows, settingsRows, auditRows, syncTokensRows, providersRows,
    ] = await Promise.all([
      db.select().from(members),
      db.select().from(memberLimits),
      db.select().from(invites),
      db.select().from(projects),
      db.select().from(projectMembers),
      db.select().from(files),
      db.select().from(conversations),
      db.select().from(messages),
      db.select().from(usageEvents),
      db.select().from(appSettings),
      db.select().from(auditEvents),
      db.select().from(syncTokens),
      db.select().from(providers),
    ]);

    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: { id: owner.id, displayName: owner.displayName },
      omitted: {
        sessions: 'intentionally omitted; sessions are short-lived and must not be restored from backup',
        providerKeys: 'stripped - after a restore reconnect each provider with its key',
        tokenHashes: 'excluded; issue new links and agent keys after restoring',
        r2Bytes: 'outside this backup; it contains file metadata and SHA-256 checksums only',
      },
      tables: {
        members: membersRows,
        memberLimits: memberLimitsRows,
        // Bez `tokenHash`: odtworzone zaproszenie ma być martwe.
        invites: invitesRows.map(({ tokenHash: _tokenHash, ...row }) => row),
        // Tak samo klucze agenta: zostaje nazwa urządzenia i daty, sam klucz nie.
        syncTokens: syncTokensRows.map(({ tokenHash: _tokenHash, ...row }) => row),
        // Same treatment as the token hashes: the provider key is the one
        // secret this application stores itself, and a backup file travels.
        // The address and label survive so a restore only needs the key.
        providers: providersRows.map(({ apiKeyCiphertext: _apiKeyCiphertext, ...row }) => row),
        projects: projectsRows,
        projectMembers: projectMembersRows,
        files: filesRows,
        conversations: conversationsRows,
        messages: messagesRows,
        usageEvents: usageRows,
        appSettings: settingsRows,
        auditEvents: auditRows,
      },
      counts: {
        members: membersRows.length,
        projects: projectsRows.length,
        files: filesRows.length,
        conversations: conversationsRows.length,
        messages: messagesRows.length,
        usageEvents: usageRows.length,
        auditEvents: auditRows.length,
      },
    };

    await recordAudit({
      actorId: owner.id,
      actorLabel: owner.displayName,
      action: 'backup.exported',
      targetType: 'settings',
      detail: { projects: projectsRows.length, messages: messagesRows.length, files: filesRows.length },
    });

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'Cache-Control': 'no-store, private',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="meshkeep-backup-${stamp}.json"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) { return errorResponse(error); }
}

// Manifest obiektów w R2 — pozwala sprawdzić, czy magazyn files zgadza się
// z tym, co widzi baza, i czego brakowałoby po odtworzeniu.
export async function POST() {
  try {
    await requireOwner();
    const db = getDb();
    const known = await db.select({ objectKey: files.objectKey, relativePath: files.relativePath, sizeBytes: files.sizeBytes, sha256: files.sha256 }).from(files);
    const listed = await env.FILES.list({ limit: 1000 });
    const storedKeys = new Set(listed.objects.map((object) => object.key));
    const knownKeys = new Set(known.map((row) => row.objectKey));
    return json({
      checkedAt: new Date().toISOString(),
      truncated: listed.truncated,
      inDatabase: known.length,
      inStorage: listed.objects.length,
      // Wiersz w bazie bez obiektu w R2 to plik nie do pobrania.
      missingInStorage: known.filter((row) => !storedKeys.has(row.objectKey)).map((row) => row.relativePath),
      // Obiekt bez wiersza to śmieć zajmujący miejsce.
      orphanInStorage: listed.objects.filter((object) => !knownKeys.has(object.key)).map((object) => object.key),
    });
  } catch (error) { return errorResponse(error); }
}
