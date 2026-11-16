import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { canonicalText, chunksOf, markdownUnits, passageRuns, type Document } from '@/eval/context/chunking';
import { quoteDelivered } from '@/eval/context/measure';
import { readPassageSection, sourcePassageDelivered, type SentPassage } from '@/eval/context/passages';
import { sourceChunks } from '@/eval/context/sources';
import { contextDocument } from '@/lib/context-document';

vi.mock('@/db', () => ({ getDb: () => { throw new Error('No database in these tests.'); } }));
import { choosePassages } from '@/lib/server/context-passages';
import { workbook } from './workbook';

// The evaluator reads a passage section back against its source: run
// boundaries, labels and bodies from the source chunks by the sender's own
// rule, every manifest entry checked, and a quote credited only inside the
// source region of its expected place (`sourcePassageTexts`).

const SET = join(import.meta.dirname, '..', 'eval', 'context', 'sets', 'dev');
const LONG = 'sklep-wdrozenie/api-reference.md';
const longDocument: Document = (() => {
  const text = canonicalText(readFileSync(join(SET, 'corpus', LONG), 'utf8'));
  return { text, units: markdownUnits(text) };
})();
const longChunks = chunksOf(longDocument, true);
const questions = JSON.parse(readFileSync(join(SET, 'questions.json'), 'utf8')).questions as Array<{ id: string; expected: Array<{ file: string; quote: string; locator?: { heading: string } }> }>;
const expected = (id: string) => questions.find((question) => question.id === id)!.expected.find((source) => source.file === LONG)!;

type Chunks = ReturnType<typeof chunksOf>;
const noteOf = (count: number, total: number) => `[Passages of a longer file: ${count} of ${total}.]`;

// What the chat sends for the given ranking, read back as the runner reads it.
function send(document: Document, chunks: Chunks, ranked: number[], keys?: string[]) {
  const choice = choosePassages(document, chunks, keys ?? chunks.map(() => 'a'.repeat(20)), ranked, 6_000);
  if (!choice) throw new Error('Nothing fits.');
  const section = `${noteOf(choice.passages.length, chunks.length)}\n${choice.text}`;
  return { ...choice, section, ...readPassageSection(section, choice.passages, { document, chunks, keys }) };
}
const md = (text: string) => contextDocument('md', text);
const padding = (word: string) => `${`${word} filler text that only takes room. `.repeat(40)}\n\n`;

