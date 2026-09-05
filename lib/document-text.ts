// Wydobywanie tekstu z dokumentow biurowych, bez zadnej zaleznosci.
//
// DOCX, XLSX i PPTX to archiwa ZIP z XML-em w srodku, a zarowno Workers, jak i
// Node maja wbudowany `DecompressionStream`, wiec rozpakowanie nie wymaga
// biblioteki. Trzymamy to w `lib/`, a nie w route handlerze, zeby dalo sie
// pokryc testami bez uruchamiania Workera - tak jak `file-guards` czy `audit`.
//
// PDF-y sa osobno (`lib/server/pdf-text.ts`), bo wymagaja prawdziwego parsera.

export type WynikEkstrakcji = {
  tekst: string;
  // Krotki opis tego, co sie stalo, gdy tekstu nie ma. Wchodzi do kontekstu
  // modelu zamiast tresci, zeby model nie zgadywal, czemu plik jest pusty.
  powod?: string;
};

const DEKODER = new TextDecoder('utf-8');

// --- ZIP -------------------------------------------------------------------

type WpisZip = { nazwa: string; metoda: number; offset: number; rozmiar: number };

function u16(dane: Uint8Array<ArrayBuffer>, i: number) { return dane[i] | (dane[i + 1] << 8); }
function u32(dane: Uint8Array<ArrayBuffer>, i: number) { return (dane[i] | (dane[i + 1] << 8) | (dane[i + 2] << 16)) + dane[i + 3] * 0x1000000; }

// Katalog centralny czytamy od konca pliku, tak jak przewiduje format. Nie da
// sie isc od poczatku, bo dopiero on mowi, gdzie zaczyna sie kazdy wpis.
function czytajKatalog(dane: Uint8Array<ArrayBuffer>): WpisZip[] {
  let eocd = -1;
  const dolnaGranica = Math.max(0, dane.length - 66_000);
  for (let i = dane.length - 22; i >= dolnaGranica; i -= 1) {
    if (u32(dane, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];

  const ile = u16(dane, eocd + 10);
  let wskaznik = u32(dane, eocd + 16);
  const wpisy: WpisZip[] = [];
  for (let n = 0; n < ile && wskaznik + 46 <= dane.length; n += 1) {
    if (u32(dane, wskaznik) !== 0x02014b50) break;
    const dlugoscNazwy = u16(dane, wskaznik + 28);
    const dlugoscDodatkow = u16(dane, wskaznik + 30);
    const dlugoscKomentarza = u16(dane, wskaznik + 32);
    wpisy.push({
      nazwa: DEKODER.decode(dane.subarray(wskaznik + 46, wskaznik + 46 + dlugoscNazwy)),
      metoda: u16(dane, wskaznik + 10),
      rozmiar: u32(dane, wskaznik + 20),
      offset: u32(dane, wskaznik + 42),
    });
    wskaznik += 46 + dlugoscNazwy + dlugoscDodatkow + dlugoscKomentarza;
  }
  return wpisy;
}

async function rozpakuj(dane: Uint8Array<ArrayBuffer>, wpis: WpisZip): Promise<string | null> {
  const naglowek = wpis.offset;
  if (u32(dane, naglowek) !== 0x04034b50) return null;
  // Naglowek lokalny bywa niezgodny z katalogiem centralnym co do dlugosci pol,
  // wiec offset danych liczymy z niego, a nie z katalogu.
  const start = naglowek + 30 + u16(dane, naglowek + 26) + u16(dane, naglowek + 28);
  const surowe = dane.subarray(start, start + wpis.rozmiar);

  if (wpis.metoda === 0) return DEKODER.decode(surowe);
  if (wpis.metoda !== 8) return null;

  // `deflate-raw` to strumien deflate bez naglowka zlib - dokladnie to, co ZIP
  // trzyma w srodku.
  // Podajemy bajty wprost strumieniem zamiast przez Blob: unika kopii calego
  // wpisu i omija niezgodnosc typu widoku nad ArrayBufferLike.
  const zrodlo = new ReadableStream<BufferSource>({
    start(kontroler) { kontroler.enqueue(surowe); kontroler.close(); },
  });
  const strumien = zrodlo.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(strumien).text();
}

async function czytajZArchiwum(dane: Uint8Array<ArrayBuffer>, pasuje: (nazwa: string) => boolean): Promise<Array<{ nazwa: string; tresc: string }>> {
  const wybrane = czytajKatalog(dane).filter((wpis) => pasuje(wpis.nazwa));
  const wyniki: Array<{ nazwa: string; tresc: string }> = [];
  for (const wpis of wybrane.sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'en'))) {
    try {
      const tresc = await rozpakuj(dane, wpis);
      if (tresc !== null) wyniki.push({ nazwa: wpis.nazwa, tresc });
    } catch { /* pojedynczy uszkodzony wpis nie ma wywracac calego pliku */ }
  }
  return wyniki;
}

