import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deletedResponse } from '@/lib/contracts/common';
import { allConversations, conversationDetail, projectConversations } from '@/lib/contracts/conversations';
import { fileSuggestions, indexRound, projectFiles } from '@/lib/contracts/files';
import { searchResults } from '@/lib/contracts/search';
import { MARK_START } from '@/lib/search';
import { ID, ORIGIN, TOKENY, jako, startWorkera, stopWorkera, zapytaj, zbudujJesliTrzeba } from './harness';

// Wyszukiwanie i podpowiedzi plikow na zbudowanym workerze. Najwazniejsza
// regula: wynik nigdy nie pokazuje tresci z projektu, do ktorego pytajacy nie
// ma dostepu. Kazdy test odmowy ma obok test, ze ta sama tresc jest widoczna
// dla kogos uprawnionego - inaczej pusty wynik niczego by nie dowodzil.

const t = Date.now();
const wiadomosc = (id: string, rozmowa: string, autor: string, tresc: string) =>
  `INSERT INTO messages (id,conversation_id,member_id,role,content,created_at) VALUES ('${id}','${rozmowa}','${autor}','user','${tresc}',${t});`;

// Rozmowa dluzsza niz limit historii (200): wiadomosci 1..205, kazda o
// milisekunde pozniej od poprzedniej.
const DLUGA_ROZMOWA = crypto.randomUUID();
const DLUGOSC = 205;
// Projekt z kopia na Dysku Google. W testach Dysk nie jest skonfigurowany, wiec
// wysylka pada juz po zapisie do R2 - dokladnie tam, gdzie zostawal sierota.
const PROJEKT_NA_DYSKU = crypto.randomUUID();

