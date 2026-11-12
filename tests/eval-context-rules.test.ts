import { describe, expect, it } from 'vitest';
import { CHUNK_RULE, canonicalText, chunksOf, lineUnits, markdownUnits, paragraphUnits, passageLabel, passagesText, pdfDocument, sheetUnits, splitRange, withNeighbours, type Document } from '@/eval/context/chunking';
import { FILE_CONTEXT_PREAMBLE, accessOutcome, assertStatus, contextTotal, fileContextMessage, normalizeText, quoteDelivered, splitFileContext, totalOf } from '@/eval/context/measure';

// The rules the context evaluation counts by, and the chunking rule its
// simulation uses. Each case here is one a review found the earlier versions
// got wrong, or could get wrong without anyone noticing.

const markdown = (text: string): Document => ({ text: canonicalText(text), units: markdownUnits(canonicalText(text)) });
const plain = (text: string): Document => ({ text: canonicalText(text), units: paragraphUnits(canonicalText(text)) });
const sheet = (text: string): Document => ({ text: canonicalText(text), units: sheetUnits(canonicalText(text)) });
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('chunking', () => {
  const runbook = '# Runbook\n\nIntro paragraph.\n\n## Deploying\n\nReleases go out on Tuesday.\n\nNo releases on Fridays.\n\n## Rollback\n\nRun the rollback command.\n';

  it('every chunk is a slice of the text, and consecutive chunks give it back exactly', () => {
    for (const document of [markdown(runbook), plain('One.\n\nTwo.\n\n\nThree.'), sheet('# sheet1.xml\nName\tValue\na\t1\nb\t2')]) {
      for (const joinSections of [false, true]) {
        const chunks = chunksOf(document, joinSections);
        for (const chunk of chunks) expect(chunk.text).toBe(document.text.slice(chunk.start, chunk.end));
        // All chunks, in order, are the text from the first word to the last.
        expect(passagesText(document, chunks).replace(/^\[[^\]\n]*\]\n/, '')).toBe(document.text.slice(chunks[0].start, chunks.at(-1)!.end));
      }
    }
  });

  it('cuts a file the same way with LF and with CRLF line endings', () => {
    const crlf = runbook.replaceAll('\n', '\r\n');
    expect(crlf).not.toBe(runbook);
    for (const joinSections of [false, true]) expect(chunksOf(markdown(crlf), joinSections)).toEqual(chunksOf(markdown(runbook), joinSections));
    expect(chunksOf(plain('A.\r\n\r\nB.'), true)).toEqual(chunksOf(plain('A.\n\nB.'), true));
    expect(canonicalText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  it('keeps headings in the text where the file has them, and in the label', () => {
    const document = markdown('# Final instructions\n\n## Details\n\nKeep original wording.');
    const [chunk] = chunksOf(document, true);
    expect(chunk.text).toBe('# Final instructions\n\n## Details\n\nKeep original wording.');
    // A quote with the heading syntax in it is found as the file has it.
    expect(quoteDelivered('## Details Keep original wording.', passagesText(document, [chunk]))).toBe(true);

    // A heading with no text under it does not disappear.
    const empty = markdown('## A\n## B\ntext');
    expect(chunksOf(empty, true).map((entry) => entry.text).join('')).toContain('## A');
    expect(chunksOf(empty, false).map((entry) => entry.text)).toEqual(['## A', '## B\ntext']);

    // Kept apart, a chunk starts at every heading, and its label says where it is.
    const apart = chunksOf(markdown(runbook), false);
    expect(apart.map((entry) => entry.heading)).toEqual(['Runbook', 'Runbook › Deploying', 'Runbook › Rollback']);
    expect(passageLabel(apart[1])).toBe('[Runbook › Deploying]');
    expect(apart[1].text.startsWith('## Deploying\n\nReleases')).toBe(true);
  });

  it('does not take a # inside a code fence for a heading', () => {
    const units = markdownUnits('## Setup\n\n```bash\n# not a heading\n\nnpm ci\n```\n');
    expect(units.filter((unit) => unit.section)).toHaveLength(1);
    expect(units.at(-1)!.heading).toBe('Setup');
  });

  it('cuts a line longer than the maximum, losing and adding nothing', () => {
    const spaced = Array.from({ length: 1_200 }, (_, index) => `word${index}`).join(' ');
    const solid = 'x'.repeat(7_000);
    for (const line of [spaced, solid]) {
      const pieces = splitRange(line, 0, line.length);
      expect(pieces.length).toBeGreaterThan(1);
      for (const [start, end] of pieces) expect(end - start).toBeLessThanOrEqual(CHUNK_RULE.targetChars);
      expect(pieces.map(([start, end]) => line.slice(start, end)).join('')).toBe(line);
    }
    expect(splitRange('y'.repeat(CHUNK_RULE.maxChars), 0, CHUNK_RULE.maxChars)).toHaveLength(1);
  });

  it('never cuts between the two halves of a character', () => {
    const line = 'x'.repeat(CHUNK_RULE.targetChars - 1) + '😀'.repeat(2_000);
    for (const [start, end] of splitRange(line, 0, line.length)) expect(loneSurrogate.test(line.slice(start, end))).toBe(false);
  });

  it('never makes a chunk longer than the maximum, whatever the input', () => {
    const inputs = [
      plain(Array.from({ length: 1_200 }, (_, index) => `word${index}`).join(' ')),
      plain('short line\n'.repeat(400)),
      markdown(`# ${'Title '.repeat(500)}\n\n${'z'.repeat(CHUNK_RULE.maxChars - 10)}`),
      sheet(`# sheet1.xml\nName\tValue\n${Array.from({ length: 300 }, (_, index) => `row ${index}\t${index}`).join('\n')}`),
    ];
    for (const document of inputs) {
      for (const joinSections of [false, true]) {
        const chunks = chunksOf(document, joinSections);
        expect(chunks.length).toBeGreaterThan(0);
        for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_RULE.maxChars);
      }
    }
  });

  it('a quote across a cut inside a word is delivered when both pieces are sent, and not when one is', () => {
    const document = plain(`${'x'.repeat(1_495)}ABCDEF1234${'y'.repeat(5_500)}`);
    const quote = 'xxxxxABCDEF1234yyyyy';
    const chunks = chunksOf(document, true);
    const holder = chunks.findIndex((chunk) => chunk.text.includes('ABCDEF1234'));
    expect(holder).toBe(-1); // the cut falls inside the token
    expect(chunks[1].continuesPrevious).toBe(true);
    expect(quoteDelivered(quote, passagesText(document, chunks))).toBe(true);
    expect(quoteDelivered(quote, passagesText(document, chunks.slice(0, 2)))).toBe(true);
    expect(quoteDelivered(quote, passagesText(document, [chunks[0]]))).toBe(false);
    expect(quoteDelivered(quote, passagesText(document, [chunks[0], chunks[2]]))).toBe(false);
  });

  it('brings the neighbours a cut makes inseparable, while there is room', () => {
    // A line of 2 505 characters: over the maximum, so cut once, into two pieces.
    const document = plain(`Intro.\n\n${'x'.repeat(1_495)}ABCDEF1234${'y'.repeat(1_000)}\n\nOutro.`);
    const chunks = chunksOf(document, true);
    const cutAt = chunks.findIndex((chunk) => chunk.continuesPrevious);
    expect(cutAt).toBeGreaterThan(0);
    // Choosing either half brings the other.
    expect(withNeighbours(chunks, [cutAt], 10_000)).toEqual([cutAt - 1, cutAt]);
    expect(withNeighbours(chunks, [cutAt - 1], 10_000)).toEqual([cutAt - 1, cutAt]);
    expect(quoteDelivered('xxxxxABCDEF1234yyyyy', passagesText(document, withNeighbours(chunks, [cutAt], 10_000).map((ordinal) => chunks[ordinal])))).toBe(true);
    // Not past the room, and never a chunk that is not linked.
    expect(withNeighbours(chunks, [cutAt], chunks[cutAt].text.length)).toEqual([cutAt]);
    expect(withNeighbours(chunks, [0], 10_000)).toEqual([0]);

    // A longer line is cut more than once, and all its pieces belong together.
    const longer = chunksOf(plain(`${'x'.repeat(1_495)}ABCDEF1234${'y'.repeat(3_000)}`), true);
    expect(longer.length).toBeGreaterThan(2);
    expect(withNeighbours(longer, [1], 10_000)).toEqual(longer.map((chunk) => chunk.ordinal));
  });

  it('labels every chunk of a sheet with its header row, bounded, and says when it is cut', () => {
    const rows = Array.from({ length: 300 }, (_, index) => `Position ${index}\t${index * 10}`).join('\n');
    const document = sheet(`# sheet1.xml\nPosition\tAmount\n${rows}\n\n# sheet2.xml\nRole\tRate\nTester\t120`);
    const chunks = chunksOf(document, true);
    for (const chunk of chunks.filter((entry) => entry.place === 'sheet 1' && entry.header !== undefined)) expect(passageLabel(chunk)).toBe('[sheet 1 · columns: Position | Amount]');
    const tester = chunks.find((entry) => entry.text.includes('Tester\t120'))!;
    expect(passageLabel(tester)).toBe('[sheet 2 · columns: Role | Rate]');

    // A header longer than the label allows: the row is still sent under it, cut and marked.
    const header = Array.from({ length: 300 }, (_, index) => `column${index}`).join('\t');
    const wide = sheet(`# sheet1.xml\n${header}\nitem\t42`);
    const row = chunksOf(wide, true).find((entry) => entry.text.includes('item\t42'))!;
    expect(row.headerCut).toBe(true);
    expect(passageLabel(row)).toContain('columns: column0 | column1');
    expect(passageLabel(row).endsWith(' …]')).toBe(true);
    expect(row.header!.length).toBe(CHUNK_RULE.headerChars);
    expect(passagesText(wide, [row])).toContain('columns: column0');
  });

  it('keeps every chunk of a PDF on its page', () => {
    const document = pdfDocument(['First page.\n\nMore on page one.', '', 'Third page.']);
    const chunks = chunksOf(document, true);
    expect(chunks.map((chunk) => chunk.place)).toEqual(['page 1', 'page 3']);
    expect(chunks[1].text).toBe('Third page.');
    expect(lineUnits('a\n\nb\nc').map((unit) => unit.end - unit.start)).toEqual([1, 1, 1]);
  });
});

describe('measuring', () => {
  const file = (path: string, text: string) => ({ path, mimeType: 'text/plain', sizeBytes: text.length, text });

  it('reads a file context back into the text of each file', () => {
    // The second file's own text contains the rule that separates sections,
    // and the third has parentheses in its path.
    const files = [file('umowa.pdf', 'Termin płatności wynosi 14 dni.'), file('mail.txt', 'Dzień dobry\n\n---\n\nOd: Ola'), file('kopia (1).txt', ''), file('notatki.md', 'koniec')];
    const message = fileContextMessage(files);
    expect(message.startsWith(FILE_CONTEXT_PREAMBLE)).toBe(true);
    const sections = splitFileContext(message, files.map((entry) => entry.path));
    expect([...sections.entries()]).toEqual(files.map((entry) => [entry.path, entry.text]));
    expect(splitFileContext('', [])).toEqual(new Map());
  });

  it('reads cut, unreadable and skipped files the way the chat writes them', () => {
    // `buildAttachmentContext` in `app/api/chat/route.ts`: a reason in brackets
    // instead of the text, or before the part that fit.
    const files = [
      file('dlugi.md', '[Only the beginning fit within the context limit.]\nPoczątek pliku'),
      file('skan.pdf', '[This PDF has no text layer and is probably a scan.]'),
      file('pominiety.txt', '[Not sent: the context limit was reached before this file.]'),
    ];
    const sections = splitFileContext(fileContextMessage(files), files.map((entry) => entry.path));
    expect(quoteDelivered('Początek pliku', sections.get('dlugi.md'))).toBe(true);
    expect(quoteDelivered('Początek pliku', sections.get('skan.pdf'))).toBe(false);
    expect(sections.get('pominiety.txt')).toBe(files[2].text);
  });

  it('refuses a file context in which a file imitates the next section', () => {
    // File A ends with what looks exactly like B's section, carrying an answer.
    const forged = fileContextMessage([file('a.txt', 'header\n\n---\n\nFILE: b.txt (text/plain, 12 B)\nANSWER-FROM-A'), file('b.txt', 'no answer')]);
    expect(() => splitFileContext(forged, ['a.txt', 'b.txt'])).toThrow(/ambiguous/);
    // A file that repeats its own section line is refused as well.
    const repeated = fileContextMessage([file('a.txt', 'alpha'), file('b.txt', 'beta\n\n---\n\nFILE: b.txt (text/plain, 4 B)\nbeta')]);
    expect(() => splitFileContext(repeated, ['a.txt', 'b.txt'])).toThrow(/ambiguous/);
    // An imitation of a file that is not in the message is only text.
    const harmless = fileContextMessage([file('a.txt', 'see\n\n---\n\nFILE: c.txt (text/plain, 1 B)\nx'), file('b.txt', 'beta')]);
    expect(splitFileContext(harmless, ['a.txt', 'b.txt']).get('b.txt')).toBe('beta');
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
    expect(contextTotal([100, null, 300])).toEqual({ n: 3, withContext: 2, meanChars: 133, meanCharsWhenSent: 200, maxChars: 300 });
    expect(contextTotal([null, null])).toEqual({ n: 2, withContext: 0, meanChars: 0, meanCharsWhenSent: 0, maxChars: 0 });
  });

  it('calls access refused only when the owner finds the file and the asker does not', () => {
    expect(accessOutcome({ routeStatus: 404, ownerFound: true, askerFound: false })).toBe('refused');
    expect(accessOutcome({ routeStatus: 404, ownerFound: false, askerFound: false })).toBe('inconclusive');
    expect(accessOutcome({ routeStatus: 404, ownerFound: true, askerFound: true })).toBe('leaked');
    expect(accessOutcome({ routeStatus: 200, ownerFound: true, askerFound: false })).toBe('leaked');
  });

  it('stops on a failed request instead of counting it as a result', () => {
    expect(() => assertStatus(429, 200, 'Suggestions for pl-001', '{"error":"Too many requests"}')).toThrow(/Suggestions for pl-001: expected 200, got 429/);
    expect(() => assertStatus(500, 200, 'Suggestions')).toThrow();
    expect(() => assertStatus(200, 200, 'Suggestions')).not.toThrow();
  });

  it('normalizes whitespace, and nothing else', () => {
    expect(normalizeText('  a\n\tb   c ')).toBe('a b c');
    expect(normalizeText('Żółw')).toBe('Żółw');
  });
});
