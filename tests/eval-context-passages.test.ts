import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { canonicalText, chunksOf, markdownUnits, passageRuns, type Document } from '@/eval/context/chunking';
import { quoteDelivered } from '@/eval/context/measure';
import { sentSourceChunks, sourcePassageDelivered, splitPassages } from '@/eval/context/passages';
import { contextDocument } from '@/lib/context-document';

vi.mock('@/db', () => ({ getDb: () => { throw new Error('No database in these tests.'); } }));
import { choosePassages } from '@/lib/server/context-passages';

// The evaluator reads a passage section back with the manifest alone, checks
// every body against the source document, and credits a quote only inside the
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

// What the chat sends for the given ranking, read back as the runner reads it.
function send(document: Document, chunks: ReturnType<typeof chunksOf>, ranked: number[], allowance = 6_000) {
  const choice = choosePassages(document, chunks, chunks.map(() => 'a'.repeat(20)), ranked, allowance);
  if (!choice) throw new Error('Nothing fits.');
  const section = `[Passages of a longer file: ${choice.passages.length} of ${chunks.length}.]\n${choice.text}`;
  const { note, runs } = splitPassages(section, choice.passages);
  return { ...choice, section, note, runs, sent: sentSourceChunks(document, chunks, choice.passages, runs) };
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
      expect(runs.map((run) => run.label)).toEqual(written.map((run) => run.label));
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

describe('checking the manifest against the source', () => {
  // What the chat's manifest says about each passage, as the sender writes it.
  const keys = (chunks: ReturnType<typeof chunksOf>) => chunks.map((chunk) => `${String(chunk.ordinal).padStart(20, '0')}`);
  function sendWithKeys(document: Document, chunks: ReturnType<typeof chunksOf>, ranked: number[]) {
    const choice = choosePassages(document, chunks, keys(chunks), ranked, 6_000)!;
    const section = `[Passages of a longer file: ${choice.passages.length} of ${chunks.length}.]\n${choice.text}`;
    return { passages: choice.passages, runs: splitPassages(section, choice.passages).runs, section };
  }
  const pdf = contextDocument('pdf', '', [`Page one ${'a '.repeat(900)}`, `Page two ${'b '.repeat(900)}`, `Page three ${'c '.repeat(900)}`]);
  const pdfChunks = chunksOf(pdf, true);
  const sheets = contextDocument('xlsx', `# sheet1.xml\nName\tValue\none\t1\n# sheet2.xml\nName\tValue\ntwo\t2`);
  const sheetChunks = chunksOf(sheets, true);

  it('accepts a manifest that describes the source chunks', () => {
    for (const [document, chunks, ranked] of [[pdf, pdfChunks, [2]], [sheets, sheetChunks, [0, 1]], [longDocument, longChunks, [69, 70, 84]]] as const) {
      const { passages, runs } = sendWithKeys(document, chunks, [...ranked]);
      expect(sentSourceChunks(document, chunks, passages, runs, keys(chunks))).toHaveLength(passages.length);
    }
  });

  it('refuses a wrong page, sheet or heading even when text and label are right', () => {
    // Codex's probe: a real page-3 chunk under its own `[page 3]` label, said to be on page 2.
    const page = sendWithKeys(pdf, pdfChunks, [2]);
    expect(page.passages[0].locator).toEqual({ page: 3 });
    const onPage2 = page.passages.map((passage) => ({ ...passage, locator: { page: 2 } }));
    expect(() => sentSourceChunks(pdf, pdfChunks, onPage2, page.runs)).toThrow(/locator/);
    const sheet = sendWithKeys(sheets, sheetChunks, [1]);
    expect(() => sentSourceChunks(sheets, sheetChunks, sheet.passages.map((passage) => ({ ...passage, locator: { sheet: 1 } })), sheet.runs)).toThrow(/locator/);
    const heading = sendWithKeys(longDocument, longChunks, [84]);
    expect(() => sentSourceChunks(longDocument, longChunks, heading.passages.map((passage) => ({ ...passage, locator: { heading: 'Webhooks' } })), heading.runs)).toThrow(/locator/);
    // A locator dropped is wrong too.
    expect(() => sentSourceChunks(pdf, pdfChunks, page.passages.map(({ locator: _locator, ...rest }) => rest), page.runs)).toThrow();
  });

  it('refuses lengths that add up but belong to other chunks, and a wrong stamp', () => {
    // Two neighbouring chunks under one heading: one run, two lengths.
    const document = md(`# Doc\n\n${'a '.repeat(700)}\n\n${'b '.repeat(500)}\n\n${'c '.repeat(600)}`);
    const chunks = chunksOf(document, true);
    const { passages, runs } = sendWithKeys(document, chunks, [1, 2]);
    expect(passages).toHaveLength(2);
    expect(runs).toHaveLength(1);
    expect(passages[0].length).not.toBe(passages[1].length);
    // The same total for the run, split the other way round.
    const swapped = [{ ...passages[0], length: passages[1].length }, { ...passages[1], length: passages[0].length }];
    const read = splitPassages(`[note]\n${choosePassages(document, chunks, keys(chunks), [1, 2], 6_000)!.text}`, swapped).runs;
    expect(() => sentSourceChunks(document, chunks, swapped, read)).toThrow(/length/);
    const forged = passages.map((passage, index) => (index ? { ...passage, chunkKey: 'f'.repeat(20) } : passage));
    expect(() => sentSourceChunks(document, chunks, forged, runs, keys(chunks))).toThrow(/stamp/);
    // Without known stamps, the stamp is not checked; everything else still is.
    expect(sentSourceChunks(document, chunks, forged, runs)).toHaveLength(2);
  });
});

describe('refusing what cannot be measured', () => {
  it('refuses a section that does not match its manifest or lacks its note line', () => {
    const { section, passages } = send(longDocument, longChunks, [10, 30]);
    expect(() => splitPassages(`${section}extra`, passages)).toThrow(/more than/);
    expect(() => splitPassages(section.replace('\n\n[…]\n\n', '\n\n'), passages)).toThrow();
    expect(() => splitPassages(section.slice(section.indexOf('\n') + 1), passages)).toThrow();
    expect(() => splitPassages(section, [...passages].reverse())).toThrow(/file order/);
    expect(() => splitPassages(section, [])).toThrow();
    expect(splitPassages(section, passages).runs).toHaveLength(2);
  });

  it('refuses a body that is not the source text of its chunks', () => {
    const { section, passages } = send(longDocument, longChunks, [10, 30]);
    const tampered = section.replace(longChunks[30].text.slice(0, 20), longChunks[30].text.slice(0, 19) + '#');
    expect(tampered).not.toBe(section);
    const { runs } = splitPassages(tampered, passages);
    expect(() => sentSourceChunks(longDocument, longChunks, passages, runs)).toThrow(/not the source text/);
    // Ordinals that the source does not have are refused too.
    const { runs: good } = splitPassages(section, passages);
    expect(() => sentSourceChunks(longDocument, longChunks.slice(0, 20), passages, good)).toThrow(/not a chunk/);
  });
});
