import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROZSZERZENIA_BEZ_WSPARCIA, ROZSZERZENIA_DOKUMENTOW, wydobadzTekstDokumentu, zRtf } from '@/lib/document-text';

// Pliki testowe to prawdziwe archiwa OOXML z prawdziwa kompresja deflate,
// wygenerowane przez `scripts/generate-fixtures.mjs`. Atrapa XML-a bez ZIP-a
// nie sprawdzilaby ani czytania katalogu centralnego, ani dekompresji.
function wczytaj(nazwa: string): Uint8Array<ArrayBuffer> {
  const sciezka = fileURLToPath(new URL(`./fixtures/${nazwa}`, import.meta.url));
  const bufor = readFileSync(sciezka);
  return new Uint8Array(bufor.buffer.slice(bufor.byteOffset, bufor.byteOffset + bufor.byteLength));
}

describe('DOCX', () => {
  it('sklada zdanie rozbite formatowaniem na kilka przebiegow', async () => {
    const { tekst } = await wydobadzTekstDokumentu('docx', wczytaj('przyklad.docx'));
    // W pliku to trzy osobne `<w:t>`; ma wyjsc jedna linia, a nie trzy.
    expect(tekst.split('\n')[0]).toBe('Zazolc gesla jazn');
  });

  it('odczytuje polskie znaki i rozbraja encje XML', async () => {
    const { tekst } = await wydobadzTekstDokumentu('docx', wczytaj('przyklad.docx'));
    expect(tekst).toContain('żółć & święta');
  });

  it('zamienia lamanie linii na nowa linie', async () => {
    const { tekst } = await wydobadzTekstDokumentu('docx', wczytaj('przyklad.docx'));
    expect(tekst).toContain('Trzecia\npo lamaniu');
  });

  it('plik, ktory nie jest archiwum, daje powod zamiast wyjatku', async () => {
    const wynik = await wydobadzTekstDokumentu('docx', wczytaj('uszkodzony.docx'));
    expect(wynik.tekst).toBe('');
    expect(wynik.powod).toBeTruthy();
  });
});

describe('XLSX', () => {
  it('rozwiazuje ciagi wspoldzielone zamiast zwracac ich numery', async () => {
    const { tekst } = await wydobadzTekstDokumentu('xlsx', wczytaj('przyklad.xlsx'));
    // Komorka trzyma `<v>2</v>`; bez slownika w kontekscie wyladowalaby dwojka.
    expect(tekst).toContain('Faktura wrzesień');
    expect(tekst).not.toMatch(/^\d+\t/m);
  });

  it('zachowuje uklad wierszy i kolumn', async () => {
    const { tekst } = await wydobadzTekstDokumentu('xlsx', wczytaj('przyklad.xlsx'));
    expect(tekst).toContain('Nazwa\tKwota');
    expect(tekst).toContain('Faktura wrzesień\t1230.50');
  });
});

describe('PPTX', () => {
  it('porzadkuje slajdy po numerze, nie alfabetycznie', async () => {
    const { tekst } = await wydobadzTekstDokumentu('pptx', wczytaj('przyklad.pptx'));
    const kolejnosc = [...tekst.matchAll(/# Slajd (\d+)/g)].map((t) => Number(t[1]));
    // Sortowanie tekstowe daloby 1, 10, 2.
    expect(kolejnosc).toEqual([1, 2, 10]);
  });

  it('wyciaga tresc wszystkich slajdow', async () => {
    const { tekst } = await wydobadzTekstDokumentu('pptx', wczytaj('przyklad.pptx'));
    expect(tekst).toContain('Slajd pierwszy');
    expect(tekst).toContain('Podsumowanie');
  });
});

describe('RTF', () => {
  it('zwraca tresc, a nie slowa sterujace', async () => {
    const { tekst } = await wydobadzTekstDokumentu('rtf', wczytaj('przyklad.rtf'));
    expect(tekst).toContain('Pierwsza linia');
    expect(tekst).toContain('Ostatnia linia');
    // To wlasnie trafialo do modelu, zanim RTF zaczal byc rozpakowywany.
    expect(tekst).not.toContain('rtf1');
    expect(tekst).not.toContain('fonttbl');
    expect(tekst).not.toContain('Calibri');
  });

  it('odczytuje polskie znaki z zapisu \\uN', async () => {
    const { tekst } = await wydobadzTekstDokumentu('rtf', wczytaj('przyklad.rtf'));
    expect(tekst).toContain('Zażółć gęślą jaźń');
  });

  it('pomija zawartosc grup z metadanymi', () => {
    const { tekst } = zRtf(String.raw`{\rtf1{\*\generator Riched20}{\info{\author Ktos}}\pard Tresc}`);
    expect(tekst).toBe('Tresc');
  });

  it('plik bez naglowka RTF jest odrzucany', () => {
    expect(zRtf('zwykly tekst').powod).toBeTruthy();
  });
});

describe('slowniki rozszerzen', () => {
  it('nie deklaruja tego samego rozszerzenia dwa razy', () => {
    for (const rozszerzenie of ROZSZERZENIA_DOKUMENTOW) {
      expect(ROZSZERZENIA_BEZ_WSPARCIA.has(rozszerzenie), rozszerzenie).toBe(false);
    }
  });

  it('nieznany format daje powod, a nie pusty wynik bez wyjasnienia', async () => {
    const wynik = await wydobadzTekstDokumentu('xyz', new Uint8Array(new ArrayBuffer(4)));
    expect(wynik.powod).toContain('xyz');
  });
});
