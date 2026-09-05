import { env } from 'cloudflare:workers';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { appSettings, files, projects } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { requireProjectAccess } from '@/lib/server/projects';
import { requireSyncToken } from '@/lib/server/session';
import { uploadDriveFile } from '@/lib/server/google-drive';
import {
  contentMatchesExtension,
  isAllowedUpload,
  MAX_FILES,
  MAX_REQUEST_BYTES,
  safeRelativePath,
  UnsafePathError,
} from '@/lib/file-guards';

export const dynamic = 'force-dynamic';

// Reguły ścieżek i typów siedzą w `lib/file-guards.ts`, żeby dało się je pokryć
// testami bez środowiska Workers. Tutaj zostaje wyłącznie tłumaczenie odrzucenia
// na komunikat HTTP.
function checkedRelativePath(value: string) {
  try {
    return safeRelativePath(value);
  } catch (error) {
    if (error instanceof UnsafePathError) {
      throw error.reason === 'invalid'
        ? new ApiError(400, 'The file path is invalid.')
        : new ApiError(415, `File “${error.fileName.slice(0, 100)}” appears to contain a secret, credentials or a technical file and will not be uploaded.`);
    }
    throw error;
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await context.params;
    await requireProjectAccess(member, id, 'read');
    const rows = await getDb().select({ id: files.id, relativePath: files.relativePath, name: files.name, mimeType: files.mimeType, sizeBytes: files.sizeBytes, sha256: files.sha256, createdAt: files.createdAt }).from(files).where(eq(files.projectId, id)).orderBy(desc(files.createdAt));
    return json({ files: rows });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const storedKeys: string[] = [];
  try {
    const syncRequest = request.headers.get('authorization')?.startsWith('Bearer ') === true;
    if (!syncRequest) assertSameOrigin(request);
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_REQUEST_BYTES) throw new ApiError(413, 'An import can be up to 50 MB.');
    const member = syncRequest ? await requireSyncToken(request) : await requireMember();
    const { id } = await context.params;
    const access = await requireProjectAccess(member, id, 'edit');
    // Przełącznik synchronizacji był dotąd honorowany wyłącznie przez skrypt
    // agenta. Egzekwujemy go po stronie serwera, żeby „wyłączona” naprawdę
    // znaczyło wyłączona — także dla przerobionego albo starego agenta.
    if (syncRequest) {
      const [setting] = await getDb().select().from(appSettings).where(eq(appSettings.key, `context_sync:${member.id}`)).limit(1);
      if (setting?.value !== 'on') throw new ApiError(403, 'Folder sync is disabled in the dashboard.');
    }
    let form: FormData;
    try { form = await request.formData(); } catch { throw new ApiError(400, 'Invalid file form.'); }
    const uploaded = form.getAll('files').filter((entry): entry is File => entry instanceof File);
    if (!uploaded.length || uploaded.length > MAX_FILES) throw new ApiError(400, 'Select between 1 and 100 files.');
    let paths: unknown = [];
    const pathsValue = form.get('paths');
    try { paths = JSON.parse(typeof pathsValue === 'string' ? pathsValue : '[]'); } catch { throw new ApiError(400, 'Invalid path list.'); }
    if (!Array.isArray(paths) || paths.length !== uploaded.length || !paths.every((path) => typeof path === 'string')) throw new ApiError(400, 'The path list does not match the files.');
    const total = uploaded.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_REQUEST_BYTES) throw new ApiError(413, 'An import can be up to 50 MB.');

    const rows = [];
    for (let index = 0; index < uploaded.length; index += 1) {
      const file = uploaded[index];
      const relativePath = checkedRelativePath(paths[index] as string);
      if (!isAllowedUpload(relativePath, file.size)) throw new ApiError(415, `File “${file.name.slice(0, 100)}” has a disallowed type or size.`);
      const bytes = await file.arrayBuffer();
      const byteView = new Uint8Array(bytes);
      if (!contentMatchesExtension(relativePath, byteView)) throw new ApiError(415, `The contents of “${file.name.slice(0, 100)}” do not match its extension.`);
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('');
      const objectKey = `projects/${id}/${crypto.randomUUID()}`;
      await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: 'application/octet-stream' }, customMetadata: { sha256: hash } });
      if (access.project.storageProvider === 'google_drive' && access.project.driveFolderId) {
        await uploadDriveFile({ name: relativePath, parentId: access.project.driveFolderId, bytes, mimeType: file.type || 'application/octet-stream' });
      }
      storedKeys.push(objectKey);
      rows.push({ id: crypto.randomUUID(), projectId: id, uploadedBy: member.id, objectKey, relativePath, name: relativePath.split('/').at(-1) ?? file.name, mimeType: file.type || 'application/octet-stream', sizeBytes: file.size, sha256: hash, createdAt: new Date() });
    }
    const db = getDb();
    // Zastępowanie pliku o tej samej ścieżce dotyczyło wcześniej tylko agenta,
    // więc ponowny import tego samego folderu z przeglądarki mnożył wiersze.
    const existing = await db
      .select({ id: files.id, objectKey: files.objectKey })
      .from(files)
      .where(and(eq(files.projectId, id), inArray(files.relativePath, rows.map((row) => row.relativePath))));
    if (existing.length) {
      await db.batch([
        db.delete(files).where(inArray(files.id, existing.map((row) => row.id))),
        db.insert(files).values(rows),
        db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id)),
      ]);
    } else {
      await db.batch([
        db.insert(files).values(rows),
        db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id)),
      ]);
    }
    if (existing.length) await Promise.allSettled(existing.map((row) => env.FILES.delete(row.objectKey)));
    return json({ files: rows.map(({ objectKey: _objectKey, uploadedBy: _uploadedBy, ...row }) => row) }, { status: 201 });
  } catch (error) {
    await Promise.allSettled(storedKeys.map((key) => env.FILES.delete(key)));
    return errorResponse(error);
  }
}

