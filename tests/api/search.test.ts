import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deletedResponse } from '@/lib/contracts/common';
import { allConversations, conversationDetail, projectConversations } from '@/lib/contracts/conversations';
import { fileSuggestions, indexRound, projectFiles } from '@/lib/contracts/files';
import { searchResults } from '@/lib/contracts/search';
import { MARK_START } from '@/lib/search';
import { ID, ORIGIN, TOKENY, jako, odczytajLokalneD1, startWorkera, stopWorkera, zapytaj, zbudujJesliTrzeba, zepsujLokalnyIndeksFragmentow } from './harness';

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
const PROJEKT_FRAGMENTOW = crypto.randomUUID();
// Pliki w roznych stanach odczytu, w prywatnym projekcie wlasciciela. Ich
// obiektow nie ma w R2, wiec kazda proba odczytu konczy sie bledem.
const STAN = { ponowiony: crypto.randomUUID(), wyczerpany: crypto.randomUUID(), zawieszony: crypto.randomUUID() };
const godzineTemu = t - 3_600_000;
const plikWStanie = (id: string, sciezka: string, status: string, powod: string | null, proby: number) => [
  `INSERT INTO files (id,project_id,uploaded_by,object_key,relative_path,name,mime_type,size_bytes,sha256,created_at) VALUES ('${id}','${ID.projektPrywatnyWlasciciela}','${ID.wlasciciel}','brak/${id}','${sciezka}','${sciezka.split('/').pop()}','text/plain',12,'x',${godzineTemu});`,
  `INSERT INTO file_texts (file_id,project_id,path,content,status,reason,attempts,indexed_at) VALUES ('${id}','${ID.projektPrywatnyWlasciciela}','${sciezka}','','${status}',${powod === null ? 'NULL' : `'${powod}'`},${proby},${godzineTemu});`,
].join('\n');