describe('reading passages back from what was sent', () => {
  it('cuts every section into its note, the labels and bodies the sender wrote', () => {
    const rankings = [[84], [69, 84], [0, 1, 2], [90, 3, 45, 46, 47], [10, 30, 50, 70]];
    for (const ranked of rankings) {
      const { text, passages, note, runs } = send(longDocument, longChunks, ranked);
      const written = passageRuns(longDocument, passages.map((passage) => longChunks[passage.ordinal]));
      expect(note).toBe(`Passages of a longer file: ${passages.length} of ${longChunks.length}.`);
      expect(runs.map((run) => run.body)).toEqual(written.map((run) => run.body));
      expect(runs.map((run) => run.label ?? '')).toEqual(written.map((run) => run.label));
      expect(text.length).toBeLessThanOrEqual(6_000);
      // A run's lengths add up to its body.
      for (const run of runs) {
        expect(passages.filter((passage) => run.ordinals.includes(passage.ordinal)).reduce((sum, passage) => sum + passage.length, 0)).toBe(run.body.length);
      }
    }
  });

  it('reads runs without a locator, cut lines and pages', () => {
    const plain = contextDocument('txt', `Intro.\n\n${'x'.repeat(1_495)}ABCDEF1234${'y'.repeat(3_000)}\n\n${'Outro words. '.repeat(200)}`);
    const plainChunks = chunksOf(plain, true);
    const cut = plainChunks.findIndex((chunk) => chunk.continuesPrevious);
    const sent = send(plain, plainChunks, [cut, plainChunks.length - 1]);
    expect(sent.runs.every((run) => run.label === null)).toBe(true);
    expect(sourcePassageDelivered('xxxxABCDEF1234yyyy', plain, sent.sent)).toBe(true);
    const pdf = contextDocument('pdf', '', [`Page one ${'a '.repeat(900)}`, `Page two ${'b '.repeat(900)} target words here`, `Page three ${'c '.repeat(900)}`]);
    const pdfChunks = chunksOf(pdf, true);
    const pages = send(pdf, pdfChunks, pdfChunks.map((chunk) => chunk.ordinal));
    expect(sourcePassageDelivered('target words here', pdf, pages.sent, { page: 2 })).toBe(true);
    expect(sourcePassageDelivered('target words here', pdf, pages.sent, { page: 3 })).toBe(false);
    expect(sourcePassageDelivered('target words here', pdf, pages.sent)).toBe(true);
  });

  it('does not count a quote that is only in a label line', () => {
    const { text, runs, sent } = send(longDocument, longChunks, [84]);
    const label = runs[0].label!.slice(1, -1);
    // The whole section holds it, as the old rule would count it ...
    expect(quoteDelivered(label, text)).toBe(true);
    // ... but no source passage does.
    expect(sourcePassageDelivered(label, longDocument, sent)).toBe(false);
    expect(sourcePassageDelivered(label, longDocument, sent, { heading: 'Errors for reports' })).toBe(false);
  });

  it('counts a quote under its heading inside a chunk that starts in the section before, and not under its neighbours', () => {
    // en-007: the answer is under "Webhooks", in a chunk whose own heading is the section before it.
    const source = expected('en-007');
    const holder = longChunks.find((chunk) => quoteDelivered(source.quote, chunk.text))!;
    expect(holder.heading.endsWith('Webhooks')).toBe(false);
    const { sent } = send(longDocument, longChunks, [holder.ordinal]);
    expect(sourcePassageDelivered(source.quote, longDocument, sent, { heading: 'Webhooks' })).toBe(true);
    expect(sourcePassageDelivered(source.quote, longDocument, sent, { heading: 'Errors for reports' })).toBe(false);
    expect(sourcePassageDelivered(source.quote, longDocument, sent, { heading: 'The webhook object' })).toBe(false);
    for (const id of ['en-008', 'en-m03']) {
      const refund = expected(id);
      const chunk = longChunks.find((item) => quoteDelivered(refund.quote, item.text))!;
      expect(sourcePassageDelivered(refund.quote, longDocument, send(longDocument, longChunks, [chunk.ordinal]).sent, refund.locator)).toBe(true);
    }
  });
});