// --- Propagacja kasowania z agenta -----------------------------------------
//
// Agent trzyma u siebie listę ścieżek, które sam wysłał, i przysyła tu te,
// które zniknęły z dysku. Kasujemy WYŁĄCZNIE wskazane ścieżki — nigdy „wszystko
// czego nie ma w manifeście”. Dzięki temu pliki wgrane z przeglądarki są poza
// zasięgiem agenta, bo nigdy nie było ich w jego stanie.
//
// Sufit poniżej jest po stronie serwera, a nie tylko w skrypcie, bo skrypt leży
// na cudzym dysku i można go zmienić. Chroni przed najczęstszą awarią narzędzi
// synchronizujących: katalog przestaje być widoczny (odmontowany dysk, zmieniona
// litera, brak uprawnień), agent uznaje, że skasowano wszystko, i czyści projekt.
const MAX_PRUNE_PATHS = 200;
// Poniżej tego progu nie ma czego chronić — skasowanie 3 z 4 files to normalna
// praca, a nie awaria.
const PRUNE_FLOOR = 10;
const MAX_PRUNE_SHARE = 0.5;

const pruneSchema = z.object({
  paths: z.array(z.string().min(1).max(400)).min(1).max(MAX_PRUNE_PATHS),
});

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const syncRequest = request.headers.get('authorization')?.startsWith('Bearer ') === true;
    if (!syncRequest) assertSameOrigin(request);
    const member = syncRequest ? await requireSyncToken(request) : await requireMember();
    const { id } = await context.params;
    const access = await requireProjectAccess(member, id, 'edit');

    // Ten sam przełącznik, co przy wysyłce. Wyłączona synchronizacja ma znaczyć
    // wyłączona także dla operacji niszczących.
    if (syncRequest) {
      const [setting] = await getDb().select().from(appSettings).where(eq(appSettings.key, `context_sync:${member.id}`)).limit(1);
      if (setting?.value !== 'on') throw new ApiError(403, 'Folder sync is disabled in the dashboard.');
    }

    // Domyslny limit readJson to 64 kB, a 200 sciezek po 400 znakow to ~82 kB —
    // bez tego zadanie na gornej granicy schematu odbijaloby sie od 413 zamiast
    // przejsc walidacje. Limity musza sie zgadzac, inaczej jeden z nich klamie.
    const { paths } = pruneSchema.parse(await readJson(request, 128_000));
    const db = getDb();
    const unique = [...new Set(paths)];
    const matched = await db
      .select({ id: files.id, objectKey: files.objectKey, relativePath: files.relativePath })
      .from(files)
      .where(and(eq(files.projectId, id), inArray(files.relativePath, unique)));
    if (!matched.length) return json({ deleted: 0, notFound: unique.length });

    const [{ value: total }] = await db.select({ value: count() }).from(files).where(eq(files.projectId, id));
    if (matched.length > PRUNE_FLOOR && matched.length > total * MAX_PRUNE_SHARE) {
      throw new ApiError(
        409,
        `The agent requested deletion of ${matched.length} of ${total} project files. This looks like a missing folder rather than intentional deletion, so the request was rejected. Delete the files in the dashboard or remove the entire project if this is intentional.`,
      );
    }

    // Baza przed magazynem — jak przy kasowaniu pojedynczego pliku.
    await db.delete(files).where(inArray(files.id, matched.map((row) => row.id)));
    await Promise.allSettled(matched.map((row) => env.FILES.delete(row.objectKey)));
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id));

    // Jedno event na przebieg, nie jedno na plik. Dziennik pokazuje ostatnie
    // 200 events, więc jeden przebieg agenta wypchnąłby z widoku wszystko inne —
    // dziennik straciłby to, po co istnieje. Ścieżki pojedynczych files zapisuje
    // kasowanie z panelu.
    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'file.pruned',
      targetType: 'project',
      targetId: id,
      targetLabel: access.project.name,
      detail: { plikow: matched.length, zrodlo: syncRequest ? 'agent' : 'panel', przykladowy_plik: matched[0].relativePath },
    });
    return json({ deleted: matched.length, notFound: unique.length - matched.length });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: `The path list is invalid or longer than ${MAX_PRUNE_PATHS} entries.` }, { status: 400 });
    return errorResponse(error);
  }
}