const DODATKOWE_WIADOMOSCI = [
  wiadomosc('w-1', ID.rozmowaWlasciciela, ID.wlasciciel, 'Plan migracji bazy na wiosnę'),
  wiadomosc('w-2', ID.rozmowaObcego, ID.obcy, 'Tajny plan migracji obcego'),
  wiadomosc('w-3', ID.rozmowaKasowanaPrzezAutora, ID.edytor, 'Notatka o kolibrach do usunięcia'),
  wiadomosc('w-4', ID.rozmowaZespolowa, ID.obcy, 'Harmonogram dyżurów całego zespołu'),
  wiadomosc('w-5', ID.rozmowaObcego, ID.obcy, 'Prywatny harmonogram obcego'),
  `INSERT INTO conversations (id,project_id,created_by,title,created_at,updated_at) VALUES ('${DLUGA_ROZMOWA}','${ID.projektWspolny}','${ID.wlasciciel}','Dluga rozmowa',${t},${t});`,
  `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${DLUGOSC}) INSERT INTO messages (id,conversation_id,member_id,role,content,created_at) SELECT 'dluga-' || i, '${DLUGA_ROZMOWA}', '${ID.wlasciciel}', 'user', 'Wpis numer ' || i, ${t} + i FROM n;`,
  `INSERT INTO projects (id,owner_id,name,description,visibility,storage_provider,drive_folder_id,created_at,updated_at) VALUES ('${PROJEKT_NA_DYSKU}','${ID.wlasciciel}','Projekt na Dysku','','private','google_drive','folder-testowy',${t},${t});`,
  `INSERT INTO projects (id,owner_id,name,description,visibility,storage_provider,created_at,updated_at) VALUES ('${PROJEKT_FRAGMENTOW}','${ID.wlasciciel}','Projekt fragmentow','','private','r2',${t},${t});`,
  plikWStanie(STAN.ponowiony, 'stan/ponowiony.txt', 'failed', 'Stary powod', 1),
  plikWStanie(STAN.wyczerpany, 'stan/wyczerpany.txt', 'failed', 'Wyczerpany powod', 3),
  plikWStanie(STAN.zawieszony, 'stan/zawieszony.txt', 'extracting', null, 3),
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

  it('odrzuca powtorzone sciezki zanim zapisze obiekty', async () => {
    const before = await sieroty();
    const odp = await wyslij(TOKENY.wlasciciel, ID.projektWspolny, [
      { sciezka: 'duplicate/test.txt', tresc: 'first' },
      { sciezka: 'duplicate/test.txt', tresc: 'second' },
    ]);
    expect(odp.status, odp.tekst).toBe(400);
    expect(odp.dane.error).toContain('different path');
    expect(await sieroty()).toEqual(before);
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

describe('stan odczytu plikow', () => {
  const plikiProjektu = async (projekt: string) => {
    const odp = await zapytaj(`/api/projects/${projekt}/files`, { headers: jako(TOKENY.wlasciciel) });
    expect(odp.status, odp.tekst).toBe(200);
    return projectFiles.parse(odp.dane).files;
  };
  const stanPliku = async (projekt: string, id: string) => (await plikiProjektu(projekt)).find((plik) => plik.id === id)?.text;

  it('runda ponawia nieudany odczyt po przerwie, a wyczerpany i zawieszony konczy', async () => {
    const odp = await indeksuj(TOKENY.wlasciciel, ID.projektPrywatnyWlasciciela);
    expect(odp.status, odp.tekst).toBe(200);
    // Ponowiony: proba sie odbyla, wiec powod jest nowy, a prob zostalo.
    expect(await stanPliku(ID.projektPrywatnyWlasciciela, STAN.ponowiony)).toEqual({ status: 'failed', note: 'The file is no longer in storage.', retrying: true });
    // Po trzech probach plik nie jest juz brany, a jego powod zostaje.
    expect(await stanPliku(ID.projektPrywatnyWlasciciela, STAN.wyczerpany)).toEqual({ status: 'failed', note: 'Wyczerpany powod', retrying: false });
    // Runda, ktora zginela trzy razy przy tym pliku, nie zabija juz kolejnych.
    const zawieszony = await stanPliku(ID.projektPrywatnyWlasciciela, STAN.zawieszony);
    expect(zawieszony?.status).toBe('failed');
    expect(zawieszony?.retrying).toBe(false);
    expect(zawieszony?.note).toContain('did not finish after 3 attempts');
  });

  it('uszkodzony PDF dostaje powod i czeka na kolejna probe, zamiast od razu wracac', async () => {
    const wyslany = await wyslij(TOKENY.wlasciciel, ID.projektPrywatnyWlasciciela, [{ sciezka: 'stan/zepsuty.pdf', tresc: '%PDF-1.4\nnot a real body\n%%EOF' }]);
    expect(wyslany.status, wyslany.tekst).toBe(201);
    const plik = projectFiles.parse(wyslany.dane).files[0];
    // Dokumenty czyta runda, wiec po wysylce plik czeka.
    expect(plik.text.status).toBe('pending');

    expect((await indeksuj(TOKENY.wlasciciel, ID.projektPrywatnyWlasciciela)).status).toBe(200);
    const poPierwszej = await stanPliku(ID.projektPrywatnyWlasciciela, plik.id);
    expect(poPierwszej).toMatchObject({ status: 'failed', retrying: true });
    expect(poPierwszej?.note).toContain('Could not read the PDF');

    // Kolejna runda zaraz potem go nie bierze: czeka na swoja kolej.
    const druga = indexRound.parse((await indeksuj(TOKENY.wlasciciel, ID.projektPrywatnyWlasciciela)).dane);
    expect(druga.indexed).toBe(0);
    expect(await stanPliku(ID.projektPrywatnyWlasciciela, plik.id)).toEqual(poPierwszej);
  });

  it('obraz od razu mowi, ze nie ma tekstu, a tekst jest od razu przeczytany', async () => {
    const formularz = new FormData();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    formularz.append('files', new File([png], 'obraz.png', { type: 'image/png' }));
    formularz.append('files', new File(['Zwykly tekst'], 'notatka.txt', { type: 'text/plain' }));
    formularz.append('paths', JSON.stringify(['stan/obraz.png', 'stan/notatka.txt']));
    const odp = await zapytaj(`/api/projects/${ID.projektPrywatnyWlasciciela}/files`, { method: 'POST', headers: { ...ORIGIN, ...jako(TOKENY.wlasciciel) }, body: formularz });
    expect(odp.status, odp.tekst).toBe(201);
    const [obraz, notatka] = projectFiles.parse(odp.dane).files;
    expect(obraz.text).toMatchObject({ status: 'unsupported', retrying: false });
    expect(obraz.text.note).toContain('not converted to text');
    expect(notatka.text).toEqual({ status: 'indexed', note: null, retrying: false });
  });
});

describe('indeks fragmentow dokumentu', () => {
  it('reports passage backlog separately from completed file-text indexing', async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ sciezka: `passages/file-${i}.txt`, tresc: `Ready text ${i}` }));
    const upload = await wyslij(TOKENY.wlasciciel, PROJEKT_FRAGMENTOW, files);
    expect(upload.status, upload.tekst).toBe(201);
    expect(projectFiles.parse(upload.dane).files.every((file) => file.text.status === 'indexed')).toBe(true);
    const first = await indeksuj(TOKENY.wlasciciel, PROJEKT_FRAGMENTOW);
    expect(first.status, first.tekst).toBe(200);
    expect(indexRound.parse(first.dane)).toMatchObject({ indexed: 0, failed: 0, remaining: 0, passagesRemaining: 3 });
    const second = await indeksuj(TOKENY.wlasciciel, PROJEKT_FRAGMENTOW);
    expect(indexRound.parse(second.dane)).toMatchObject({ remaining: 0, passagesRemaining: 1 });
    const third = await indeksuj(TOKENY.wlasciciel, PROJEKT_FRAGMENTOW);
    expect(indexRound.parse(third.dane)).toMatchObject({ remaining: 0, passagesRemaining: 0 });
  }, 120_000);

  it('zapisuje tresc i strony prawdziwych plikow, a kasowanie usuwa indeks', async () => {
    const form = new FormData();
    form.append('files', new File(['# Contract\n\nUnique chunk marker zenith.'], 'context-check.md', { type: 'text/markdown' }));
    form.append('files', new File([readFileSync(join(import.meta.dirname, '..', 'fixtures', 'umowa.pdf'))], 'context-check.pdf', { type: 'application/pdf' }));
    form.append('paths', JSON.stringify(['chunks/context-check.md', 'chunks/context-check.pdf']));
    const upload = await zapytaj(`/api/projects/${ID.projektWspolny}/files`, { method: 'POST', headers: { ...ORIGIN, ...jako(TOKENY.wlasciciel) }, body: form });
    expect(upload.status, upload.tekst).toBe(201);
    const [markdown, pdf] = projectFiles.parse(upload.dane).files;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const round = await indeksuj(TOKENY.wlasciciel, ID.projektWspolny);
      expect(round.status, round.tekst).toBe(200);
      const parsed = indexRound.parse(round.dane);
      if (parsed.remaining === 0 && parsed.passagesRemaining === 0) break;
      if (attempt === 29) throw new Error('Context indexing did not finish in 30 rounds.');
    }
    const states = odczytajLokalneD1('SELECT file_id, status, chunk_count FROM file_chunk_states WHERE file_id IN (?, ?) ORDER BY file_id', markdown.id, pdf.id);
    expect(states).toHaveLength(2);
    for (const state of states) { expect(state.status).toBe('indexed'); expect(Number(state.chunk_count)).toBeGreaterThan(0); }
    const markdownRows = odczytajLokalneD1('SELECT content, label FROM file_chunks WHERE file_id = ? ORDER BY ordinal', markdown.id);
    expect(markdownRows.some((row) => String(row.content).includes('Unique chunk marker zenith.'))).toBe(true);
    const pdfRows = odczytajLokalneD1('SELECT place, content FROM file_chunks WHERE file_id = ? ORDER BY ordinal', pdf.id);
    expect(pdfRows.some((row) => String(row.place).startsWith('page ') && String(row.content).length > 0)).toBe(true);
    const fts = odczytajLokalneD1('SELECT c.file_id FROM file_chunks_fts x JOIN file_chunks c ON c.rowid=x.rowid WHERE file_chunks_fts MATCH ?', 'zenith');
    expect(fts.some((row) => row.file_id === markdown.id)).toBe(true);
    const removed = await zapytaj(`/api/files/${markdown.id}`, { method: 'DELETE', headers: { ...ORIGIN, ...jako(TOKENY.wlasciciel) } });
    expect(removed.status, removed.tekst).toBe(200);
    expect(odczytajLokalneD1('SELECT file_id FROM file_chunks WHERE file_id = ?', markdown.id)).toEqual([]);
    expect(odczytajLokalneD1('SELECT c.file_id FROM file_chunks_fts x JOIN file_chunks c ON c.rowid=x.rowid WHERE file_chunks_fts MATCH ?', 'zenith')).toEqual([]);
  }, 120_000);

  it('preserves existing file indexing when the new index fails', async () => {
    const form = new FormData();
    form.append('files', new File([readFileSync(join(import.meta.dirname, '..', 'fixtures', 'umowa.pdf'))], 'legacy-fallback.pdf', { type: 'application/pdf' }));
    form.append('paths', JSON.stringify(['chunks/legacy-fallback.pdf']));
    const upload = await zapytaj(`/api/projects/${ID.projektWspolny}/files`, { method: 'POST', headers: { ...ORIGIN, ...jako(TOKENY.wlasciciel) }, body: form });
    expect(upload.status, upload.tekst).toBe(201);
    const file = projectFiles.parse(upload.dane).files[0];
    expect(file.text.status).toBe('pending');
    zepsujLokalnyIndeksFragmentow();
    const round = await indeksuj(TOKENY.wlasciciel, ID.projektWspolny);
    expect(round.status, round.tekst).toBe(200);
    const parsed = indexRound.parse(round.dane);
    expect(parsed.indexed).toBeGreaterThan(0);
    expect(parsed.passagesRemaining).toBeUndefined();
    const listing = await zapytaj(`/api/projects/${ID.projektWspolny}/files`, { headers: jako(TOKENY.wlasciciel) });
    expect(projectFiles.parse(listing.dane).files.find((item) => item.id === file.id)?.text.status).toBe('indexed');
  }, 120_000);
});
