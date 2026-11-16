import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { CHUNK_RULE, chunkLocator, chunksOf, type Document } from '@/lib/context-chunking';
import { buildContextChunks, chunksFromRows, contextDocument, limitContextText, limitPdfPages, MAX_FILE_CHUNKS } from '@/lib/context-document';
import { wydobadzTekstDokumentu } from '@/lib/document-text';
import { workbook } from './workbook';

const file = { id: 'file-a', projectId: 'project-a', relativePath: 'docs/test.md', sha256: 'a'.repeat(64) };

describe('context documents', () => {
  it('keeps source slices and exact heading labels through a long cut', async () => {
    const source = '# Contract\n\n## Charges\n\n' + 'x'.repeat(1_495) + 'ABCDEF1234' + 'y'.repeat(5_500);
    const document = contextDocument('md', source);
    const { rows, truncated } = await buildContextChunks(file, document);
    expect(truncated).toBe(false);
    expect(rows.length).toBeGreaterThan(2);
    for (const [index, row] of rows.entries()) {
      // Version 2: the stored text runs from the end of the previous chunk.
      expect(row.content).toBe(document.text.slice(index ? rows[index - 1].endChar : row.startChar, row.endChar));
      expect(row.projectId).toBe(file.projectId);
      expect(row.chunkKey).toMatch(/^[0-9a-f]{20}$/);
    }
    expect(rows.some((row) => row.heading === 'Contract › Charges')).toBe(true);
  });

  it('requires real PDF page boundaries and labels each page', async () => {
    expect(() => contextDocument('pdf', 'merged')).toThrow(/pages/);
    const document = contextDocument('pdf', 'ignored', ['First page.', '', 'Third page.']);
    const { rows } = await buildContextChunks(file, document);
    expect(rows.map((row) => row.place)).toEqual(['page 1', 'page 3']);
    expect(rows[1].label).toBe('[page 3]');
  });

  it('limits PDF text without losing page numbering or splitting Unicode', () => {
    const result = limitPdfPages(['abc', '', 'xy😀z', 'later'], 7);
    expect(result.truncated).toBe(true);
    expect(result.pages).toEqual(['abc', '', 'xy', '']);
    const document = contextDocument('pdf', '', result.pages);
    expect(document.text).toBe('abc\n\nxy');
    expect(document.units.map((unit) => unit.place)).toEqual(['page 1', 'page 3']);
    expect(limitPdfPages(['abc', '😀more', 'later'], 6).pages).toEqual(['abc', '', '']);
  });

  it('bounds extracted text at a Unicode boundary before creating units', () => {
    const result = limitContextText('x'.repeat(119_999) + '😀tail');
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(119_999);
    expect(contextDocument('txt', result.text).text).toBe(result.text);
  });

  it('gives identical bytes the same stamp but different file addresses', async () => {
    const document = contextDocument('txt', 'identical text');
    const a = (await buildContextChunks(file, document)).rows[0];
    const b = (await buildContextChunks({ ...file, id: 'file-b', relativePath: 'copy.txt' }, document)).rows[0];
    const changed = (await buildContextChunks({ ...file, sha256: 'b'.repeat(64) }, document)).rows[0];
    expect(a.chunkKey).toBe(b.chunkKey);
    expect(a.fileId).not.toBe(b.fileId);
    expect(a.chunkKey).not.toBe(changed.chunkKey);
  });

  it('reports the chunk limit rather than hiding truncation', async () => {
    const text = Array.from({ length: MAX_FILE_CHUNKS + 2 }, (_, index) => `# Section ${index}\n\n${'x'.repeat(1_000)}`).join('\n\n');
    const result = await buildContextChunks(file, contextDocument('md', text));
    expect(result.rows).toHaveLength(MAX_FILE_CHUNKS);
    expect(result.truncated).toBe(true);
  });
});

