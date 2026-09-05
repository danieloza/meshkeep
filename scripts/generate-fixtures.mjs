// Odtwarza pliki testowe uzywane przez `tests/document-text.test.ts`.
//
//   node scripts/generate-fixtures.mjs
//
// Trzymamy generator w repozytorium, bo binaria bez sposobu odtworzenia to
// pulapka: za rok nikt nie bedzie wiedzial, co dokladnie jest w srodku ani jak
// dolozyc kolejny przypadek.

import { deflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KATALOG = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
mkdirSync(KATALOG, { recursive: true });

// --- minimalny zapis ZIP ---------------------------------------------------

function crc32(dane) {
  let tabela = crc32.tabela;
  if (!tabela) {
    tabela = crc32.tabela = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let b = 0; b < 8; b += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[i] = c;
    }
  }
  let suma = -1;
  for (const bajt of dane) suma = (suma >>> 8) ^ tabela[(suma ^ bajt) & 0xff];
  return (suma ^ -1) >>> 0;
}

function zapiszZip(sciezka, wpisy) {
  const czesci = [];
  const katalog = [];
  let offset = 0;

  for (const [nazwa, tekst] of Object.entries(wpisy)) {
    const surowe = Buffer.from(tekst, 'utf8');
    const spakowane = deflateRawSync(surowe);
    const nazwaBuf = Buffer.from(nazwa, 'utf8');
    const suma = crc32(surowe);

    const lokalny = Buffer.alloc(30);
    lokalny.writeUInt32LE(0x04034b50, 0);
    lokalny.writeUInt16LE(20, 4);
    lokalny.writeUInt16LE(8, 8);
    lokalny.writeUInt32LE(suma, 14);
    lokalny.writeUInt32LE(spakowane.length, 18);
    lokalny.writeUInt32LE(surowe.length, 22);
    lokalny.writeUInt16LE(nazwaBuf.length, 26);
    czesci.push(lokalny, nazwaBuf, spakowane);

    const wpis = Buffer.alloc(46);
    wpis.writeUInt32LE(0x02014b50, 0);
    wpis.writeUInt16LE(20, 4);
    wpis.writeUInt16LE(20, 6);
    wpis.writeUInt16LE(8, 10);
    wpis.writeUInt32LE(suma, 16);
    wpis.writeUInt32LE(spakowane.length, 20);
    wpis.writeUInt32LE(surowe.length, 24);
    wpis.writeUInt16LE(nazwaBuf.length, 28);
    wpis.writeUInt32LE(offset, 42);
    katalog.push(wpis, nazwaBuf);

    offset += lokalny.length + nazwaBuf.length + spakowane.length;
  }

  const daneKatalogu = Buffer.concat(katalog);
  const koniec = Buffer.alloc(22);
  koniec.writeUInt32LE(0x06054b50, 0);
  koniec.writeUInt16LE(Object.keys(wpisy).length, 8);
  koniec.writeUInt16LE(Object.keys(wpisy).length, 10);
  koniec.writeUInt32LE(daneKatalogu.length, 12);
  koniec.writeUInt32LE(offset, 16);

  const plik = Buffer.concat([...czesci, daneKatalogu, koniec]);
  writeFileSync(join(KATALOG, sciezka), plik);
  console.log(`  ${sciezka} (${plik.length} B)`);
}

// --- DOCX ------------------------------------------------------------------
// Pierwszy akapit jest rozbity na trzy przebiegi `<w:t>` - tak Word zapisuje
// tekst ze zmiennym formatowaniem. Trzeci sprawdza `<w:br/>`.
zapiszZip('przyklad.docx', {
  '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Zazolc gesla</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t>jazn</w:t></w:r></w:p>
<w:p><w:r><w:t>Druga linia z polskimi znakami: \u017c\u00f3\u0142\u0107 &amp; \u015bwi\u0119ta</w:t></w:r></w:p>
<w:p><w:r><w:t>Trzecia</w:t></w:r><w:br/><w:r><w:t>po lamaniu</w:t></w:r></w:p>
</w:body></w:document>`,
});

// --- XLSX ------------------------------------------------------------------
zapiszZip('przyklad.xlsx', {
  '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
  'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
<si><t>Nazwa</t></si><si><t>Kwota</t></si><si><t>Faktura wrzesie\u0144</t></si><si><t>Zaliczka</t></si>
</sst>`,
  'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1230.50</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>400</v></c></row>
</sheetData></worksheet>`,
});

// --- PPTX ------------------------------------------------------------------
// Numeracja 1, 2, 10 sprawdza sortowanie po liczbie, a nie po nazwie.
const slajd = (tytul, tresc) => `<?xml version="1.0" encoding="UTF-8"?>`
  + `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">`
  + `<a:p><a:r><a:t>${tytul}</a:t></a:r></a:p><a:p><a:r><a:t>${tresc}</a:t></a:r></a:p></p:sld>`;
zapiszZip('przyklad.pptx', {
  '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
  'ppt/slides/slide1.xml': slajd('Slajd pierwszy', 'Wprowadzenie'),
  'ppt/slides/slide2.xml': slajd('Slajd drugi', 'Rozwiniecie'),
  'ppt/slides/slide10.xml': slajd('Slajd dziesiaty', 'Podsumowanie'),
});

// --- RTF -------------------------------------------------------------------
// `\\uN ?` to zapis Worda: prawdziwy punkt kodowy plus znak zastepczy dla
// czytnikow bez Unicode.
const u = (kod) => `\\u${kod} ?`;
const rtf = `{\\rtf1\\ansi\\ansicpg1250\\deff0`
  + `{\\fonttbl{\\f0\\fnil Calibri;}}`
  + `{\\colortbl ;\\red0\\green0\\blue0;}`
  + `{\\*\\generator Riched20 10.0;}`
  + `\\pard Pierwsza linia\\par `
  + `Za${u(380)}${u(243)}${u(322)}${u(263)} g${u(281)}${u(347)}l${u(261)} ja${u(378)}${u(324)}`
  + `\\par Ostatnia linia}`;
writeFileSync(join(KATALOG, 'przyklad.rtf'), rtf, 'utf8');
console.log(`  przyklad.rtf (${rtf.length} B)`);

// --- PDF -------------------------------------------------------------------
// Skladany recznie, zeby miec pewnosc co do zawartosci i nie ciagnac
// biblioteki tylko po to, zeby wygenerowac plik testowy.
const strumien = 'BT /F1 18 Tf 72 720 Td (Umowa serwisowa numer 2026/09/17) Tj ET\n'
  + 'BT /F1 12 Tf 72 690 Td (Zleceniobiorca zobowiazuje sie do utrzymania systemu.) Tj ET\n'
  + 'BT /F1 12 Tf 72 670 Td (Wynagrodzenie miesieczne: 4200 PLN netto.) Tj ET\n';
const obiekty = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${strumien.length} >>\nstream\n${strumien}endstream`,
];
let pdf = '%PDF-1.4\n';
const offsety = [];
obiekty.forEach((obiekt, i) => {
  offsety.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${obiekt}\nendobj\n`;
});
const xref = pdf.length;
pdf += `xref\n0 ${obiekty.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsety) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${obiekty.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(join(KATALOG, 'umowa.pdf'), pdf, 'latin1');
console.log(`  umowa.pdf (${pdf.length} B)`);

// Plik udajacy dokument - sprawdza sciezke bledu, nie sciezke sukcesu.
writeFileSync(join(KATALOG, 'uszkodzony.docx'), 'to nie jest zip, tylko zwykly tekst udajacy dokument', 'utf8');
console.log('  uszkodzony.docx');
