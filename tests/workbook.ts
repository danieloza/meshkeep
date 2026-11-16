import { deflateRawSync } from 'node:zlib';

// Real OOXML archives built in memory: a ZIP with deflate-compressed entries,
// read by the same code as an uploaded file. Shared by the extractor, chunk,
// evaluator and API tests.

export function zip(entries: Record<string, string>): Uint8Array<ArrayBuffer> {
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

// A workbook with one sheet per argument, each a list of rows of cells, every
// cell a shared string as Excel writes it. A cell's text goes in verbatim, line
// breaks and carriage returns included.
export function workbook(...sheets: string[][][]): Uint8Array<ArrayBuffer> {
  const strings = [...new Set(sheets.flat(2))];
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const entries: Record<string, string> = {
    'xl/sharedStrings.xml': `<sst>${strings.map((value) => `<si><t>${escape(value)}</t></si>`).join('')}</sst>`,
  };
  sheets.forEach((rows, index) => {
    const cells = rows.map((row) => `<row>${row.map((value) => `<c t="s"><v>${strings.indexOf(value)}</v></c>`).join('')}</row>`).join('');
    entries[`xl/worksheets/sheet${index + 1}.xml`] = `<worksheet><sheetData>${cells}</sheetData></worksheet>`;
  });
  return zip(entries);
}
