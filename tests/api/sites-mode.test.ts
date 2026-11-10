import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapResponse, signedIn } from '@/lib/contracts/account';
import { apiError } from '@/lib/contracts/common';
import { ORIGIN, sesjaZOdpowiedzi, startWorkera, stopWorkera, zapytaj, zbudujJesliTrzeba } from './harness';

// Tryb `sites`: przed workerem stoi OpenAI Sites i to platforma ustawia
// naglowki `oai-authenticated-user-*`. Tutaj zaufanie do nich jest zamierzone,
// wiec test pilnuje, zeby logowanie przez ChatGPT nadal dzialalo po
// wprowadzeniu trybu samodzielnego. Klucz wlasciciela jest ustawiony celowo:
// w tym trybie nie moze otwierac zadnych drzwi.

const KLUCZ = 'test-owner-setup-key-0123456789abcdef0123456789';
const ADRES_WLASCICIELA = 'owner@example.com';
// Sesja wlasciciela z testu, ktory go zaklada; kolejne testy z niej korzystaja.
let sesjaWlasciciela: Record<string, string> = {};

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
  // Najpierw, przy pustej bazie: tak wygladala produkcja, na ktorej wlasciciel
  // logowal sie kontem innym niz to z konfiguracji. Ekran braku dostepu
  // pokazuje ten komunikat, wiec test go przypina.
  it('inne konto ChatGPT przy pustej bazie dostaje 403 z powodem i nie zostaje wlascicielem', async () => {
    const obcy = { ...ORIGIN, 'oai-authenticated-user-id': 'inne-konto-chatgpt', 'oai-authenticated-user-email': 'someone@example.com' };
    const odp = await zapytaj('/api/bootstrap', { headers: obcy });
    expect(odp.status).toBe(403);
    expect(apiError.parse(odp.dane).error).toBe('No active invitation exists for this cloud.');
    expect(sesjaZOdpowiedzi(odp)).toBeNull();
  });

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
    const { member } = bootstrapResponse.parse(bootstrap.dane);
    expect(member.role).toBe('owner');
    // Bez imienia od platformy: zwykle „Owner”, nie dawne „Demo Owner” i nie
    // adres e-mail, ktory moze byc ukrytym adresem przekaznikowym.
    expect(member.displayName).toBe('Owner');
    sesjaWlasciciela = sesja!;
  });

  // Wlasciciel na produkcji powstal jako „Demo Owner”, a w aplikacji nie ma
  // gdzie zmienic nazwy. Imie z platformy przychodzi przy logowaniu, czyli przy
  // `claim`, ktory panel wola przy kazdym wczytaniu, takze z istniejaca sesja.
  it('imie z platformy zastepuje nazwe przy logowaniu, tylko dla tego samego konta', async () => {
    const imie = (nazwa: string) => ({ 'oai-authenticated-user-full-name': encodeURIComponent(nazwa), 'oai-authenticated-user-full-name-encoding': 'percent-encoded-utf-8' });
    const nazwa = async () => bootstrapResponse.parse((await zapytaj('/api/bootstrap', { headers: sesjaWlasciciela })).dane).member.displayName;

    // Cudze konto z ta sama sesja niczego nie zmienia.
    const obcy = await zapytaj('/api/auth/claim', { method: 'POST', headers: { ...ORIGIN, ...sesjaWlasciciela, 'oai-authenticated-user-id': 'inne-konto-chatgpt', 'oai-authenticated-user-email': 'someone@example.com', ...imie('Ktos Inny') } });
    expect(obcy.status).toBe(200);
    expect(await nazwa()).toBe('Owner');

    const swoj = await zapytaj('/api/auth/claim', { method: 'POST', headers: { ...ORIGIN, ...sesjaWlasciciela, 'oai-authenticated-user-id': 'uzytkownik-chatgpt', 'oai-authenticated-user-email': ADRES_WLASCICIELA, ...imie('Łucja Żółkiewska') } });
    expect(swoj.status).toBe(200);
    expect(signedIn.parse(swoj.dane).member.displayName).toBe('Łucja Żółkiewska');
    expect(await nazwa()).toBe('Łucja Żółkiewska');
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
