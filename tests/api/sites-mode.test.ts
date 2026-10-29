import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapResponse, signedIn } from '@/lib/contracts/account';
import { ORIGIN, sesjaZOdpowiedzi, startWorkera, stopWorkera, zapytaj, zbudujJesliTrzeba } from './harness';

// Tryb `sites`: przed workerem stoi OpenAI Sites i to platforma ustawia
// naglowki `oai-authenticated-user-*`. Tutaj zaufanie do nich jest zamierzone,
// wiec test pilnuje, zeby logowanie przez ChatGPT nadal dzialalo po
// wprowadzeniu trybu samodzielnego. Klucz wlasciciela jest ustawiony celowo:
// w tym trybie nie moze otwierac zadnych drzwi.

const KLUCZ = 'test-owner-setup-key-0123456789abcdef0123456789';
const ADRES_WLASCICIELA = 'owner@example.com';

beforeAll(async () => {
  zbudujJesliTrzeba();
  await startWorkera({
    zasiej: false,
    zmienne: { AUTH_MODE: 'sites', OWNER_SETUP_TOKEN: KLUCZ, OWNER_EMAIL: ADRES_WLASCICIELA },
  });
}, 300_000);

afterAll(() => {
  stopWorkera();
});

describe('tryb sites', () => {
  it('naglowki platformy zakladaja wlasciciela i wydaja sesje', async () => {
    const claim = await zapytaj('/api/auth/claim', {
      method: 'POST',
      headers: { ...ORIGIN, 'oai-authenticated-user-id': 'uzytkownik-chatgpt', 'oai-authenticated-user-email': ADRES_WLASCICIELA },
    });
    expect(claim.status).toBe(200);
    signedIn.parse(claim.dane);
    const sesja = sesjaZOdpowiedzi(claim);
    expect(sesja).not.toBeNull();

    const bootstrap = await zapytaj('/api/bootstrap', { headers: sesja! });
    expect(bootstrap.status).toBe(200);
    expect(bootstrapResponse.parse(bootstrap.dane).member.role).toBe('owner');
  });

  it('klucz wlasciciela jest wylaczony', async () => {
    const odp = await zapytaj('/api/auth/setup', {
      method: 'POST',
      headers: { ...ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: KLUCZ, displayName: 'Wlasciciel' }),
    });
    expect(odp.status).toBe(404);
    expect(sesjaZOdpowiedzi(odp)).toBeNull();
  });
});
