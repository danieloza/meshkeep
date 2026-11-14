import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { canonicalText, chunksOf, markdownUnits, passageRuns, type Document } from '@/eval/context/chunking';
import { quoteDelivered } from '@/eval/context/measure';
import { passageQuoteDelivered, splitPassages, textsUnderHeading, type PassageRun } from '@/eval/context/passages';
import { contextDocument } from '@/lib/context-document';

vi.mock('@/db', () => ({ getDb: () => { throw new Error('No database in these tests.'); } }));
import { choosePassages } from '@/lib/server/context-passages';

// The evaluator reads passage bodies back from what the provider received,
// using only the manifest. These tests pin that reading against the sender.

const SET = join(import.meta.dirname, '..', 'eval', 'context', 'sets', 'dev');
const LONG = 'sklep-wdrozenie/api-reference.md';
const longDocument: Document = (() => {
  const text = canonicalText(readFileSync(join(SET, 'corpus', LONG), 'utf8'));
  return { text, units: markdownUnits(text) };
})();
const longChunks = chunksOf(longDocument, true);
const keys = longChunks.map(() => 'a'.repeat(20));
const questions = JSON.parse(readFileSync(join(SET, 'questions.json'), 'utf8')).questions as Array<{ id: string; expected: Array<{ file: string; quote: string; locator?: { heading: string } }> }>;
const expected = (id: string) => questions.find((question) => question.id === id)!.expected.find((source) => source.file === LONG)!;

function send(document: Document, chunks: ReturnType<typeof chunksOf>, ranked: number[], allowance = 6_000) {
  const choice = choosePassages(document, chunks, chunks.map(() => 'a'.repeat(20)), ranked, allowance);
  if (!choice) throw new Error('Nothing fits.');
  return { ...choice, runs: splitPassages(choice.text, choice.passages) };
}

describe('reading passages back from what was sent', () => {
  it('cuts every section into the labels and bodies the sender wrote', () => {
    const rankings = [[84], [69, 84], [0, 1, 2], [90, 3, 45, 46, 47], [10, 30, 50, 70]];
    for (const ranked of rankings) {
      const { text, passages, runs } = send(longDocument, longChunks, ranked);
      const selected = passages.map((passage) => longChunks[passage.ordinal]);
      const written = passageRuns(longDocument, selected);
      expect(runs.map((run) => run.body)).toEqual(written.map((run) => run.body));
      expect(runs.map((run) => run.label)).toEqual(written.map((run) => run.label));
      expect(text.length).toBeLessThanOrEqual(6_000);
      // A run's lengths add up to its body.
      for (const run of runs) {
        expect(passages.filter((passage) => run.ordinals.includes(passage.ordinal)).reduce((sum, passage) => sum + passage.length, 0)).toBe(run.body.length);
      }
    }
    expect(keys).toHaveLength(longChunks.length);
  });

  it('reads runs without a locator, cut lines and pages', () => {
    const plain = contextDocument('txt', `Intro.\n\n${'x'.repeat(1_495)}ABCDEF1234${'y'.repeat(3_000)}\n\n${'Outro words. '.repeat(200)}`);
    const plainChunks = chunksOf(plain, true);
    const cut = plainChunks.findIndex((chunk) => chunk.continuesPrevious);
    const sent = send(plain, plainChunks, [cut, plainChunks.length - 1]);
    expect(sent.runs.every((run) => run.label === null)).toBe(true);
    expect(passageQuoteDelivered('xxxxABCDEF1234yyyy', sent.runs)).toBe(true);
    const pdf = contextDocument('pdf', '', [`Page one ${'a '.repeat(900)}`, `Page two ${'b '.repeat(900)} target words here`, `Page three ${'c '.repeat(900)}`]);
    const pdfChunks = chunksOf(pdf, true);
    const pages = send(pdf, pdfChunks, pdfChunks.map((chunk) => chunk.ordinal));
    expect(passageQuoteDelivered('target words here', pages.runs, { page: 2 })).toBe(true);
    expect(passageQuoteDelivered('target words here', pages.runs, { page: 3 })).toBe(false);
    expect(passageQuoteDelivered('target words here', pages.runs)).toBe(true);
  });

  it('does not count a quote that is only in a label line', () => {
    const { text, runs } = send(longDocument, longChunks, [84]);
    const label = runs[0].label!.slice(1, -1);
    // The whole section holds it, as the old rule would count it ...
    expect(quoteDelivered(label, text)).toBe(true);
    // ... but no passage body does.
    expect(passageQuoteDelivered(label, runs)).toBe(false);
    expect(passageQuoteDelivered(label, runs, { heading: 'Errors for reports' })).toBe(false);
  });

  it('counts a quote under its heading inside a chunk that starts in the section before', () => {
    // en-007: the answer is under "Webhooks", in a chunk whose own heading is
    // the section before it. Strict equality of locators would miss it.
    const source = expected('en-007');
    const holder = longChunks.find((chunk) => quoteDelivered(source.quote, chunk.text))!;
    expect(holder.heading.endsWith('Webhooks')).toBe(false);
    const { runs } = send(longDocument, longChunks, [holder.ordinal]);
    expect(runs[0].locator).toEqual({ heading: holder.heading });
    expect(passageQuoteDelivered(source.quote, runs, { heading: 'Webhooks' })).toBe(true);
    // Not under a neighbouring heading, though it is in the same body.
    expect(passageQuoteDelivered(source.quote, runs, { heading: 'Errors for reports' })).toBe(false);
    expect(passageQuoteDelivered(source.quote, runs, { heading: 'The webhook object' })).toBe(false);
    for (const id of ['en-008', 'en-m03']) {
      const refund = expected(id);
      const chunk = longChunks.find((item) => quoteDelivered(refund.quote, item.text))!;
      expect(passageQuoteDelivered(refund.quote, send(longDocument, longChunks, [chunk.ordinal]).runs, refund.locator)).toBe(true);
    }
  });

  it('reads the region under a heading as the simulation does', () => {
    const body = 'Before.\n## Alpha\nalpha text\n### Alpha child\nchild text\n```bash\n# not a heading\nfenced alpha\n```\n## Beta\nbeta text';
    expect(textsUnderHeading(body, 'Doc › Start', 'Alpha')).toEqual(['alpha text']);
    expect(textsUnderHeading(body, 'Doc › Start', 'Alpha child')).toEqual(['child text\n```bash\n# not a heading\nfenced alpha\n```']);
    expect(textsUnderHeading(body, 'Doc › Start', 'Start')).toEqual(['Before.']);
    expect(textsUnderHeading(body, 'Doc › Start', 'not a heading')).toEqual([]);
    expect(textsUnderHeading(body, 'Doc › Start', 'Beta')).toEqual(['beta text']);
  });

  it('refuses a section that does not match its manifest', () => {
    const { text, passages } = send(longDocument, longChunks, [10, 30]);
    expect(() => splitPassages(`${text}extra`, passages)).toThrow(/more than/);
    expect(() => splitPassages(text.replace('\n\n[…]\n\n', '\n\n'), passages)).toThrow();
    expect(() => splitPassages(text.slice(text.indexOf('\n') + 1), passages)).toThrow();
    expect(() => splitPassages(text, [...passages].reverse())).toThrow(/file order/);
    expect(() => splitPassages(text, [])).toThrow();
    const runs: PassageRun[] = splitPassages(text, passages);
    expect(runs).toHaveLength(2);
  });
});