// The chat rebuilds chunks from stored rows (`chunksFromRows`) and hands them
// to the shared selection. These tests pin that the rebuilt chunks are the
// ones `chunksOf` made, so the chat chooses and sends what the simulation does.
const DEV_CORPUS = join(import.meta.dirname, '..', 'eval', 'context', 'sets', 'dev', 'corpus');

function bytesOf(path: string): Uint8Array<ArrayBuffer> {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

// As `readContextDocument` reads a file, without R2: PDF page by page, other
// formats through the ordinary extractor.
async function devDocument(file: string): Promise<Document> {
  const path = join(DEV_CORPUS, file);
  const extension = file.split('.').pop()!.toLowerCase();
  if (extension === 'pdf') {
    const { text } = await extractText(await getDocumentProxy(bytesOf(path)), { mergePages: false });
    return contextDocument('pdf', '', limitPdfPages(text).pages);
  }
  if (extension === 'docx' || extension === 'xlsx') return contextDocument(extension, (await wydobadzTekstDokumentu(extension, bytesOf(path))).tekst);
  return contextDocument(extension, limitContextText(new TextDecoder().decode(bytesOf(path)).replaceAll('\0', '')).text);
}

const FIXTURES: Array<[string, Document]> = [
  ['a cut inside a word', contextDocument('md', `# Contract\n\n## Charges\n\n${'x'.repeat(1_495)}ABCDEF1234${'y'.repeat(5_500)}\n\nAfter.`)],
  ['a long spaced line', contextDocument('txt', `Intro.\n\n${Array.from({ length: 1_500 }, (_, index) => `word${index}`).join(' ')}\n\nOutro.`)],
  ['a long line of supplementary characters', contextDocument('txt', `${'x'.repeat(CHUNK_RULE.targetChars - 1)}${'😀'.repeat(2_000)}`)],
  ['CRLF and blank lines holding spaces', contextDocument('txt', `${'First. '.repeat(150)}\r\n \t\r\n${'Second. '.repeat(150)}\r\n\r\n\r\n${'Third. '.repeat(150)}`)],
  ['a sheet with a header too long for its label', contextDocument('xlsx', `# sheet1.xml\n${Array.from({ length: 200 }, (_, index) => `Column ${index}`).join('\t')}\n${Array.from({ length: 300 }, (_, index) => `row ${index}\t${index}`).join('\n')}\n# sheet2.xml\nName\tValue\nlast\t1`)],
  ['a heading inside a fence and leading blank lines', contextDocument('md', `\n\n# Setup\n\n\`\`\`bash\n# not a heading\n\nnpm ci\n\`\`\`\n\n## Next\n\n${'Body text. '.repeat(400)}`)],
  ['PDF pages', contextDocument('pdf', '', ['Page one.\n\nSecond paragraph.', '', `${'p '.repeat(2_000)}end`])],
];

async function expectRoundTrip(document: Document) {
  const { rows } = await buildContextChunks({ id: 'f', projectId: 'p', relativePath: 'x', sha256: 'a'.repeat(64) }, document);
  const original = chunksOf(document, true).slice(0, MAX_FILE_CHUNKS);
  // A scanned PDF has no text and no chunks; nothing to read back.
  if (!rows.length) { expect(original).toEqual([]); return { rows, original }; }
  const rebuilt = chunksFromRows(rows);
  if ('failure' in rebuilt) throw new Error(rebuilt.failure);
  expect(rebuilt.chunks).toEqual(original);
  for (const [index, chunk] of original.entries()) {
    // The slice is bounded; `content` may be longer by its gap.
    expect(chunk.end - chunk.start).toBeLessThanOrEqual(CHUNK_RULE.maxChars);
    // Every gap between chunks is whitespace, so it adds no search term.
    if (index) expect(document.text.slice(original[index - 1].end, chunk.start)).toMatch(/^\s*$/);
  }
  if (original.length) {
    expect(rebuilt.document.text.slice(original[0].start)).toBe(document.text.slice(original[0].start, original.at(-1)!.end));
  }
  return { rows, original };
}

describe('stored chunks, read back', () => {
  it.each(FIXTURES)('rebuilds the chunks of %s', async (_, document) => {
    const { original } = await expectRoundTrip(document);
    expect(original.length).toBeGreaterThan(1);
  });

  it('rebuilds the chunks of every file in the development corpus', async () => {
    const files = readdirSync(DEV_CORPUS, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(DEV_CORPUS.length + 1).replaceAll('\\', '/'));
    expect(files.length).toBe(38);
    let chunked = 0;
    for (const file of files) {
      const { original } = await expectRoundTrip(await devDocument(file));
      if (original.length) chunked += 1;
    }
    expect(chunked).toBeGreaterThan(30);
  }, 60_000);

  it('marks the pieces of a cut unit, and only them, as continuing', async () => {
    const document = FIXTURES[0][1];
    const { rows } = await buildContextChunks({ id: 'f', projectId: 'p', relativePath: 'x', sha256: 'a'.repeat(64) }, document);
    const rebuilt = chunksFromRows(rows);
    if ('failure' in rebuilt) throw new Error(rebuilt.failure);
    expect(rebuilt.chunks.filter((chunk) => chunk.continuesPrevious).length).toBeGreaterThan(0);
    expect(rebuilt.chunks.map((chunk) => chunk.continuesPrevious)).toEqual(chunksOf(document, true).map((chunk) => chunk.continuesPrevious));
  });

  it('refuses rows that do not fit together instead of sending a wrong span', async () => {
    const { rows } = await buildContextChunks({ id: 'f', projectId: 'p', relativePath: 'x', sha256: 'a'.repeat(64) }, FIXTURES[1][1]);
    expect(chunksFromRows([])).toEqual({ failure: expect.any(String) });
    expect(chunksFromRows(rows.slice(1))).toEqual({ failure: expect.stringContaining('contiguous') });
    expect(chunksFromRows(rows.map((row, index) => (index === 1 ? { ...row, content: row.content.slice(1) } : row)))).toEqual({ failure: expect.stringContaining('offsets') });
    expect(chunksFromRows(rows.map((row, index) => (index === 1 ? { ...row, label: '[forged]' } : row)))).toEqual({ failure: expect.stringContaining('label') });
  });
});

describe('a workbook cell that reads like the line starting a sheet', () => {
  // Through the real extractor: the rows after such a cell stay on their sheet,
  // under their sheet's header, and a real second sheet still starts.
  const before = Array.from({ length: 120 }, (_, index) => [`item ${index}`, `value ${index}`]);
  const after = Array.from({ length: 120 }, (_, index) => [`after ${index}`, `amount ${index}`]);

  it.each(['# sheet7.xml', '# sheet1.xml', '# sheet2.xml'])('keeps the rows after a cell "%s" on sheet 1, under its header', async (forged) => {
    const bytes = workbook([['Name', 'Value'], ...before, [forged], ...after], [['Role', 'Rate'], ['Tester', '120']]);
    const document = contextDocument('xlsx', (await wydobadzTekstDokumentu('xlsx', bytes)).tekst);
    expect(document.text).toContain(`item 119\tvalue 119\n\\${forged}\nafter 0\tamount 0`);
    const chunks = chunksOf(document, true);
    const header = (chunk: (typeof chunks)[number]) => chunk.searchHeader ?? chunk.header;
    const first = chunks.filter((chunk) => chunk.place === 'sheet 1');
    expect(first.length).toBeGreaterThan(2);
    expect(chunks.slice(0, first.length)).toEqual(first);
    for (const chunk of first) {
      expect(header(chunk)).toBe('Name\tValue');
      expect(chunkLocator(chunk)).toEqual({ sheet: 1 });
    }
    expect(first.find((chunk) => chunk.text.includes('after 0\t'))).toBeDefined();
    const second = chunks.slice(first.length);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ place: 'sheet 2', header: 'Role\tRate' });
    expect(chunkLocator(second[0])).toEqual({ sheet: 2 });
    await expectRoundTrip(document);
  });
});
