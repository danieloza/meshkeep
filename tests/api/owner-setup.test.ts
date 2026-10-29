import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, sesjaZOdpowiedzi, startWorkera, stopWorkera, zapytaj, zbudujJesliTrzeba } from './harness';

// Tryb samodzielny, czyli instalacja poza OpenAI Sites. Nikt tu nie ustawia
// naglowkow `oai-authenticated-user-*`, wiec kazdy, kto je wysle, sam je sobie
// wymyslil. Worker startuje bez zasiewu: na pustej bazie sprawdzamy, jak
// powstaje pierwszy wlasciciel i czy da sie go podrobic.
//
// OWNER_EMAIL jest ustawiony celowo. To najgorszy przypadek: adres wlasciciela
// bywa publiczny, a dawniej wystarczylo go podac w naglowku.

const KLUCZ = 'test-owner-setup-key-0123456789abcdef0123456789';
const ADRES_WLASCICIELA = 'owner@example.com';

const podrobionaTozsamosc = {
  'oai-authenticated-user-id': 'podrobiony-uzytkownik',
  'oai-authenticated-user-email': ADRES_WLASCICIELA,
};

function zalozenie(token: string, naglowki: Record<string, string> = ORIGIN) {
  return zapytaj('/api/auth/setup', {
    method: 'POST',
    headers: { ...naglowki, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, displayName: 'Wlasciciel' }),
  });
}

beforeAll(async () => {
  zbudujJesliTrzeba();
  await startWorkera({ zasiej: false, zmienne: { OWNER_SETUP_TOKEN: KLUCZ, OWNER_EMAIL: ADRES_WLASCICIELA } });
}, 300_000);

afterAll(() => {
  stopWorkera();
});

describe('tryb samodzielny: naglowki platformy', () => {
  it('podrobione naglowki oai nie daja tozsamosci ani sesji', async () => {
    const claim = await zapytaj('/api/auth/claim', { method: 'POST', headers: { ...ORIGIN, ...podrobionaTozsamosc } });
    expect(claim.status).toBe(401);
    expect(sesjaZOdpowiedzi(claim)).toBeNull();

    const bootstrap = await zapytaj('/api/bootstrap', { headers: podrobionaTozsamosc });
    expect(bootstrap.status).toBe(401);
  });
});

describe('tryb samodzielny: klucz wlasciciela', () => {
  it('odrzuca zadanie z obcego originu', async () => {
    const odp = await zalozenie(KLUCZ, { Origin: 'https://obcy.example' });
    expect(odp.status).toBe(403);
  });

  it('odrzuca klucz w zlym formacie i bledny klucz', async () => {
    expect((await zalozenie('za-krotki')).status).toBe(400);
    const bledny = await zalozenie(`${KLUCZ.slice(0, -1)}x`);
    expect(bledny.status).toBe(401);
    expect(sesjaZOdpowiedzi(bledny)).toBeNull();
  });

  it('poprawny klucz zaklada pierwszego wlasciciela i wydaje sesje', async () => {
    const odp = await zalozenie(KLUCZ);
    // Na Windowsie wrangler potrafi zerwac zadanie. Czasem pierwsza proba
    // zdazyla zalozyc konto i powtorka dostaje 200 (odzyskanie), a czasem
    // handler w ogole sie nie wykonal i powtorka zaklada konto (201). Bez
    // ponowienia musi byc 201. To, ze wlasciciel jest dokladnie jeden, a
    // dziennik ma wpis o zalozeniu, sprawdzaja kolejne testy.
    if (odp.ponowienia === 0) expect(odp.status).toBe(201);
    else expect([200, 201]).toContain(odp.status);
    const sesja = sesjaZOdpowiedzi(odp);
    expect(sesja).not.toBeNull();

    const bootstrap = await zapytaj('/api/bootstrap', { headers: sesja! });
    expect(bootstrap.status).toBe(200);
    expect((bootstrap.dane.member as { role: string }).role).toBe('owner');
  });

  it('ponowne uzycie klucza przywraca dostep temu samemu wlascicielowi', async () => {
    const pierwsza = sesjaZOdpowiedzi(await zalozenie(KLUCZ));
    const kto = await zapytaj('/api/bootstrap', { headers: pierwsza! });
    const idPierwszego = (kto.dane.member as { id: string }).id;

    const ponowna = await zalozenie(KLUCZ);
    expect(ponowna.status).toBe(200);
    const druga = sesjaZOdpowiedzi(ponowna);
    const ponownie = await zapytaj('/api/bootstrap', { headers: druga! });
    expect((ponownie.dane.member as { id: string }).id).toBe(idPierwszego);

    // Drugie konto wlasciciela nie powstalo: w zespole jest jedna osoba.
    const zespol = await zapytaj('/api/team', { headers: druga! });
    expect(zespol.status).toBe(200);
    expect((zespol.dane.members as unknown[]).length).toBe(1);
  });

  it('dziennik zapisuje zalozenie i odzyskanie dostepu', async () => {
    const sesja = sesjaZOdpowiedzi(await zalozenie(KLUCZ));
    const dziennik = await zapytaj('/api/admin/audit', { headers: sesja! });
    expect(dziennik.status).toBe(200);
    const akcje = (dziennik.dane.events as Array<{ action: string }>).map((e) => e.action);
    expect(akcje).toContain('owner.setup');
    expect(akcje).toContain('owner.recovered');
  });
});