describe("Codex's counterexamples and the simulation's heading rule", () => {
  it('does not take a literal heading "Group › Topic" for the section "Topic"', () => {
    const quote = 'The rule is quokka-seven.';
    // The quote's chunk starts after the literal heading's line, so the run
    // the provider gets begins under that heading's trail.
    const document = md(`# Guide\n\n${padding('intro')}## Group › Topic\n\n${padding('alpha')}${quote}\n\n${padding('beta')}## Topic\n\n${quote}\n\n${padding('gamma')}`);
    const chunks = chunksOf(document, true);
    const literal = chunks.find((chunk) => chunk.heading === 'Guide › Group › Topic' && chunk.text.includes(quote))!;
    expect(literal.text.startsWith('## ')).toBe(false);
    const real = chunks.find((chunk) => chunk.heading === 'Guide › Topic' && chunk.text.includes(quote))!;
    expect(literal && real && literal.ordinal !== real.ordinal).toBe(true);
    // Through `passagesText` and the reader: the literal section alone is not "Topic".
    const wrong = send(document, chunks, [literal.ordinal]);
    expect(wrong.sent.some((chunk) => chunk.ordinal === real.ordinal)).toBe(false);
    expect(quoteDelivered(quote, wrong.text)).toBe(true);
    expect(sourcePassageDelivered(quote, document, wrong.sent, { heading: 'Topic' })).toBe(false);
    // The real section is.
    expect(sourcePassageDelivered(quote, document, send(document, chunks, [real.ordinal]).sent, { heading: 'Topic' })).toBe(true);
  });

  it('does not take a "# Target" line inside a code block for the section "Target"', () => {
    const quote = 'The answer is zebracorn-nine.';
    const code = Array.from({ length: 60 }, (_, index) => (index === 40 ? `# Target\n${quote}` : `echo "line ${index} of a long script that only takes room"`)).join('\n');
    const document = md(`# Manual\n\n## Install\n\n\`\`\`bash\n${code}\n\`\`\`\n\n${padding('alpha')}## Target\n\n${quote}\n\n${padding('beta')}`);
    const chunks = chunksOf(document, true);
    // The code block is cut, and the piece with "# Target" starts inside it.
    const inside = chunks.find((chunk) => chunk.continuesPrevious && chunk.text.includes(`# Target\n${quote}`))!;
    const real = chunks.find((chunk) => chunk.text.startsWith(`## Target\n\n${quote}`))!;
    expect(inside && real).toBeTruthy();
    expect(inside.heading).toBe('Manual › Install');
    const wrong = send(document, chunks, [inside.ordinal]);
    expect(wrong.sent.some((chunk) => chunk.ordinal === real.ordinal)).toBe(false);
    expect(quoteDelivered(quote, wrong.text)).toBe(true);
    expect(sourcePassageDelivered(quote, document, wrong.sent, { heading: 'Target' })).toBe(false);
    expect(sourcePassageDelivered(quote, document, send(document, chunks, [real.ordinal]).sent, { heading: 'Target' })).toBe(true);
  });

  it('reads a repeated heading title at its first occurrence, as the simulation does', () => {
    const quote = 'Keep the narwhal fed.';
    const document = md(`# Book\n\n## Notes\n\nFirst notes.\n\n${padding('alpha')}## Middle\n\n${padding('beta')}## Notes\n\n${quote}\n\n${padding('gamma')}`);
    const chunks = chunksOf(document, true);
    const second = chunks.find((chunk) => chunk.text.includes(quote))!;
    expect(sourcePassageDelivered(quote, document, send(document, chunks, [second.ordinal]).sent, { heading: 'Notes' })).toBe(false);
    const first = chunks.find((chunk) => chunk.text.includes('First notes.'))!;
    expect(sourcePassageDelivered('First notes.', document, send(document, chunks, [first.ordinal]).sent, { heading: 'Notes' })).toBe(true);
  });
});

describe('two runs on one sheet', () => {
  // The sender starts a new run where the source header changes, even on one
  // sheet. A workbook cannot give such a sheet any more (the extractor escapes
  // a cell that reads like a sheet line), so the rule is read on text cut by
  // `sheetUnits` directly, without the extractor: the second `# sheet1.xml`
  // line starts sheet 1 again, under a header of its own.
  const rows = (word: string) => Array.from({ length: 120 }, (_, index) => `${word} ${index}\tamount ${index}`).join('\n');
  const document = contextDocument('xlsx', `# sheet1.xml\nName\tValue\n${rows('item')}\n# sheet1.xml\nOther\tHeader\n${rows('after')}`);
  const chunks = chunksOf(document, true);

  it("accepts the sender's two runs and credits a quote from the second at its locator", () => {
    const header = (index: number) => chunks[index].searchHeader ?? chunks[index].header;
    const change = chunks.findIndex((chunk, index) => chunks[index + 1] && chunks[index + 1].place === chunk.place && header(index + 1) !== header(index));
    expect(change).toBeGreaterThanOrEqual(0);
    const sent = send(document, chunks, [change, change + 1]);
    expect(sent.passages.map((passage) => passage.ordinal)).toEqual([change, change + 1]);
    expect(sent.passages.map((passage) => passage.locator)).toEqual([{ sheet: 1 }, { sheet: 1 }]);
    // Two runs on one sheet, each under its own label.
    expect(sent.runs).toHaveLength(2);
    expect(sent.runs[0].label).not.toBe(sent.runs[1].label);
    const quote = chunks[change + 1].text.split('\n').find((line) => line.startsWith('after '))!;
    expect(quote).toBeTruthy();
    expect(sourcePassageDelivered(quote, document, sent.sent, { sheet: 1 })).toBe(true);
    expect(sourcePassageDelivered(quote, document, sent.sent, { sheet: 2 })).toBe(false);
  });
});

