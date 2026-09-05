import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { files } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { assertSameOrigin, errorResponse, json } from '@/lib/server/http';
import { requireProjectAccess } from '@/lib/server/projects';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await context.params;
    const [file] = await getDb().select().from(files).where(eq(files.id, id)).limit(1);
    if (!file) return json({ error: 'File not found.' }, { status: 404 });
    await requireProjectAccess(member, file.projectId, 'read');
    const object = await env.FILES.get(file.objectKey);
    if (!object) return json({ error: 'The file does not exist in storage.' }, { status: 404 });
    const safeName = file.name.replaceAll('"', '').replace(/[\r\n]/g, '').slice(0, 150) || 'download';
    return new Response(object.body, { headers: { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${safeName}"`, 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return errorResponse(error); }
}

// Kasowanie pojedynczego pliku. Do tej pory jedynym sposobem na usunięcie
// czegokolwiek z chmury było skasowanie CAŁEGO projektu — więc plik wciągnięty
// przez agenta przez pomyłkę zostawał tam na zawsze.
//
// Uprawnienie to `edit`, czyli dokładnie to samo, co wysyłka pliku. Nie jest to
// przeoczenie: wysyłka pliku o tej samej ścieżce już dziś kasuje cudzy wiersz i
// cudzy obiekt z R2 (patrz `projects/[id]/files/route.ts`). Zdolność niszczenia
// istnieje więc od dawna — ten endpoint tylko przestaje ją ukrywać. Zawężenie
// kasowania do autora wysyłki przy jednoczesnym pozostawieniu nadpisywania
// każdemu edytorowi byłoby niespójne i dawałoby złudzenie ochrony.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const { id } = await context.params;
    const db = getDb();
    const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1);
    if (!file) return json({ error: 'File not found.' }, { status: 404 });
    await requireProjectAccess(member, file.projectId, 'edit');

    // Kolejność jest celowa: najpierw baza, potem magazyn. Odwrotna zostawiałaby
    // przy awarii wiersz bez obiektu, czyli plik widoczny w aplikacji, którego
    // nie da się pobrać. W tę stronę najgorszy przypadek to osierocony obiekt w
    // R2 — niewidoczny dla nikogo i wyłapywany przez „Verify file consistency”.
    await db.delete(files).where(eq(files.id, id));
    await env.FILES.delete(file.objectKey).catch((error: unknown) => {
      console.error('Could not delete the object from storage:', file.objectKey, error instanceof Error ? error.message : 'unknown error');
    });

    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'file.deleted',
      targetType: 'file',
      targetId: id,
      targetLabel: file.relativePath,
      detail: { bajtow: file.sizeBytes, projekt: file.projectId },
    });
    return json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