const DODATKOWE_WIADOMOSCI = [
  wiadomosc('w-1', ID.rozmowaWlasciciela, ID.wlasciciel, 'Plan migracji bazy na wiosnę'),
  wiadomosc('w-2', ID.rozmowaObcego, ID.obcy, 'Tajny plan migracji obcego'),
  wiadomosc('w-3', ID.rozmowaKasowanaPrzezAutora, ID.edytor, 'Notatka o kolibrach do usunięcia'),
  wiadomosc('w-4', ID.rozmowaZespolowa, ID.obcy, 'Harmonogram dyżurów całego zespołu'),
  wiadomosc('w-5', ID.rozmowaObcego, ID.obcy, 'Prywatny harmonogram obcego'),
  `INSERT INTO conversations (id,project_id,created_by,title,created_at,updated_at) VALUES ('${DLUGA_ROZMOWA}','${ID.projektWspolny}','${ID.wlasciciel}','Dluga rozmowa',${t},${t});`,
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${DLUGOSC}) INSERT INTO messages (id,conversation_id,member_id,role,content,created_at) SELECT 'dluga-' || i, '${DLUGA_ROZMOWA}', '${ID.wlasciciel}', 'user', 'Wpis numer ' || i, ${t} + i FROM n;`,
  `INSERT INTO projects (id,owner_id,name,description,visibility,storage_provider,drive_folder_id,created_at,updated_at) VALUES ('${PROJEKT_NA_DYSKU}','${ID.wlasciciel}','Projekt na Dysku','','private','google_drive','folder-testowy',${t},${t});`,
].join('\n');

function wyslij(token: string, projekt: string, pliki: Array<{ sciezka: string; tresc: string }>) {
  const formularz = new FormData();
  for (const plik of pliki) formularz.append('files', new File([plik.tresc], plik.sciezka.split('/').pop()!, { type: 'text/plain' }));
  formularz.append('paths', JSON.stringify(pliki.map((plik) => plik.sciezka)));
  return zapytaj(`/api/projects/${projekt}/files`, { method: 'POST', headers: { ...ORIGIN, ...jako(token) }, body: formularz });
}

async function szukaj(token: string, fraza: string, projekt?: string) {
  const parametry = new URLSearchParams({ q: fraza, ...(projekt ? { projectId: projekt } : {}) });
  const odp = await zapytaj(`/api/search?${parametry}`, { headers: jako(token) });
  expect(odp.status, odp.tekst).toBe(200);
  return searchResults.parse(odp.dane);
}

function indeksuj(token: string, projekt: string) {
  return zapytaj(`/api/projects/${projekt}/search-index`, { method: 'POST', headers: { ...ORIGIN, ...jako(token) } });
}

let plikWdrozenia = '';

beforeAll(async () => {
  zbudujJesliTrzeba();
  await startWorkera({ dodatkowySql: DODATKOWE_WIADOMOSCI });
  const odp = await wyslij(TOKENY.wlasciciel, ID.projektWspolny, [{ sciezka: 'docs/wdrozenie.md', tresc: 'Agent synchronizacji działa co pięć minut. Żółw jest maskotką projektu.' }]);
  plikWdrozenia = projectFiles.parse(odp.dane).files[0].id;
}, 300_000);

afterAll(() => {
  stopWorkera();
});

describe('wysylka wielu plikow naraz', () => {
  it('przyjmuje import kilkunastu plikow w jednym zadaniu', async () => {
    // D1 przyjmuje najwyzej 100 parametrow na instrukcje. Wiersz pliku ma
    // dziesiec kolumn, wiec jeden INSERT na wszystkie pekal na jedenastym
    // pliku - a folder albo agent wysyla ich do 100.
    const pliki = Array.from({ length: 12 }, (_, i) => ({ sciezka: `import/plik-${i}.txt`, tresc: `zawartosc ${i}` }));
    const odp = await wyslij(TOKENY.wlasciciel, ID.projektWspolny, pliki);
    expect(odp.status, odp.tekst).toBe(201);
    expect(projectFiles.parse(odp.dane).files.length).toBe(12);
  });
});

describe('wyszukiwanie w plikach', () => {
  it('tekst wyslanego pliku jest od razu do znalezienia, z podswietleniem', async () => {
    const wyniki = await szukaj(TOKENY.wlasciciel, 'synchronizacji');
    const trafienie = wyniki.files.find((plik) => plik.fileId === plikWdrozenia);
    expect(trafienie?.path).toBe('docs/wdrozenie.md');
    expect(trafienie?.snippet).toContain(MARK_START);
  });

  it('znajduje polskie slowo wpisane bez znakow diakrytycznych, takze z l zamiast ł', async () => {
    const wyniki = await szukaj(TOKENY.wlasciciel, 'zolw piec');
    expect(wyniki.files.map((plik) => plik.fileId)).toContain(plikWdrozenia);
  });

  it('czlonek projektu widzi plik, a osoba spoza projektu nie', async () => {
    expect((await szukaj(TOKENY.czytelnik, 'synchronizacji')).files.map((plik) => plik.fileId)).toContain(plikWdrozenia);
    expect((await szukaj(TOKENY.obcy, 'synchronizacji')).files.map((plik) => plik.fileId)).not.toContain(plikWdrozenia);
  });

  it('pliki sprzed indeksu sa liczone, a runda indeksowania je dolacza', async () => {
    // Zasiane pliki trafily do bazy z pominieciem wysylki, jak pliki sprzed
    // tej funkcji. Nie da sie ich znalezc, dopoki runda ich nie zindeksuje.
    const przed = await szukaj(TOKENY.wlasciciel, 'tresc', ID.projektWspolny);
    expect(przed.unindexedFiles).toBeGreaterThan(0);
    expect(przed.files.map((plik) => plik.fileId)).not.toContain(ID.plikWspolny);

    let pozostalo = Infinity;
    for (let runda = 0; runda < 10 && pozostalo > 0; runda += 1) {
      const odp = await indeksuj(TOKENY.wlasciciel, ID.projektWspolny);
      expect(odp.status, odp.tekst).toBe(200);
      pozostalo = indexRound.parse(odp.dane).remaining;
    }
    const po = await szukaj(TOKENY.wlasciciel, 'tresc', ID.projektWspolny);
    expect(po.unindexedFiles).toBe(0);
    expect(po.files.map((plik) => plik.fileId)).toContain(ID.plikWspolny);
  });

  it('cudzy projekt prywatny: nie da sie go indeksowac ani przeszukac', async () => {
    expect((await indeksuj(TOKENY.wlasciciel, ID.projektPrywatnyObcego)).status).toBe(404);
    expect((await indeksuj(TOKENY.obcy, ID.projektPrywatnyObcego)).status).toBe(200);
    expect((await szukaj(TOKENY.obcy, 'tresc')).files.map((plik) => plik.fileId)).toContain(ID.plikObcego);
    expect((await szukaj(TOKENY.wlasciciel, 'tresc')).files.map((plik) => plik.fileId)).not.toContain(ID.plikObcego);

    const zakres = await zapytaj(`/api/search?q=tresc&projectId=${ID.projektPrywatnyObcego}`, { headers: jako(TOKENY.wlasciciel) });
    expect(zakres.status).toBe(404);
  });

  it('nadpisany plik jest szukany po nowej tresci, a stara znika', async () => {
    const odp = await wyslij(TOKENY.wlasciciel, ID.projektWspolny, [{ sciezka: 'docs/wdrozenie.md', tresc: 'Kolejka zadań obsługuje ponowienia.' }]);
    expect(odp.status).toBe(201);
    expect((await szukaj(TOKENY.wlasciciel, 'synchronizacji')).files.map((plik) => plik.path)).not.toContain('docs/wdrozenie.md');
    expect((await szukaj(TOKENY.wlasciciel, 'kolejka')).files.map((plik) => plik.path)).toContain('docs/wdrozenie.md');
  });
});

describe('wyszukiwanie w rozmowach', () => {
  it('pokazuje wlasna rozmowe i ukrywa rozmowe z cudzego projektu prywatnego', async () => {
    const wlasciciel = await szukaj(TOKENY.wlasciciel, 'migracji');
    expect(wlasciciel.conversations.map((r) => r.conversationId)).toContain(ID.rozmowaWlasciciela);
    expect(wlasciciel.conversations.map((r) => r.conversationId)).not.toContain(ID.rozmowaObcego);

    const obcy = await szukaj(TOKENY.obcy, 'migracji');
    expect(obcy.conversations.map((r) => r.conversationId)).toContain(ID.rozmowaObcego);
  });

  it('rozmowe z projektu calego zespolu znajduje kazdy, a prywatna autora nadal nie', async () => {
    // Ten sam autor i to samo slowo w obu rozmowach, wiec roznica w wyniku
    // bierze sie tylko z widocznosci projektu.
    const czytelnik = (await szukaj(TOKENY.czytelnik, 'harmonogram')).conversations.map((r) => r.conversationId);
    expect(czytelnik).toContain(ID.rozmowaZespolowa);
    expect(czytelnik).not.toContain(ID.rozmowaObcego);

    const autor = (await szukaj(TOKENY.obcy, 'harmonogram')).conversations.map((r) => r.conversationId);
    expect(autor).toEqual(expect.arrayContaining([ID.rozmowaZespolowa, ID.rozmowaObcego]));
  });

  it('skasowana rozmowa znika z wynikow razem z wiadomosciami', async () => {
    expect((await szukaj(TOKENY.edytor, 'kolibrach')).conversations.map((r) => r.conversationId)).toContain(ID.rozmowaKasowanaPrzezAutora);
    const kasowanie = await zapytaj(`/api/projects/${ID.projektWspolny}/conversations?conversationId=${ID.rozmowaKasowanaPrzezAutora}`, { method: 'DELETE', headers: { ...ORIGIN, ...jako(TOKENY.edytor) } });
    expect(kasowanie.status).toBe(200);
    deletedResponse.parse(kasowanie.dane);
    expect((await szukaj(TOKENY.edytor, 'kolibrach')).conversations).toEqual([]);
  });

  it('skladnia FTS wpisana w pole wyszukiwania nie wywraca zapytania', async () => {
    for (const fraza of ['"', 'NEAR(a b', 'content:x', '*', 'a OR', '-(']) {
      const odp = await zapytaj(`/api/search?q=${encodeURIComponent(fraza)}`, { headers: jako(TOKENY.wlasciciel) });
      expect(odp.status, fraza).toBe(200);
    }
  });

  it('wymaga zalogowania', async () => {
    expect((await zapytaj('/api/search?q=migracji')).status).toBe(401);
  });
});

describe('podpowiedzi plikow do pytania', () => {
  it('proponuje plik pasujacy do pytania, tylko z tego projektu', async () => {
    const odp = await zapytaj(`/api/projects/${ID.projektWspolny}/suggest-files?q=${encodeURIComponent('Jak działa kolejka i ponowienia?')}`, { headers: jako(TOKENY.edytor) });
    expect(odp.status).toBe(200);
    expect(fileSuggestions.parse(odp.dane).files.map((plik) => plik.path)).toContain('docs/wdrozenie.md');
  });

  it('nie podpowiada z projektu, do ktorego pytajacy nie ma dostepu', async () => {
    const odp = await zapytaj(`/api/projects/${ID.projektPrywatnyObcego}/suggest-files?q=tresc`, { headers: jako(TOKENY.wlasciciel) });
    expect(odp.status).toBe(404);
  });
});

// Ten plik jako jedyny zasiewa wiadomosci, wiec tu sprawdzamy ich liczniki.
// Lista rozmow projektu liczyla je podzapytaniem z kolumnami bez nazwy tabeli,
// wiec w pasku bocznym kazda rozmowa miala 0 wiadomosci.
describe('liczniki wiadomosci', () => {
  it('lista rozmow projektu i lista wszystkich rozmow podaja te sama liczbe', async () => {
    const wProjekcie = await zapytaj(`/api/projects/${ID.projektPrywatnyObcego}/conversations`, { headers: jako(TOKENY.obcy) });
    expect(wProjekcie.status).toBe(200);
    expect(projectConversations.parse(wProjekcie.dane).conversations.find((r) => r.id === ID.rozmowaObcego)).toMatchObject({ messageCount: 2 });

    const wszystkie = await zapytaj('/api/conversations', { headers: jako(TOKENY.obcy) });
    expect(wszystkie.status).toBe(200);
    expect(allConversations.parse(wszystkie.dane).conversations.find((r) => r.id === ID.rozmowaObcego)).toMatchObject({ messageCount: 2 });
  });
});

describe('dluga rozmowa', () => {
  it('po odswiezeniu pokazuje najnowsze wiadomosci, w kolejnosci od najstarszej', async () => {
    const odp = await zapytaj(`/api/projects/${ID.projektWspolny}/conversations?conversationId=${DLUGA_ROZMOWA}`, { headers: jako(TOKENY.wlasciciel) });
    expect(odp.status, odp.tekst).toBe(200);
    const tresci = conversationDetail.parse(odp.dane).messages.map((w) => w.content);
    // Limit to 200, wiec z 205 wypada piec najstarszych, a nie piec najnowszych.
    expect(tresci).toHaveLength(200);
    expect(tresci[0]).toBe(`Wpis numer ${DLUGOSC - 199}`);
    expect(tresci.at(-1)).toBe(`Wpis numer ${DLUGOSC}`);
  });
});

describe('wysylka z kopia na Dysk Google', () => {
  it('nieudana kopia na Dysk nie zostawia w R2 pliku bez wiersza w bazie', async () => {
    const sierotyPrzed = await sieroty();
    const odp = await wyslij(TOKENY.wlasciciel, PROJEKT_NA_DYSKU, [{ sciezka: 'notatki/dysk.txt', tresc: 'Tresc dla Dysku' }]);
    // Dysk nie jest skonfigurowany, wiec wysylka pada po zapisie do R2.
    expect(odp.status, odp.tekst).toBe(503);
    expect(await sieroty()).toEqual(sierotyPrzed);
  });
});

// Obiekty w R2 bez wiersza w bazie, wedlug manifestu wlasciciela.
async function sieroty() {
  const odp = await zapytaj('/api/admin/backup', { method: 'POST', headers: jako(TOKENY.wlasciciel) });
  expect(odp.status, odp.tekst).toBe(200);
  return (odp.dane as { orphanInStorage: string[] }).orphanInStorage;
}