describe('a real workbook with a cell that reads like a sheet line', () => {
  // Read by the evaluator's own source reader, as the indexer reads it.
  const folder = mkdtempSync(join(tmpdir(), 'meshkeep-eval-xlsx-'));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const before = Array.from({ length: 120 }, (_, index) => [`item ${index}`, `value ${index}`]);
  const after = Array.from({ length: 120 }, (_, index) => [`after ${index}`, `amount ${index}`]);
  async function read(name: string, rows: string[][]) {
    const path = join(folder, name);
    writeFileSync(path, workbook(rows));
    return sourceChunks(path);
  }

  it('keeps the rows after the cell on sheet 1 under the real header, and sends them as one run', async () => {
    // Before the extractor escaped it, the row `# sheet1.xml` started sheet 1
    // again: the row after it became a header, and the chunks around it two runs.
    const { document, chunks, keys } = await read('forged.xlsx', [['Name', 'Value'], ...before, ['# sheet1.xml'], ...after]);
    expect(chunks.every((chunk) => chunk.place === 'sheet 1' && (chunk.searchHeader ?? chunk.header) === 'Name\tValue')).toBe(true);
    const forged = chunks.findIndex((chunk) => chunk.text.split('\n').includes('\\# sheet1.xml'));
    expect(forged).toBeGreaterThanOrEqual(0);
    expect(chunks[forged + 1]).toBeDefined();
    const sent = send(document, chunks, [forged, forged + 1], keys);
    expect(sent.passages.map((passage) => passage.locator)).toEqual([{ sheet: 1 }, { sheet: 1 }]);
    expect(sent.runs).toHaveLength(1);
    const quote = chunks[forged + 1].text.split('\n').find((line) => line.startsWith('after '))!;
    expect(sourcePassageDelivered(quote, document, sent.sent, { sheet: 1 })).toBe(true);
    expect(sourcePassageDelivered(quote, document, sent.sent, { sheet: 2 })).toBe(false);
  });

  it('reads the same workbook without the cell as one run too (positive control)', async () => {
    const { document, chunks, keys } = await read('plain.xlsx', [['Name', 'Value'], ...before, ...after]);
    expect(chunks.every((chunk) => chunk.place === 'sheet 1' && (chunk.searchHeader ?? chunk.header) === 'Name\tValue')).toBe(true);
    const sent = send(document, chunks, [1, 2], keys);
    expect(sent.runs).toHaveLength(1);
    const quote = chunks[2].text.split('\n').at(-1)!;
    expect(sourcePassageDelivered(quote, document, sent.sent, { sheet: 1 })).toBe(true);
  });
});

