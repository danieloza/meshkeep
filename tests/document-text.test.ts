import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalText, sheetUnits } from '@/lib/context-chunking';
import { ROZSZERZENIA_BEZ_WSPARCIA, ROZSZERZENIA_DOKUMENTOW, wydobadzTekstDokumentu, zRtf } from '@/lib/document-text';
import { workbook, zip } from './workbook';

// Pliki testowe to prawdziwe archiwa OOXML z prawdziwa kompresja deflate,
// wygenerowane przez `scripts/generate-fixtures.mjs`. Atrapa XML-a bez ZIP-a
// nie sprawdzilaby ani czytania katalogu centralnego, ani dekompresji.
function wczytaj(nazwa: string): Uint8Array<ArrayBuffer> {
  const sciezka = fileURLToPath(new URL(`./fixtures/${nazwa}`, import.meta.url));
  const bufor = readFileSync(sciezka);
  return new Uint8Array(bufor.buffer.slice(bufor.byteOffset, bufor.byteOffset + bufor.byteLength));
}

describe('DOCX', () => {
  it('rejects a real ZIP with more archive entries than the positive limit', async () => {
    const bytes = zip({ 'word/document.xml': '<w:p><w:t>Hello</w:t></w:p>', 'other.xml': '<other/>' });
    const allowed = await wydobadzTekstDokumentu('docx', bytes, { maxArchiveBytes: 1_000_000, maxArchiveEntries: 2 });
    expect(allowed.tekst).toBe('Hello');
    const rejected = await wydobadzTekstDokumentu('docx', bytes, { maxArchiveBytes: 1_000_000, maxArchiveEntries: 1 });
    expect(rejected.tekst).toBe('');
    expect(rejected.powod).toContain('too many archive entries');
    expect(rejected.blad).toBeUndefined();
  });
  it('limits actual decompressed bytes and leaves normal extraction unchanged', async () => {
    const bytes = wczytaj('przyklad.docx');
    const normal = await wydobadzTekstDokumentu('docx', bytes);
    expect(await wydobadzTekstDokumentu('docx', bytes, { maxArchiveBytes: 1_000_000, maxArchiveEntries: 2_000 })).toEqual(normal);
    // The ZIP central directory's claimed uncompressed length must not be trusted.
    const falsified = bytes.slice();
    const view = new DataView(falsified.buffer);
    for (let i = 0; i < falsified.length - 46; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0, true);
    }
    const limited = await wydobadzTekstDokumentu('docx', falsified, { maxArchiveBytes: 20, maxArchiveEntries: 2_000 });
    expect(limited.tekst).toBe('');
    expect(limited.powod).toContain('safe passage-indexing limit');
    expect(limited.blad).toBeUndefined();
    const tooMany = await wydobadzTekstDokumentu('docx', bytes, { maxArchiveBytes: 1_000_000, maxArchiveEntries: 0 });
    expect(tooMany.powod).toContain('too many archive entries');
  });

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
  it('limits repeated shared-string expansion before joining the output', async () => {
    const bytes = zip({
      'xl/sharedStrings.xml': `<sst><si><t>${'x'.repeat(10_000)}</t></si></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet><row>${'<c t="s"><v>0</v></c>'.repeat(5_000)}</row></worksheet>`,
    });
    const result = await wydobadzTekstDokumentu('xlsx', bytes, { maxArchiveBytes: 1_000_000, maxArchiveEntries: 2_000, maxOutputChars: 120_000 });
    expect(result.tekst).toBe('');
    expect(result.powod).toContain('safe passage-indexing output limit');
    expect(result.blad).toBeUndefined();
    const ordinary = wczytaj('przyklad.xlsx');
    expect(await wydobadzTekstDokumentu('xlsx', ordinary, { maxArchiveBytes: 1_000_000, maxArchiveEntries: 2_000, maxOutputChars: 120_000 }))
      .toEqual(await wydobadzTekstDokumentu('xlsx', ordinary));
  });

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

describe('XLSX: a row cannot start a sheet', () => {
  // `sheetUnits` reads a line `# sheetN.xml` as the start of a sheet. A cell
  // can hold exactly that text; the extractor escapes it with a backslash.
  const text = async (...sheets: string[][][]) => (await wydobadzTekstDokumentu('xlsx', workbook(...sheets))).tekst;

  it('escapes a one-cell row that reads like the line starting a sheet', async () => {
    expect(await text([['Name', 'Value'], ['one', '1'], ['# sheet7.xml'], ['two', '2']]))
      .toBe('# sheet1.xml\nName\tValue\none\t1\n\\# sheet7.xml\ntwo\t2');
  });

  it('escapes such a line after a line break inside a cell: LF, CRLF or CR', async () => {
    for (const lineBreak of ['\n', '\r\n', '\r']) {
      expect(await text([['Name', 'Value'], ['one', `note${lineBreak}# sheet7.xml`], [`# sheet7.xml${lineBreak}more`, '2']]))
        .toBe(`# sheet1.xml\nName\tValue\none\tnote${lineBreak}\\# sheet7.xml\n\\# sheet7.xml${lineBreak}more\t2`);
    }
  });

  it('escapes the last row when trimming the text would leave it reading like a sheet line', async () => {
    // `# sheet7.xml` and an empty cell end the text as `# sheet7.xml\t`, and
    // the trim takes the tab.
    expect(await text([['Name', 'Value'], ['one', '1'], ['# sheet7.xml', '']])).toBe('# sheet1.xml\nName\tValue\none\t1\n\\# sheet7.xml');
    expect(await text([['Name', 'Value'], ['# sheet7.xml \n ']])).toBe('# sheet1.xml\nName\tValue\n\\# sheet7.xml');
  });

  it('leaves near misses as they are', async () => {
    const near = ['# sheet7.xmlx', '## sheet7.xml', '# Sheet7.xml', ' # sheet7.xml', '#sheet7.xml', '# sheet.xml', '\\# sheet7.xml'];
    const rows = [['Name', 'Value'], ...near.map((cell) => [cell]), ['# sheet7.xml', 'other cell'], ['# sheet7.xml', ''], ['last', '1']];
    expect(await text(rows)).toBe(`# sheet1.xml\n${rows.map((row) => row.join('\t')).join('\n')}`);
  });

  it('escapes exactly the lines that `sheetUnits` reads as a sheet line', async () => {
    // The oracle is `sheetUnits` itself: a pattern in the extractor that is
    // narrower lets a forged line through, a broader one escapes a near miss.
    const candidates = ['# sheet7.xml', '# sheet0.xml', '# sheet1.xml', '# sheet10.xml', '# sheet007.xml', '# sheet123456789.xml',
      '# sheet7.xmlx', '## sheet7.xml', '# Sheet7.xml', '# sheet7.XML', '#  sheet7.xml', '# sheet.xml', '# sheet7xml', '# sheet٧.xml', '# sheet7.xml\t'];
    for (const candidate of candidates) {
      const read = sheetUnits(candidate).some((unit) => unit.section);
      const extracted = await text([['Name', 'Value'], [candidate], ['after', '1']]);
      expect(extracted.split('\n')[2], candidate).toBe(read ? `\\${candidate}` : candidate);
      expect(sheetUnits(canonicalText(extracted)).every((unit) => unit.place === 'sheet 1'), candidate).toBe(true);
    }
  });

  it('gives every ordinary workbook the same text as before the escape', async () => {
    // SHA-256 of the extracted text, recorded with the extractor of `c550c17`,
    // before the escape existed: the five development workbooks and the fixture.
    const before: Record<string, string> = {
      'eval/context/sets/dev/corpus/kadry/wynagrodzenia-2026.xlsx': '4f1280fd7a471a0ff7179306b45684032c71bf49e4259b8796811f7f97cf1cb9',
      'eval/context/sets/dev/corpus/oferta-zielony-dach/kosztorys.xlsx': 'e398b8759c93662c97f56fd7a55ab924099fa05965a6110b4d335a9a1111b1d3',
      'eval/context/sets/dev/corpus/sklep-wdrozenie/harmonogram-wdrozenia.xlsx': '2b040655b0ecd082fb2d232e4efca5b094604fe4c3aaf1866a300092b6864e47',
      'eval/context/sets/dev/corpus/umowy-kormoran/cennik-2026.xlsx': '6fbffe827452a67d9315e6b89fd5c772ba444a5966db1792f77848860efbf73e',
      'eval/context/sets/dev/corpus/umowy-kormoran/harmonogram-platnosci.xlsx': '63357a28541c5302d2ab0738531b5e78b78b5428ae8904b5508974f8f800c37c',
      'tests/fixtures/przyklad.xlsx': '9c38bf2c02e0cf879c5029e46fd098ab9c18bf3d8a640db108d6afed35fca93f',
    };
    for (const [path, sha] of Object.entries(before)) {
      const bytes = readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)));
      const { tekst } = await wydobadzTekstDokumentu('xlsx', new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
      expect(createHash('sha256').update(tekst, 'utf8').digest('hex'), path).toBe(sha);
    }
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
