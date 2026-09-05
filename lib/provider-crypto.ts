const FORMAT_VERSION = 'v1';
const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error('The encrypted provider key is malformed.');
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new Error('PROVIDER_KEY_ENCRYPTION_KEY must contain at least 32 characters.');
  }
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function providerKeyEncryptionConfigured(secret: string | undefined): boolean {
  return Boolean(secret && secret.trim().length >= MIN_SECRET_LENGTH);
}

export async function encryptProviderKey(apiKey: string, secret: string): Promise<string> {
  const key = await importEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(apiKey));
  return `${FORMAT_VERSION}:${toHex(iv)}:${toHex(new Uint8Array(encrypted))}`;
}

export async function decryptProviderKey(value: string, secret: string): Promise<string> {
  const [version, ivHex, ciphertextHex, extra] = value.split(':');
  if (version !== FORMAT_VERSION || !ivHex || !ciphertextHex || extra !== undefined) {
    throw new Error('The encrypted provider key is malformed.');
  }
  const key = await importEncryptionKey(secret);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(fromHex(ivHex)) },
      key,
      toArrayBuffer(fromHex(ciphertextHex)),
    );
    return decoder.decode(decrypted);
  } catch {
    throw new Error('The provider key could not be decrypted. Check PROVIDER_KEY_ENCRYPTION_KEY.');
  }
}