describe('checking the manifest against the source', () => {
  // What the chat's manifest says about each passage, as the sender writes it.
  const keys = (chunks: Chunks) => chunks.map((chunk) => `${String(chunk.ordinal).padStart(20, '0')}`);
  function sendWithKeys(document: Document, chunks: Chunks, ranked: number[]) {
    const choice = choosePassages(document, chunks, keys(chunks), ranked, 6_000)!;
    const section = `${noteOf(choice.passages.length, chunks.length)}\n${choice.text}`;
    const read = (passages: SentPassage[], withKeys = true) => readPassageSection(section, passages, { document, chunks, keys: withKeys ? keys(chunks) : undefined });
    return { passages: choice.passages, section, read };
  }
  const pdf = contextDocument('pdf', '', [`Page one ${'a '.repeat(900)}`, `Page two ${'b '.repeat(900)}`, `Page three ${'c '.repeat(900)}`]);
  const pdfChunks = chunksOf(pdf, true);
  const sheets = contextDocument('xlsx', `# sheet1.xml\nName\tValue\none\t1\n# sheet2.xml\nName\tValue\ntwo\t2`);
  const sheetChunks = chunksOf(sheets, true);

  it('accepts a manifest that describes the source chunks', () => {
    for (const [document, chunks, ranked] of [[pdf, pdfChunks, [2]], [sheets, sheetChunks, [0, 1]], [longDocument, longChunks, [69, 70, 84]]] as const) {
      const { passages, read } = sendWithKeys(document, chunks, [...ranked]);
      expect(read(passages).sent).toHaveLength(passages.length);
    }
  });

  it('refuses a wrong page, sheet or heading even when text and label are right', () => {
    // Codex's probe: a real page-3 chunk under its own `[page 3]` label, said to be on page 2.
    const page = sendWithKeys(pdf, pdfChunks, [2]);
    expect(page.passages[0].locator).toEqual({ page: 3 });
    expect(() => page.read(page.passages.map((passage) => ({ ...passage, locator: { page: 2 } })))).toThrow(/locator/);
    const sheet = sendWithKeys(sheets, sheetChunks, [1]);
    expect(() => sheet.read(sheet.passages.map((passage) => ({ ...passage, locator: { sheet: 1 } })))).toThrow(/locator/);
    const heading = sendWithKeys(longDocument, longChunks, [84]);
    expect(() => heading.read(heading.passages.map((passage) => ({ ...passage, locator: { heading: 'Webhooks' } })))).toThrow(/locator/);
    // A locator dropped is wrong too.
    expect(() => page.read(page.passages.map(({ locator: _locator, ...rest }) => rest))).toThrow(/locator/);
  });

  it('refuses lengths that add up but belong to other chunks, and a wrong stamp', () => {
    // Two neighbouring chunks under one heading: one run, two lengths.
    const document = md(`# Doc\n\n${'a '.repeat(700)}\n\n${'b '.repeat(500)}\n\n${'c '.repeat(600)}`);
    const chunks = chunksOf(document, true);
    const { passages, read } = sendWithKeys(document, chunks, [1, 2]);
    expect(passages).toHaveLength(2);
    expect(read(passages).runs).toHaveLength(1);
    expect(passages[0].length).not.toBe(passages[1].length);
    // The same total for the run, split the other way round.
    expect(() => read([{ ...passages[0], length: passages[1].length }, { ...passages[1], length: passages[0].length }])).toThrow(/length/);
    const forged = passages.map((passage, index) => (index ? { ...passage, chunkKey: 'f'.repeat(20) } : passage));
    expect(() => read(forged)).toThrow(/stamp/);
    // Without known stamps, the stamp is not checked; everything else still is.
    expect(read(forged, false).sent).toHaveLength(2);
  });
});

describe('refusing what cannot be measured', () => {
  const source = { document: longDocument, chunks: longChunks };

  it('refuses a section that does not match its source, or lacks its note or a label line', () => {
    const { section, passages } = send(longDocument, longChunks, [10, 30]);
    expect(() => readPassageSection(`${section}extra`, passages, source)).toThrow(/more than/);
    expect(() => readPassageSection(section.replace('\n\n[…]\n\n', '\n\n'), passages, source)).toThrow();
    // No note line.
    expect(() => readPassageSection(section.slice(section.indexOf('\n') + 1), passages, source)).toThrow();
    // A label line left out.
    const lines = section.split('\n');
    const label = lines.findIndex((line, index) => index > 0 && /^\[.+\]$/.test(line) && line !== '[…]');
    expect(() => readPassageSection([...lines.slice(0, label), ...lines.slice(label + 1)].join('\n'), passages, source)).toThrow(/label/);
    expect(() => readPassageSection(section, [...passages].reverse(), source)).toThrow(/file order/);
    expect(() => readPassageSection(section, [], source)).toThrow();
    expect(readPassageSection(section, passages, source).runs).toHaveLength(2);
  });

  it('refuses a body that is not the source text of its chunks, and an unknown ordinal', () => {
    const { section, passages } = send(longDocument, longChunks, [10, 30]);
    const tampered = section.replace(longChunks[30].text.slice(0, 20), longChunks[30].text.slice(0, 19) + '#');
    expect(tampered).not.toBe(section);
    expect(() => readPassageSection(tampered, passages, source)).toThrow(/not the source text/);
    // Ordinals that the source does not have are refused too.
    expect(() => readPassageSection(section, passages, { document: longDocument, chunks: longChunks.slice(0, 20) })).toThrow(/not a chunk/);
  });
});
