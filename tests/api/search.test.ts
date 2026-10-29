import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deletedResponse } from '@/lib/contracts/common';
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

const DODATKOWE_WIADOMOSCI = [
  wiadomosc('w-1', ID.rozmowaWlasciciela, ID.wlasciciel, 'Plan migracji bazy na wiosnę'),
  wiadomosc('w-2', ID.rozmowaObcego, ID.obcy, 'Tajny plan migracji obcego'),
  wiadomosc('w-3', ID.rozmowaKasowanaPrzezAutora, ID.edytor, 'Notatka o kolibrach do usunięcia'),
  wiadomosc('w-4', ID.rozmowaZespolowa, ID.obcy, 'Harmonogram dyżurów całego zespołu'),
  wiadomosc('w-5', ID.rozmowaObcego, ID.obcy, 'Prywatny harmonogram obcego'),
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
