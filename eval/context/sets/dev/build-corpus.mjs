// Rebuilds the generated files of the dev corpus.
//
//   node eval/context/sets/dev/build-corpus.mjs          DOCX, XLSX and the long API reference
//   node eval/context/sets/dev/build-corpus.mjs --pdf    also the PDFs, printed with headless Chrome
//
// Plain text and Markdown files in `corpus/` are written by hand and are not
// touched. DOCX, XLSX and `api-reference.md` come out byte for byte the same on
// every run. PDFs do not (Chrome stamps a creation date), so they are rebuilt
// only on request; their text is what `tests/eval-context.test.ts` checks.
//
// The generator is kept next to the corpus because binaries with no way to
// rebuild them are a trap: nobody can tell what is inside or add a case.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const SET = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(SET, 'corpus');
const SOURCES = join(SET, 'sources');

function write(relativePath, bytes) {
  const target = join(CORPUS, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log(`  ${relativePath} (${bytes.length} B)`);
}

// --- ZIP, without timestamps, so the output never changes -------------------

function crc32(data) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let b = 0; b < 8; b += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let sum = -1;
  for (const byte of data) sum = (sum >>> 8) ^ table[(sum ^ byte) & 0xff];
  return (sum ^ -1) >>> 0;
}

function zip(entries) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(raw, { level: 9 });
    const nameBytes = Buffer.from(name, 'utf8');
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}

// Escapes the constants below for the XML parts of a document. Nothing here
// comes from outside this file.
const xml = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// --- DOCX -------------------------------------------------------------------
//
// A paragraph is a string, or an array of runs. Word splits a sentence into
// several runs wherever the formatting changes, so some paragraphs here are
// split on purpose: the extractor has to join them back.

function docx(paragraphs) {
  const run = (piece) => {
    const { text, bold } = typeof piece === 'string' ? { text: piece, bold: false } : piece;
    return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  };
  const body = paragraphs
    .map((paragraph) => `<w:p>${(Array.isArray(paragraph) ? paragraph : [paragraph]).map(run).join('')}</w:p>`)
    .join('\n');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>\n${body}\n<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  });
}

const b = (text) => ({ text, bold: true });

// --- XLSX -------------------------------------------------------------------
//
// Sheets are `{ name, rows }`. Text cells go through the shared strings table,
// numbers are stored as numbers, the way a spreadsheet program saves them.

