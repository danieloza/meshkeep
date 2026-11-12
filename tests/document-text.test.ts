import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
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

// Minimal compressed ZIP, generated in memory for the shared-string expansion test.
function zip(entries: Record<string, string>): Uint8Array<ArrayBuffer> {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const filename = Buffer.from(name);
    const raw = Buffer.from(value);
    const compressed = deflateRawSync(raw);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(filename.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    local.push(header, filename, compressed);
    central.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

describe('DOCX', () => {
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
