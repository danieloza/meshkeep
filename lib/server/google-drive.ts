import 'server-only';

import { env } from 'cloudflare:workers';
import { ApiError } from './http';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size';

export function googleDriveConfigured() {
  return Boolean(env.GOOGLE_DRIVE_CLIENT_ID && env.GOOGLE_DRIVE_CLIENT_SECRET && env.GOOGLE_DRIVE_REFRESH_TOKEN);
}

async function accessToken() {
  if (!googleDriveConfigured()) throw new ApiError(503, 'Google Drive has not been configured.');
  const body = new URLSearchParams({ client_id: env.GOOGLE_DRIVE_CLIENT_ID!, client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET!, refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN!, grant_type: 'refresh_token' });
  // `redirect: 'manual'`, a nie `'error'` - workerd tego drugiego nie
  // implementuje. Gwarancja zostaje ta sama, bo `!response.ok` odrzuca 3xx.
  const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000), redirect: 'manual' });
  if (!response.ok) throw new ApiError(502, 'Could not refresh Google Drive access.');
  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== 'string') throw new ApiError(502, 'Google returned an invalid access token.');
  return payload.access_token;
}

export async function createDriveFolder(name: string, parentId?: string) {
  const token = await accessToken();
  const targetParent = parentId ?? env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const response = await fetch(GOOGLE_FILES_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ name: name.slice(0, 100), mimeType: 'application/vnd.google-apps.folder', ...(targetParent ? { parents: [targetParent] } : {}) }), signal: AbortSignal.timeout(20_000), redirect: 'manual' });
  if (!response.ok) throw new ApiError(502, 'Could not create the Google Drive folder.');
  const result = (await response.json()) as { id?: unknown };
  if (typeof result.id !== 'string') throw new ApiError(502, 'Google Drive did not return a folder ID.');
  return result.id;
}

export async function uploadDriveFile(input: { name: string; parentId: string; bytes: ArrayBuffer; mimeType: string }) {
  const token = await accessToken();
  const boundary = `meshkeep-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const metadata = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: input.name.slice(0, 150), parents: [input.parentId] })}\r\n--${boundary}\r\nContent-Type: ${input.mimeType || 'application/octet-stream'}\r\n\r\n`);
  const ending = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(metadata.byteLength + input.bytes.byteLength + ending.byteLength);
  body.set(metadata, 0); body.set(new Uint8Array(input.bytes), metadata.byteLength); body.set(ending, metadata.byteLength + input.bytes.byteLength);
  const response = await fetch(GOOGLE_UPLOAD_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}`, Accept: 'application/json' }, body, signal: AbortSignal.timeout(30_000), redirect: 'manual' });
  if (!response.ok) throw new ApiError(502, 'Could not upload the file to Google Drive.');
  return (await response.json()) as { id: string; name: string; size?: string };
}
