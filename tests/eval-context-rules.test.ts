import { describe, expect, it } from 'vitest';
import { CHUNK_RULE, canonicalText, chunksOf, markdownBlocks, pack, paragraphBlocks, sheetBlocks, splitLongLine } from '@/eval/context/chunking';
import { FILE_CONTEXT_PREAMBLE, accessOutcome, assertStatus, contextTotal, fileContextMessage, normalizeText, quoteDelivered, splitFileContext, totalOf } from '@/eval/context/measure';

// The rules the context evaluation counts by, and the chunking rule its
// simulation uses. Each case here is one a review found the first version got
// wrong, or could get wrong without anyone noticing.

describe('chunking', () => {
  const markdown = '# Runbook\n\nIntro paragraph.\n\n## Deploying\n\nReleases go out on Tuesday.\n\nNo releases on Fridays.\n\n## Rollback\n\nRun the rollback command.\n';

  it('cuts a file the same way with LF and with CRLF line endings', () => {
    const crlf = markdown.replaceAll('\n', '\r\n');
    expect(crlf).not.toBe(markdown);
    for (const joinSections of [false, true]) {
      expect(chunksOf(markdownBlocks(crlf), joinSections)).toEqual(chunksOf(markdownBlocks(markdown), joinSections));
    }
    const plain = 'First paragraph.\n\nSecond paragraph.\n\nThird.';
    expect(paragraphBlocks(plain.replaceAll('\n', '\r\n'))).toEqual(paragraphBlocks(plain));
    expect(paragraphBlocks(plain)).toHaveLength(3);
    expect(canonicalText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('keeps the headings above a paragraph, and the heading line when sections share a chunk', () => {
    const blocks = markdownBlocks(markdown);
    expect(blocks.find((block) => block.text.startsWith('Releases'))?.heading).toBe('Runbook › Deploying');
    const [joined] = chunksOf(blocks, true);
    expect(joined.text).toContain('Runbook › Deploying\nReleases go out on Tuesday.');
    // Kept apart, no chunk crosses a heading.
    const apart = chunksOf(blocks, false);
    expect(apart.map((chunk) => chunk.heading)).toEqual(['Runbook', 'Runbook › Deploying', 'Runbook › Rollback']);
  });

  it('does not take a # inside a code fence for a heading', () => {
    const blocks = markdownBlocks('## Setup\n\n```bash\n# not a heading\nnpm ci\n```\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].heading).toBe('Setup');
  });

  it('cuts a single line longer than the maximum, losing nothing', () => {
    const line = Array.from({ length: 1_200 }, (_, index) => `word${index}`).join(' ');
    expect(line.length).toBeGreaterThan(7_000);
    const pieces = splitLongLine(line);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(CHUNK_RULE.targetChars);
    expect(pieces.join('')).toBe(line);

    // With no space in reach the cut falls inside the text, and still nothing is lost.
    const solid = 'x'.repeat(7_000);
    const solidPieces = splitLongLine(solid);
    for (const piece of solidPieces) expect(piece.length).toBeLessThanOrEqual(CHUNK_RULE.targetChars);
    expect(solidPieces.join('')).toBe(solid);

    // A line under the maximum is left alone.
    expect(splitLongLine('y'.repeat(CHUNK_RULE.maxChars))).toHaveLength(1);
  });

  it('never makes a chunk longer than the maximum, whatever the input', () => {
    const longLine = Array.from({ length: 1_200 }, (_, index) => `word${index}`).join(' ');
    const inputs = [
      paragraphBlocks(longLine),
      paragraphBlocks(`${'short line\n'.repeat(400)}`),
      markdownBlocks(`# ${'Title '.repeat(40)}\n\n${'z'.repeat(CHUNK_RULE.maxChars - 10)}`),
      sheetBlocks(`# sheet1.xml\nName\tValue\n${Array.from({ length: 300 }, (_, index) => `row ${index}\t${index}`).join('\n')}`),
    ];
    for (const blocks of inputs) {
      for (const joinSections of [false, true]) {
        const chunks = chunksOf(blocks, joinSections);
        expect(chunks.length).toBeGreaterThan(0);
        for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_RULE.maxChars);
      }
    }
    // And the long line is all there, in order.
    const restored = chunksOf(paragraphBlocks(longLine), true).map((chunk) => chunk.text).join('');
    expect(normalizeText(restored)).toBe(normalizeText(longLine));
  });

  it('a quote across a forced cut is found when both pieces are sent, and not when one is', () => {
    const line = Array.from({ length: 1_200 }, (_, index) => `word${index}`).join(' ');
    const pieces = chunksOf(paragraphBlocks(line), true).map((chunk) => chunk.text);
    const boundary = pieces[0].split(' ').at(-1)!;
    const next = pieces[1].trim().split(' ')[0];
    const quote = `${boundary} ${next}`;
    expect(line).toContain(quote);
    expect(quoteDelivered(quote, pieces.slice(0, 2).join('\n\n'))).toBe(true);
    expect(quoteDelivered(quote, pieces[0])).toBe(false);
  });

  it('repeats the header row in every chunk of a long sheet', () => {
    const rows = Array.from({ length: 300 }, (_, index) => `Position ${index}\t${index * 10}`).join('\n');
    const blocks = sheetBlocks(`# sheet1.xml\nPosition\tAmount\n${rows}\n\n# sheet2.xml\nRole\tRate\nTester\t120`);
    expect(blocks.length).toBeGreaterThan(2);
    for (const block of blocks.filter((entry) => entry.place === 'sheet 1')) expect(block.text.startsWith('Position\tAmount\n')).toBe(true);
    expect(blocks.at(-1)).toEqual({ text: 'Role\tRate\nTester\t120', place: 'sheet 2', heading: '' });
    expect(pack(['a', 'b'], CHUNK_RULE, 'head')).toEqual(['head\na\nb']);
  });
});

describe('measuring', () => {
  const file = (path: string, text: string) => ({ path, mimeType: 'text/plain', sizeBytes: text.length, text });

  it('reads a file context back into the text of each file', () => {
    // The second file's own text contains the rule that separates sections.
    const files = [file('umowa.pdf', 'Termin płatności wynosi 14 dni.'), file('mail.txt', 'Dzień dobry\n\n---\n\nOd: Ola'), file('pusty.txt', '')];
    const message = fileContextMessage(files);
    expect(message.startsWith(FILE_CONTEXT_PREAMBLE)).toBe(true);
    const sections = splitFileContext(message, files.map((entry) => entry.path));
    expect([...sections.entries()]).toEqual(files.map((entry) => [entry.path, entry.text]));
    expect(splitFileContext('', [])).toEqual(new Map());
  });

  it('refuses a file context it does not understand instead of measuring it', () => {
    const message = fileContextMessage([file('a.txt', 'alpha'), file('b.txt', 'beta')]);
    expect(() => splitFileContext(message, ['a.txt', 'c.txt'])).toThrow(/c\.txt/);
    expect(() => splitFileContext(message, ['b.txt', 'a.txt'])).toThrow();
    expect(() => splitFileContext('Something else entirely', ['a.txt'])).toThrow(/does not start/);
    expect(() => splitFileContext(message, [])).toThrow(/no file is listed/);
    expect(() => splitFileContext(`${FILE_CONTEXT_PREAMBLE}\n\nFILE: a.txt (no size)\nalpha`, ['a.txt'])).toThrow(/format/);
  });

  it('counts a quote as delivered only from its own file', () => {
    const quote = 'Termin płatności wynosi 14 dni';
    // The same words are in both files, and only the other file was sent.
    const sections = splitFileContext(fileContextMessage([file('aneks.docx', `Wcześniej: ${quote}.`)]), ['aneks.docx']);
    expect(quoteDelivered(quote, sections.get('umowa.pdf'))).toBe(false);
    expect(quoteDelivered(quote, sections.get('aneks.docx'))).toBe(true);
    // A line break in the file does not hide the quote; a changed word does.
    expect(quoteDelivered(quote, 'Termin płatności\nwynosi   14 dni.')).toBe(true);
    expect(quoteDelivered(quote, 'Termin płatności wynosi 21 dni.')).toBe(false);
  });

  it('scores only questions that have expected sources', () => {
    expect(() => totalOf([{ ranks: [], delivered: [] }])).toThrow(/cannot be scored/);
    const total = totalOf([
      { ranks: [1], delivered: [true] },
      { ranks: [2, null], delivered: [true, false] },
      { ranks: [null], delivered: [false] },
      { ranks: [3, 1], delivered: [true, false] },
    ]);
    expect(total).toEqual({ n: 4, complete: 0.5, found: 0.625, firstRank: 1.3333, delivered: 0.25 });
    expect(totalOf([])).toEqual({ n: 0, complete: 0, found: 0, firstRank: null, delivered: 0 });
  });

  it('reports context size with both denominators', () => {
    // Two questions sent context, one sent none.
    expect(contextTotal([100, null, 300])).toEqual({ n: 3, withContext: 2, meanChars: 133, meanCharsWhenSent: 200, maxChars: 300 });
    expect(contextTotal([null, null])).toEqual({ n: 2, withContext: 0, meanChars: 0, meanCharsWhenSent: 0, maxChars: 0 });
  });

  it('calls access refused only when the owner finds the file and the asker does not', () => {
    expect(accessOutcome({ routeStatus: 404, ownerFound: true, askerFound: false })).toBe('refused');
    // The owner cannot find it either: the asker's empty result proves nothing.
    expect(accessOutcome({ routeStatus: 404, ownerFound: false, askerFound: false })).toBe('inconclusive');
    expect(accessOutcome({ routeStatus: 404, ownerFound: true, askerFound: true })).toBe('leaked');
    expect(accessOutcome({ routeStatus: 200, ownerFound: true, askerFound: false })).toBe('leaked');
  });

  it('stops on a failed request instead of counting it as a result', () => {
    expect(() => assertStatus(429, 200, 'Suggestions for pl-001', '{"error":"Too many requests"}')).toThrow(/Suggestions for pl-001: expected 200, got 429/);
    expect(() => assertStatus(500, 200, 'Suggestions')).toThrow();
    expect(() => assertStatus(200, 200, 'Suggestions')).not.toThrow();
  });
});
