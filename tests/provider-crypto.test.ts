import { describe, expect, it } from 'vitest';
import {
  decryptProviderKey,
  encryptProviderKey,
  providerKeyEncryptionConfigured,
} from '@/lib/provider-crypto';

const SECRET = 'test-only-provider-encryption-secret-32-chars';

describe('provider key encryption', () => {
  it('round-trips a key without storing it in the ciphertext', async () => {
    const apiKey = 'provider-test-key-that-must-stay-secret';
    const encrypted = await encryptProviderKey(apiKey, SECRET);

    expect(encrypted).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]+$/);
    expect(encrypted).not.toContain(apiKey);
    await expect(decryptProviderKey(encrypted, SECRET)).resolves.toBe(apiKey);
  });

  it('uses a fresh IV for every write', async () => {
    const first = await encryptProviderKey('same-key', SECRET);
    const second = await encryptProviderKey('same-key', SECRET);
    expect(first).not.toBe(second);
  });

  it('fails closed with a different secret or malformed value', async () => {
    const encrypted = await encryptProviderKey('same-key', SECRET);
    await expect(decryptProviderKey(encrypted, `${SECRET}-different`)).rejects.toThrow(/could not be decrypted/i);
    await expect(decryptProviderKey('plain-text-key', SECRET)).rejects.toThrow(/malformed/i);
  });

  it('requires a deployment secret with at least 32 characters', () => {
    expect(providerKeyEncryptionConfigured(undefined)).toBe(false);
    expect(providerKeyEncryptionConfigured('too-short')).toBe(false);
    expect(providerKeyEncryptionConfigured(SECRET)).toBe(true);
  });
});