// --- XML -------------------------------------------------------------------

function odkoduj(tekst: string): string {
  return tekst
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replace(/&#(\d+);/g, (_, kod: string) => String.fromCodePoint(Number(kod)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, kod: string) => String.fromCodePoint(Number.parseInt(kod, 16)))
    // Ampersand na koncu, inaczej rozbrajalby encje powstale z poprzednich krokow.
    .replaceAll('&amp;', '&');
}

function tekstZnacznikow(xml: string, znacznik: string): string[] {
  const wzorzec = new RegExp(`<${znacznik}(?:\\s[^>]*)?>([\\s\\S]*?)</${znacznik}>`, 'g');
  return [...xml.matchAll(wzorzec)].map((trafienie) => odkoduj(trafienie[1]));
}

// --- DOCX ------------------------------------------------------------------

async function zDocx(dane: Uint8Array<ArrayBuffer>): Promise<WynikEkstrakcji> {
  const pliki = await czytajZArchiwum(dane, (n) => n === 'word/document.xml');
  if (!pliki.length) return { tekst: '', powod: 'Missing word/document.xml; this does not appear to be a Word document.' };

  // Akapity rozdzielamy nowa linia, a wewnatrz akapitu sklejamy przebiegi
  // tekstu. Bez tego zdanie rozbite formatowaniem na kilka `<w:t>` rozpadloby
  // sie na osobne linie.
  const akapity = pliki[0].tresc.split(/<\/w:p>/).map((akapit) => {
    // Znak wstawiony miedzy znaczniki przepadlby, bo nizej czytamy wylacznie
    // zawartosc <w:t>. Podajemy go wiec jako kolejny przebieg tekstu.
    const zLamaniem = akapit
      .replace(/<w:br\s*\/?>/g, '<w:t>\n</w:t>')
      .replace(/<w:tab\s*\/?>/g, '<w:t>\t</w:t>');
    return tekstZnacznikow(zLamaniem, 'w:t').join('');
  });
  return { tekst: akapity.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

// --- XLSX ------------------------------------------------------------------

async function zXlsx(dane: Uint8Array<ArrayBuffer>): Promise<WynikEkstrakcji> {
  const pliki = await czytajZArchiwum(dane, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const wspolne = pliki.find((p) => p.nazwa === 'xl/sharedStrings.xml');
  // Ciagi wspoldzielone to tablica indeksowana pozycja - komorka z `t="s"`
  // trzyma numer, a nie tekst. Bez tej mapy arkusz jest zbiorem liczb.
  const slownik = wspolne
    ? [...wspolne.tresc.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((si) => tekstZnacznikow(si[1], 't').join(''))
    : [];

  const arkusze = pliki.filter((p) => p.nazwa !== 'xl/sharedStrings.xml');
  if (!arkusze.length) return { tekst: '', powod: 'No worksheets found; this does not appear to be an Excel workbook.' };

  const czesci: string[] = [];
  for (const arkusz of arkusze) {
    const wiersze = [...arkusz.tresc.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map((wiersz) => {
      const komorki = [...wiersz[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(([, atrybuty, wnetrze]) => {
        const wartosc = tekstZnacznikow(wnetrze, 'v')[0] ?? '';
        if (/t="s"/.test(atrybuty)) return slownik[Number(wartosc)] ?? '';
        // `t="inlineStr"` trzyma tekst wprost w komorce, poza slownikiem.
        if (/t="inlineStr"/.test(atrybuty)) return tekstZnacznikow(wnetrze, 't').join('');
        return wartosc;
      });
      return komorki.join('\t');
    }).filter((wiersz) => wiersz.trim().length > 0);
    if (wiersze.length) czesci.push(`# ${arkusz.nazwa.replace('xl/worksheets/', '')}\n${wiersze.join('\n')}`);
  }
  return { tekst: czesci.join('\n\n').trim() };
}

// --- PPTX ------------------------------------------------------------------

async function zPptx(dane: Uint8Array<ArrayBuffer>): Promise<WynikEkstrakcji> {
  const slajdy = await czytajZArchiwum(dane, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  if (!slajdy.length) return { tekst: '', powod: 'No slides found; this does not appear to be a PowerPoint presentation.' };

  // Numer slajdu wyciagamy z nazwy, bo sortowanie tekstowe daje 1, 10, 11, 2.
  const numer = (nazwa: string) => Number(nazwa.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
  const czesci = [...slajdy].sort((a, b) => numer(a.nazwa) - numer(b.nazwa)).map((slajd) => {
    const linie = [...slajd.tresc.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)]
      .map((akapit) => tekstZnacznikow(akapit[1], 'a:t').join(''))
      .filter((linia) => linia.trim().length > 0);
    return linie.length ? `# Slajd ${numer(slajd.nazwa)}\n${linie.join('\n')}` : '';
  }).filter(Boolean);
  return { tekst: czesci.join('\n\n').trim() };
}

// --- RTF -------------------------------------------------------------------

// Do tej pory pliki RTF szly do modelu jako zwykly tekst, wiec dostawal
// `\rtf1\ansi\deff0{\fonttbl...` zamiast tresci.
export function zRtf(surowy: string): WynikEkstrakcji {
  if (!surowy.startsWith('{\\rtf')) return { tekst: '', powod: 'This is not an RTF file.' };

  let wynik = '';
  let i = 0;
  // Zawartosc niektorych grup to metadane, nie tresc: tabela czcionek, paleta
  // kolorow, informacje o dokumencie. Pomijamy je w calosci.
  const pomijane = /^(fonttbl|colortbl|stylesheet|info|pict|object|themedata|colorschememapping|latentstyles|datastore|generator)$/;
  const stos: boolean[] = [];
  let pomijamy = 0;

  while (i < surowy.length) {
    const znak = surowy[i];

    if (znak === '{') {
      const dalej = surowy.slice(i + 1, i + 40);
      const destynacja = dalej.match(/^\\\*?\\?([a-z]+)/);
      const doPominiecia = Boolean(destynacja && pomijane.test(destynacja[1])) || dalej.startsWith('\\*');
      stos.push(doPominiecia);
      if (doPominiecia) pomijamy += 1;
      i += 1;
      continue;
    }
    if (znak === '}') {
      if (stos.pop()) pomijamy -= 1;
      i += 1;
      continue;
    }
    if (znak === '\\') {
      const sterujace = surowy.slice(i).match(/^\\([a-z]+)(-?\d+)? ?/);
      if (sterujace) {
        const [calosc, slowo, liczba] = sterujace;
        if (!pomijamy) {
          if (slowo === 'par' || slowo === 'line') wynik += '\n';
          else if (slowo === 'tab') wynik += '\t';
          else if (slowo === 'u' && liczba) {
            // `\uN` niesie prawdziwy punkt kodowy; wartosci ujemne to zapis
            // uzupelnieniowy dla znakow powyzej 32767.
            const kod = Number(liczba);
            wynik += String.fromCharCode(kod < 0 ? kod + 65536 : kod);
          }
        }
        i += calosc.length;
        // Po `\uN` idzie znak zastepczy dla czytnikow bez Unicode - pomijamy go,
        // inaczej kazde polskie slowo dostaloby doklejone smieci.
        if (slowo === 'u' && surowy.slice(i, i + 2) === "\\'") i += 4;
        else if (slowo === 'u' && surowy[i] === '?') i += 1;
        continue;
      }
      const hex = surowy.slice(i).match(/^\\'([0-9a-fA-F]{2})/);
      if (hex) {
        if (!pomijamy) wynik += String.fromCharCode(Number.parseInt(hex[1], 16));
        i += 4;
        continue;
      }
      // Znak specjalny poprzedzony odwrotnym ukosnikiem, np. \{ albo \\.
      if (!pomijamy) wynik += surowy[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (!pomijamy && znak !== '\r' && znak !== '\n') wynik += znak;
    i += 1;
  }
  return { tekst: wynik.replace(/\n{3,}/g, '\n\n').trim() };
}

// --- wejscie ---------------------------------------------------------------

export const ROZSZERZENIA_DOKUMENTOW = new Set(['docx', 'xlsx', 'pptx', 'rtf']);

// Starsze formaty binarne (doc, xls, ppt) to kontenery OLE i wymagalyby
// zupelnie innego parsera. Zostaja przy metadanych, ale mowimy o tym wprost,
// zamiast milczec.
export const ROZSZERZENIA_BEZ_WSPARCIA = new Set(['doc', 'xls', 'ppt']);

export async function wydobadzTekstDokumentu(rozszerzenie: string, bajty: Uint8Array<ArrayBuffer>): Promise<WynikEkstrakcji> {
  try {
    switch (rozszerzenie) {
      case 'docx': return await zDocx(bajty);
      case 'xlsx': return await zXlsx(bajty);
      case 'pptx': return await zPptx(bajty);
      case 'rtf': return zRtf(new TextDecoder('utf-8').decode(bajty));
      default: return { tekst: '', powod: `Nieobslugiwany format: ${rozszerzenie}.` };
    }
  } catch (blad) {
    return { tekst: '', powod: `Could not read the file: ${blad instanceof Error ? blad.message : 'unknown error'}.` };
  }
}