function xlsx(sheets) {
  const strings = [];
  const stringIndex = (value) => {
    const found = strings.indexOf(value);
    if (found >= 0) return found;
    strings.push(value);
    return strings.length - 1;
  };
  const column = (index) => String.fromCharCode(65 + index);
  const sheetXml = sheets.map(({ rows }) => {
    const body = rows.map((row, r) => {
      const cells = row.map((value, c) => {
        const ref = `${column(c)}${r + 1}`;
        return typeof value === 'number'
          ? `<c r="${ref}"><v>${value}</v></c>`
          : `<c r="${ref}" t="s"><v>${stringIndex(value)}</v></c>`;
      });
      return `<row r="${r + 1}">${cells.join('')}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>\n${body.join('\n')}\n</sheetData></worksheet>`;
  });
  const entries = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(({ name }, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  };
  sheetXml.forEach((content, i) => { entries[`xl/worksheets/sheet${i + 1}.xml`] = content; });
  entries['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t xml:space="preserve">${xml(value)}</t></si>`).join('')}</sst>`;
  return zip(entries);
}

// --- Documents --------------------------------------------------------------

console.log('DOCX');

write('umowy-kormoran/aneks-nr-1.docx', docx([
  [b('Aneks nr 1')],
  'do umowy ramowej nr 7/2026 z dnia 12 stycznia 2026 r.',
  'zawarty w dniu 20 maja 2026 r. we Wrocławiu pomiędzy spółką Pracownia Sowa sp. z o.o., zwaną dalej Wykonawcą, a spółką Księgarnia Kormoran S.A., zwaną dalej Zamawiającym.',
  [b('§ 1. '), 'Stawka programisty'],
  ['Począwszy ', 'od dnia 1 lipca 2026 r.', ' stawka za godzinę pracy programisty wzrasta ze 180 zł do 195 zł netto.'],
  'Stawki pozostałych ról z cennika stanowiącego załącznik nr 1 pozostają bez zmian.',
  [b('§ 2. '), 'Pula godzin etapu 2'],
  'Pula godzin przewidziana na etap 2 zostaje zwiększona z 400 do 520 godzin.',
  'Zwiększenie obejmuje połączenie z API hurtowni oraz program lojalnościowy.',
  [b('§ 3. '), 'Postanowienia końcowe'],
  'Pozostałe postanowienia umowy pozostają bez zmian.',
  'Aneks sporządzono w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.',
]));

write('umowy-kormoran/aneks-nr-2.docx', docx([
  [b('Aneks nr 2')],
  'do umowy ramowej nr 7/2026 z dnia 12 stycznia 2026 r.',
  'zawarty w dniu 8 września 2026 r. we Wrocławiu pomiędzy spółką Pracownia Sowa sp. z o.o., zwaną dalej Wykonawcą, a spółką Księgarnia Kormoran S.A., zwaną dalej Zamawiającym.',
  [b('§ 1. '), 'Usługa utrzymania'],
  ['Od dnia 1 października 2026 r. Wykonawca świadczy usługę utrzymania sklepu w ramach abonamentu obejmującego ', b('12 godzin miesięcznie'), '.'],
  'Godziny niewykorzystane w danym miesiącu nie przechodzą na kolejny miesiąc.',
  'Prace ponad abonament są rozliczane według stawek z cennika.',
  [b('§ 2. '), 'Termin płatności'],
  'Termin płatności faktur zostaje wydłużony do 21 dni od dnia doręczenia faktury.',
  [b('§ 3. '), 'Osoby do kontaktu'],
  'W sprawach technicznych osobą do kontaktu po stronie Zamawiającego zostaje Wiktor Żuraw. W pozostałych sprawach osobą do kontaktu pozostaje Halina Czapla.',
  [b('§ 4. '), 'Postanowienia końcowe'],
  'Pozostałe postanowienia umowy pozostają bez zmian.',
]));

write('kadry/regulamin-pracy.docx', docx([
  [b('Regulamin pracy Pracowni Sowa')],
  'Obowiązuje od 1 stycznia 2026 r.',
  [b('1. Czas pracy')],
  'Pracujemy 8 godzin dziennie, od poniedziałku do piątku. Każdy wybiera jeden z dwóch wariantów: od 8:00 do 16:00 albo od 9:00 do 17:00.',
  'Nadgodziny odbieramy jako czas wolny w ciągu 30 dni.',
  [b('2. Praca zdalna')],
  ['Z domu można pracować ', 'do 3 dni w tygodniu', '. Dni w biurze ustala zespół na początku miesiąca.'],
  'W tygodniu startu dużego wydania wszyscy pracują z biura.',
  [b('3. Sprzęt')],
  'Firma zapewnia laptop i monitor. Sprzęt prywatny nie łączy się z siecią firmową.',
  [b('4. Zwolnienia i nieobecności')],
  'Nieobecność zgłaszamy Oli do godziny 9:00 danego dnia.',
]));

write('oferta-zielony-dach/oferta.docx', docx([
  [b('Oferta: nowy serwis Fundacji Zielony Dach')],
  'Pracownia Sowa sp. z o.o., Wrocław, 28 października 2026 r.',
  [b('Zakres')],
  'Serwis informacyjny z modułem darowizn jednorazowych i cyklicznych, kalendarzem wydarzeń z zapisami, blogiem oraz wersją angielską najważniejszych stron.',
  'Zakres obejmuje warsztaty, projekt graficzny, programowanie, testy dostępności, wdrożenie i szkolenie redakcji.',
  [b('Cena')],
  ['Cena całości wynosi ', b('86 400 zł netto'), '. Szczegóły zawiera kosztorys.'],
  'Płatność w trzech ratach: 30% po podpisaniu umowy, 40% po akceptacji projektu graficznego, 30% po odbiorze.',
  [b('Termin')],
  'Czas realizacji to 14 tygodni od rozpoczęcia prac.',
  [b('Gwarancja')],
  'Udzielamy 12 miesięcy gwarancji na wykonane prace, licząc od odbioru.',
  [b('Ważność oferty')],
  'Oferta jest ważna do 30 listopada 2026 r.',
  [b('Czego oferta nie obejmuje')],
  'Kosztu audytu zewnętrznego, opłat operatora płatności oraz przygotowania treści.',
]));

console.log('XLSX');

write('umowy-kormoran/cennik-2026.xlsx', xlsx([
  {
    name: 'Stawki',
    rows: [
      ['Rola', 'Stawka netto za godzinę (zł)', 'Uwagi'],
      ['Programista', 180, 'do 30 czerwca 2026'],
      ['Projektant UX', 160, ''],
      ['Tester', 120, ''],
      ['Kierownik projektu', 200, ''],
      ['Administrator', 170, 'dyżur nocny: stawka wyższa o 50%'],
    ],
  },
  {
    name: 'Pakiety utrzymania',
    rows: [
      ['Pakiet', 'Godziny miesięcznie', 'Cena netto miesięcznie (zł)'],
      ['Mały', 8, 1400],
      ['Średni', 12, 2040],
      ['Duży', 20, 3200],
    ],
  },
]));

write('umowy-kormoran/harmonogram-platnosci.xlsx', xlsx([
  {
    name: 'Etap 1',
    rows: [
      ['Pozycja', 'Kwota netto (zł)', 'Termin faktury', 'Status'],
      ['Zaliczka', 29600, '2026-01-30', 'zapłacona'],
      ['Makiety i projekt graficzny', 37000, '2026-03-31', 'zapłacona'],
      ['Wdrożenie etapu 1', 59200, '2026-05-31', 'wystawiona'],
      ['Odbiór końcowy etapu 1', 22200, '2026-06-30', 'planowana'],
      ['Razem', 148000, '', ''],
    ],
  },
]));

write('sklep-wdrozenie/harmonogram-wdrozenia.xlsx', xlsx([
  {
    name: 'Zadania',
    rows: [
      ['Zadanie', 'Osoba', 'Od', 'Do', 'Status'],
      ['Środowisko testowe', 'Marek', '2026-02-16', '2026-02-20', 'zrobione'],
      ['Migracja danych produktów', 'Tomek', '2026-04-06', '2026-04-17', 'zrobione'],
      ['Testy obciążeniowe', 'Tomek', '2026-05-04', '2026-05-08', 'zrobione'],
      ['Szkolenie obsługi sklepu', 'Jagoda', '2026-05-11', '2026-05-12', 'zrobione'],
      ['Start produkcyjny', 'Marek', '2026-05-18', '2026-05-18', 'zrobione'],
      ['Paczkomaty', 'Marek', '2026-05-25', '2026-06-05', 'zrobione'],
      ['Program lojalnościowy', 'Marek', '2026-10-05', '2026-11-20', 'w toku'],
    ],
  },
]));

write('kadry/wynagrodzenia-2026.xlsx', xlsx([
  {
    name: 'Wynagrodzenia',
    rows: [
      ['Osoba', 'Stanowisko', 'Wynagrodzenie brutto (zł)', 'Od', 'Uwagi'],
      ['Marek Lis', 'Starszy programista', 16500, '2026-01-01', ''],
      ['Jagoda Sroka', 'Projektantka', 13200, '2026-01-01', ''],
      ['Tomek Bóbr', 'Programista', 12800, '2026-01-01', 'podwyżka od 2026-07-01 do 13600'],
    ],
  },
]));

write('oferta-zielony-dach/kosztorys.xlsx', xlsx([
  {
    name: 'Kosztorys',
    rows: [
      ['Pozycja', 'Godziny', 'Stawka netto (zł)', 'Kwota netto (zł)'],
      ['Analiza i warsztaty', 40, 200, 8000],
      ['Projekt graficzny', 110, 160, 17600],
      ['Programowanie', 260, 190, 49400],
      ['Testy i dostępność', 60, 120, 7200],
      ['Wdrożenie i szkolenie', 21, 200, 4200],
      ['Razem', 491, '', 86400],
    ],
  },
]));

// --- The long file ----------------------------------------------------------
//
// `api-reference.md` is longer than the chat's 80 000 character budget for
// files and than the 100 000 characters the search index keeps. Two facts are
// planted at known depths, and the checks below fail the build if they drift:
//   - the refunds limit sits between 80 000 and 100 000 characters: indexed,
//     but past what a whole-file context can carry;
//   - the webhook retries sit past 100 000 characters: not even indexed.

const RESOURCES = [
  ['products', 'product', 'A product is one book or other item in the catalogue.', ['title', 'isbn', 'price_gross', 'vat_rate', 'publisher_id', 'stock', 'cover_url', 'published_on']],
  ['categories', 'category', 'A category groups products in the storefront menu.', ['name', 'slug', 'parent_id', 'position', 'visible']],
  ['authors', 'author', 'An author is linked to every product they wrote or co-wrote.', ['full_name', 'slug', 'biography', 'born_on', 'website']],
  ['publishers', 'publisher', 'A publisher supplies products and their cover images.', ['name', 'slug', 'country', 'contact_name', 'discount_percent']],
  ['series', 'series', 'A series orders products that belong together, such as the volumes of a saga.', ['name', 'slug', 'volumes', 'complete']],
  ['carts', 'cart', 'A cart holds the items a customer intends to buy.', ['customer_id', 'currency', 'items_count', 'total_gross', 'expires_at']],
  ['cart-items', 'cart item', 'A cart item is one product in a cart with its quantity.', ['cart_id', 'product_id', 'quantity', 'unit_price_gross', 'added_at']],
  ['customers', 'customer', 'A customer is a person with an account in the shop.', ['email', 'full_name', 'phone', 'marketing_consent', 'registered_at', 'last_order_at']],
  ['addresses', 'address', 'An address is a delivery or billing address saved by a customer.', ['customer_id', 'kind', 'street', 'postal_code', 'city', 'country']],
  ['orders', 'order', 'An order is created when a customer checks out a cart.', ['number', 'customer_id', 'status', 'total_gross', 'delivery_method', 'placed_at', 'paid_at']],
  ['order-items', 'order item', 'An order item is one product on an order, with the price at the time of purchase.', ['order_id', 'product_id', 'quantity', 'unit_price_gross', 'vat_rate']],
  ['payments', 'payment', 'A payment records one attempt to pay for an order through the payment operator.', ['order_id', 'method', 'status', 'amount_gross', 'operator_reference', 'confirmed_at']],
  ['shipments', 'shipment', 'A shipment is a parcel sent to the customer for an order.', ['order_id', 'carrier', 'tracking_number', 'status', 'shipped_at', 'delivered_at']],
  ['parcel-lockers', 'parcel locker', 'A parcel locker is a pick-up point a customer can choose at checkout.', ['code', 'city', 'street', 'opening_hours', 'active']],
  ['coupons', 'coupon', 'A coupon lowers the price of an order when its code is entered at checkout.', ['code', 'percent_off', 'amount_off', 'valid_from', 'valid_to', 'usage_limit']],
  ['gift-cards', 'gift card', 'A gift card carries a balance that can pay for all or part of an order.', ['code', 'initial_balance', 'balance', 'issued_at', 'expires_at']],
  ['wishlists', 'wishlist', 'A wishlist keeps the products a signed-in customer saved for later.', ['customer_id', 'name', 'items_count', 'shared', 'updated_at']],
  ['reviews', 'review', 'A review is a rating and comment a customer left for a product.', ['product_id', 'customer_id', 'rating', 'body', 'approved', 'created_at']],
  ['inventory', 'inventory record', 'An inventory record holds the stock level of a product as last imported from the warehouse.', ['product_id', 'quantity', 'reserved', 'warehouse_code', 'imported_at']],
  ['price-lists', 'price list', 'A price list overrides catalogue prices for a period, for example during a sale.', ['name', 'starts_at', 'ends_at', 'percent_off', 'active']],
  ['delivery-zones', 'delivery zone', 'A delivery zone sets the delivery price for a group of postal codes.', ['name', 'postal_code_from', 'postal_code_to', 'price_gross', 'free_from_gross']],
  ['stock-alerts', 'stock alert', 'A stock alert notifies a customer when a product is back in stock.', ['product_id', 'customer_id', 'email', 'notified_at']],
  ['banners', 'banner', 'A banner is a promotional picture shown on the storefront home page.', ['title', 'image_url', 'link_url', 'position', 'visible', 'starts_at', 'ends_at']],
  ['refunds', 'refund', 'A refund returns money to the customer for all or part of a payment.', ['payment_id', 'amount_gross', 'reason', 'status', 'requested_at', 'completed_at']],
  ['returns', 'return', 'A return tracks products a customer sends back.', ['order_id', 'reason', 'status', 'received_at', 'restocked']],
  ['invoices', 'invoice', 'An invoice is the accounting document issued for a paid order.', ['order_id', 'number', 'total_gross', 'issued_on', 'pdf_url']],
  ['newsletter-subscribers', 'newsletter subscriber', 'A newsletter subscriber is an address that agreed to receive the shop newsletter.', ['email', 'confirmed', 'source', 'subscribed_at']],
  ['reports', 'report', 'A report is a generated summary, such as sales per day or stock below a threshold.', ['kind', 'period_from', 'period_to', 'status', 'download_url']],
  ['webhooks', 'webhook', 'A webhook is an address the shop notifies when something happens, such as a paid order.', ['url', 'events', 'active', 'last_delivery_at', 'failures']],
  ['api-keys', 'API key', 'An API key identifies an integration that calls this API.', ['label', 'scopes', 'last_used_at', 'expires_at']],
];

const SPECIAL = {
  refunds: 'Creating refunds is limited to 20 requests per minute per API key. This limit is separate from the general limit and cannot be raised.',
  webhooks: 'A failed webhook delivery is retried 8 times with exponential backoff. The last attempt happens about 36 hours after the first, and after that the webhook is marked as failing.',
};

const FIELD_NOTES = {
  id: 'Identifier, assigned by the shop.',
  created_at: 'When the record was created, in UTC.',
  updated_at: 'When the record last changed, in UTC.',
};

function fieldType(name) {
  if (name.endsWith('_at') || name.endsWith('_on') || name.endsWith('_from') || name.endsWith('_to')) return 'date-time';
  if (name.endsWith('_id')) return 'string';
  if (/price|total|amount|balance|percent|rate|quantity|count|stock|position|volumes|rating|reserved|limit|failures/.test(name)) return 'number';
  if (/visible|active|consent|complete|shared|approved|restocked|confirmed/.test(name)) return 'boolean';
  if (name === 'events' || name === 'scopes') return 'array of strings';
  return 'string';
}

function exampleValue(name, index) {
  const type = fieldType(name);
  if (type === 'date-time') return `"2026-0${(index % 9) + 1}-1${index % 9}T10:${String(10 + index).padStart(2, '0')}:00Z"`;
  if (type === 'number') return String(10 + index * 7);
  if (type === 'boolean') return index % 2 === 0 ? 'true' : 'false';
  if (type === 'array of strings') return '["order.paid", "order.shipped"]';
  if (name.endsWith('_id')) return `"${name.slice(0, 3)}_${String(1000 + index * 37)}"`;
  return `"example ${name.replaceAll('_', ' ')}"`;
}

function resourceSection([path, noun, intro, fields], index) {
  const title = path.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  const all = ['id', ...fields, 'created_at', 'updated_at'];
  const table = all.map((name) => {
    const note = FIELD_NOTES[name] ?? `The ${name.replaceAll('_', ' ')} of the ${noun}.`;
    return `| \`${name}\` | ${fieldType(name)} | ${note} |`;
  }).join('\n');
  const example = all.map((name, i) => `  "${name}": ${name === 'id' ? `"${path.slice(0, 3)}_${2000 + index}"` : exampleValue(name, i + index)}`).join(',\n');
  const filter = fields[0];
  const sort = fields[Math.min(1, fields.length - 1)];
  const writable = fields.filter((name) => !name.endsWith('_at')).slice(0, 5).map((name) => `\`${name}\``).join(', ');
  const required = fields.slice(0, 2).map((name) => `\`${name}\``).join(' and ');

  return `## ${title}

${intro}${SPECIAL[path] ? ` ${SPECIAL[path]}` : ''}

### The ${noun} object

| Field | Type | Description |
| --- | --- | --- |
${table}

\`\`\`json
{
${example}
}
\`\`\`

### List ${path}

\`GET /v1/${path}\`

Returns a page of ${path}, newest first. Use \`limit\` (up to 100, default 25) and \`cursor\` to page through the results. The response carries \`next_cursor\` when more records exist.

| Parameter | Description |
| --- | --- |
| \`${filter}\` | Only return records whose ${filter.replaceAll('_', ' ')} matches exactly. |
| \`sort\` | \`${sort}\` or \`created_at\`, prefixed with \`-\` for descending order. |
| \`updated_since\` | Only return records changed after this moment. |

Requires the \`${path}:read\` scope.

### Retrieve a ${noun}

\`GET /v1/${path}/{id}\`

Returns one ${noun}. Responds with \`404\` when the ${noun} does not exist or the key has no access to it.

### Create a ${noun}

\`POST /v1/${path}\`

Creates a ${noun}. ${required} are required. Send an \`Idempotency-Key\` header to make a retry safe: a repeated request with the same key returns the first result instead of creating a second ${noun}.

Responds with \`201\` and the new ${noun}, or with \`422\` and a list of invalid fields. Requires the \`${path}:write\` scope.

### Update a ${noun}

\`PATCH /v1/${path}/{id}\`

Changes the fields sent in the body and leaves the others as they are. These fields can be changed: ${writable}. A request that sends an unknown field is refused with \`422\`.

### Delete a ${noun}

\`DELETE /v1/${path}/{id}\`

Removes the ${noun}. Deleting is refused with \`409\` while other records still refer to it. Requires the \`${path}:write\` scope.

### Example: create a ${noun}

\`\`\`http
POST /v1/${path}
Authorization: Bearer <api key>
Idempotency-Key: ${path.slice(0, 3)}-${3000 + index * 11}
Content-Type: application/json

{
${fields.filter((name) => !name.endsWith('_at')).slice(0, 4).map((name, i) => `  "${name}": ${exampleValue(name, i + index + 3)}`).join(',\n')}
}
\`\`\`

The response repeats the ${noun} as stored, with its \`id\` and both timestamps filled in.

### Errors for ${path}

| Status | Code | When |
| --- | --- | --- |
| \`400\` | \`invalid_json\` | The body is not valid JSON. |
| \`403\` | \`missing_scope\` | The key lacks \`${path}:read\` or \`${path}:write\`. |
| \`404\` | \`${path.replaceAll('-', '_')}_not_found\` | No ${noun} has this identifier. |
| \`409\` | \`${path.replaceAll('-', '_')}_in_use\` | The ${noun} cannot be deleted while it is referred to. |
| \`422\` | \`invalid_fields\` | One or more fields failed validation; see \`fields\`. |

### Events for ${path}

The shop emits \`${path.replaceAll('-', '_')}.created\`, \`${path.replaceAll('-', '_')}.updated\` and \`${path.replaceAll('-', '_')}.deleted\`. A webhook subscribed to them receives the ${noun} object as it was right after the change.

### Notes on ${path}

- Lists are read from the database replica. A ${noun} created a moment ago can take up to five seconds to show up in a list, while retrieving it by identifier works at once.
- Text fields are trimmed, and an empty string is stored as \`null\`.
- A deleted ${noun} stays restorable from the admin panel for 30 days, then it is removed for good.
`;
}

const apiReference = `# Kormoran Shop API reference

Version 1. This document describes every resource of the shop API in the same order as the admin panel menu.

## Conventions

- **Base address.** All paths are relative to the API host of the environment you were given.
- **Authentication.** Send the API key in the \`Authorization\` header as a bearer token. Keys are created in the admin panel and carry scopes.
- **Format.** Requests and responses are JSON, encoded as UTF-8. Dates are in UTC.
- **Money.** Amounts are in grosze, as whole numbers. A price of 39,90 zł is sent as \`3990\`.
- **General limit.** Every API key may send 600 requests per minute in total. A request over the limit gets \`429\` with a \`Retry-After\` header.
- **Errors.** An error response has a \`code\`, a \`message\` meant for developers and, for \`422\`, a list of \`fields\`.
- **Paging.** List endpoints return at most 100 records per page and a \`next_cursor\`.

${RESOURCES.map(resourceSection).join('\n')}
## Changes to this API

Breaking changes get a new version prefix. Additions, such as new fields and endpoints, are made within version 1 and announced in the changelog.
`;

const refundsAt = apiReference.indexOf('limited to 20 requests per minute');
const webhooksAt = apiReference.indexOf('retried 8 times');
const referenceBytes = Buffer.byteLength(apiReference, 'utf8');
if (refundsAt <= 80_000 || refundsAt >= 100_000) throw new Error(`The refunds limit sits at character ${refundsAt}; it must be between 80 000 and 100 000.`);
if (webhooksAt <= 100_000) throw new Error(`The webhook retries sit at character ${webhooksAt}; they must be past 100 000.`);
if (referenceBytes >= 300_000) throw new Error(`api-reference.md is ${referenceBytes} bytes; plain text over 300 000 bytes is not read at all.`);

console.log('Long file');
write('sklep-wdrozenie/api-reference.md', Buffer.from(apiReference, 'utf8'));
console.log(`    ${apiReference.length} characters; refunds limit at ${refundsAt}, webhook retries at ${webhooksAt}`);

// --- PDFs, printed with headless Chrome ------------------------------------

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

function chrome(executable, args) {
  execFileSync(executable, ['--headless=new', '--disable-gpu', '--hide-scrollbars', ...args], { stdio: 'ignore' });
}

if (process.argv.includes('--pdf')) {
  const executable = findChrome();
  if (!executable) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium executable.');
  console.log('PDF');
  const scratch = mkdtempSync(join(tmpdir(), 'eval-corpus-'));
  try {
    const print = (source, target) => {
      const output = join(scratch, 'out.pdf');
      chrome(executable, ['--no-pdf-header-footer', `--print-to-pdf=${output}`, pathToFileURL(source).href]);
      write(target, readFileSync(output));
    };

    print(join(SOURCES, 'umowy-kormoran/umowa-ramowa.html'), 'umowy-kormoran/umowa-ramowa.pdf');
    print(join(SOURCES, 'umowy-kormoran/sla.html'), 'umowy-kormoran/sla.pdf');
    print(join(SOURCES, 'oferta-zielony-dach/brief-klienta.html'), 'oferta-zielony-dach/brief-klienta.pdf');

    // The "scan": the page is rendered to a picture first, and the PDF holds
    // only that picture, so it has no text layer, like a document from a
    // scanner.
    const picture = join(scratch, 'scan.png');
    chrome(executable, ['--window-size=794,1123', `--screenshot=${picture}`, pathToFileURL(join(SOURCES, 'umowy-kormoran/protokol-odbioru-etap-1-skan.html')).href]);
    const wrapper = join(scratch, 'scan.html');
    writeFileSync(wrapper, `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: A4; margin: 0; } html, body { margin: 0; } img { display: block; width: 210mm; height: 297mm; }</style></head><body><img alt="" src="data:image/png;base64,${readFileSync(picture).toString('base64')}"></body></html>`);
    print(wrapper, 'umowy-kormoran/protokol-odbioru-etap-1-skan.pdf');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
