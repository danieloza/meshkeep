// How a file's text is cut into chunks, for the simulation in
// `scripts/eval-context-chunks.mjs` and for the tests that pin the rule down.
// This is the rule `docs/adr/0001-context-and-citations.md` proposes, not code
// the application runs.
//
// A chunk is a slice of the file's text, by offsets, never a rewritten copy:
// chunks that follow each other put back together give the text exactly, and
// what a passage says is what the file says. What a chunk is about (the
// headings above it, the page, a sheet's header row) travels beside it, as a
// label.
//
// Only erasable TypeScript, and no imports: Node runs this file as it is.

export type ChunkRule = {
  // A chunk aims at this many characters.
  targetChars: number;
  // No chunk is longer than this.
  maxChars: number;
  // A sheet's header row is repeated in the label of every chunk of the
  // sheet, up to this many characters.
  headerChars: number;
};

export const CHUNK_RULE: ChunkRule = { targetChars: 1_500, maxChars: 2_400, headerChars: 1_000 };

// A unit is text that belongs together: a paragraph, a heading line, a row of
// a sheet. A chunk is made of whole units, unless one unit is too long alone.
export type Unit = {
  start: number;
  end: number;
  // Where in the file: `page 3`, `sheet 2`, or empty.
  place: string;
  // The headings above the unit, outermost first, joined with ` › `.
  heading: string;
  // A Markdown heading line, or the first line of a sheet: a chunk kept to
  // one section starts here.
  section: boolean;
  // A sheet's header row.
  header?: string;
};

export type Document = { text: string; units: Unit[] };

export type Chunk = {
  ordinal: number;
  start: number;
  end: number;
  text: string;
  place: string;
  heading: string;
  header?: string;
  // The header row was longer than the label allows and is cut there: the
  // last columns of this chunk's rows have no name in the label.
  headerCut?: boolean;
  // The boundary with the chunk before falls inside a unit (a long line was
  // cut), so this chunk reads only together with that one.
  continuesPrevious: boolean;
};

// One line ending everywhere. A checkout on Windows may hold the same file
// with CRLF, and a paragraph break must be the same break in both.
export function canonicalText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

type Line = { start: number; end: number; text: string };

function linesOf(text: string, from = 0, to = text.length): Line[] {
  const lines: Line[] = [];
  let start = from;
  while (start <= to) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 || newline > to ? to : newline;
    lines.push({ start, end, text: text.slice(start, end) });
    if (end >= to) break;
    start = end + 1;
  }
  return lines;
}

// Runs of lines that are not blank, as units: paragraphs of plain text, one
// line per paragraph of a DOCX.
export function paragraphUnits(text: string, place = '', from = 0, to = text.length): Unit[] {
  const units: Unit[] = [];
  let first: Line | null = null;
  let last: Line | null = null;
  const close = () => {
    if (first && last) units.push({ start: first.start, end: last.end, place, heading: '', section: false });
    first = null;
    last = null;
  };
  for (const line of linesOf(text, from, to)) {
    if (!line.text.trim()) { close(); continue; }
    if (!first) first = line;
    last = line;
  }
  close();
  return units;
}

// Every line that is not blank is a unit of its own.
export function lineUnits(text: string, place = ''): Unit[] {
  return linesOf(text).filter((line) => line.text.trim()).map((line) => ({ start: line.start, end: line.end, place, heading: '', section: false }));
}

// Markdown: each heading line is a unit that starts a section, each paragraph
// a unit carrying the headings above it. A `#` inside a fenced code block is
// not a heading, and a blank line inside one does not end it.
export function markdownUnits(text: string): Unit[] {
  const units: Unit[] = [];
  const trail: string[] = [];
  let first: Line | null = null;
  let last: Line | null = null;
  let fenced = false;
  const trailText = () => trail.filter(Boolean).join(' › ');
  const close = () => {
    if (first && last) units.push({ start: first.start, end: last.end, place: '', heading: trailText(), section: false });
    first = null;
    last = null;
  };
  for (const line of linesOf(text)) {
    const heading = fenced ? null : line.text.match(/^(#{1,6}) (.*)$/);
    if (line.text.startsWith('```')) fenced = !fenced;
    if (heading) {
      close();
      trail.length = heading[1].length - 1;
      trail[heading[1].length - 1] = heading[2].trim();
      units.push({ start: line.start, end: line.end, place: '', heading: trailText(), section: true });
      continue;
    }
    if (!line.text.trim() && !fenced) { close(); continue; }
    if (!first) first = line;
    last = line;
  }
  close();
  return units;
}

// A spreadsheet as MeshKeep's extractor writes it: `# sheetN.xml`, then a
// header row, then rows, tab-separated. Each line is a unit carrying its
// sheet's header row.
export function sheetUnits(text: string): Unit[] {
  const units: Unit[] = [];
  let place = '';
  let header: string | undefined;
  let sheetLine: Unit | null = null;
  for (const line of linesOf(text)) {
    const sheet = line.text.match(/^# sheet(\d+)\.xml$/);
    if (sheet) {
      place = `sheet ${sheet[1]}`;
      header = undefined;
      sheetLine = { start: line.start, end: line.end, place, heading: '', section: true };
      units.push(sheetLine);
      continue;
    }
    if (!line.text.trim()) continue;
    if (sheetLine) {
      // The first row is the header. The sheet's own line carries it too,
      // so the chunk that starts the sheet is labelled like the rest.
      header = line.text;
      sheetLine.header = header;
      sheetLine = null;
    }
    units.push({ start: line.start, end: line.end, place, heading: '', section: false, header });
  }
  return units;
}

// A PDF read page by page: the pages joined with a blank line, each page's
// paragraphs as units with the page as their place.
export function pdfDocument(pages: string[]): Document {
  let text = '';
  const units: Unit[] = [];
  pages.forEach((page, index) => {
    const content = canonicalText(page).trim();
    if (!content) return;
    if (text) text += '\n\n';
    const from = text.length;
    text += content;
    units.push(...paragraphUnits(text, `page ${index + 1}`, from, text.length));
  });
  return { text, units };
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

// A range longer than the maximum, cut into pieces of at most the target: at
// the last line end in reach, else the last space or tab, else inside the text. A
// cut never falls between the two halves of a character outside the BMP.
// The pieces are adjacent: nothing is dropped and nothing is added.
export function splitRange(text: string, start: number, end: number, rule: ChunkRule = CHUNK_RULE): Array<[number, number]> {
  if (end - start <= rule.maxChars) return [[start, end]];
  const pieces: Array<[number, number]> = [];
  let position = start;
  while (end - position > rule.targetChars) {
    const window = text.slice(position, position + rule.targetChars);
    const half = rule.targetChars / 2;
    let cut = window.lastIndexOf('\n');
    // A space or a tab: the cells of a sheet's row are separated by tabs.
    if (cut < half) cut = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\t'));
    if (cut < half) cut = rule.targetChars;
    let at = position + cut;
    if (isHighSurrogate(text.charCodeAt(at - 1))) at -= 1;
    pieces.push([position, at]);
    position = at;
  }
  pieces.push([position, end]);
  return pieces;
}

// Units in order, joined into chunks while they fit.
//   `joinSections` false: a chunk starts at every heading, so chunks are
//   small and each is about one thing.
//   `joinSections` true: neighbouring sections share a chunk while it has
//   room.
// Either way a chunk never crosses a page or a sheet and never passes the
// maximum.
export function chunksOf(document: Document, joinSections: boolean, rule: ChunkRule = CHUNK_RULE): Chunk[] {
  const { text } = document;
  const pieces = document.units.flatMap((unit) => splitRange(text, unit.start, unit.end, rule).map(([start, end], index) => ({ ...unit, start, end, section: index === 0 && unit.section, cut: index > 0 })));
  const chunks: Chunk[] = [];
  // Typed by assertion: `close` resets it inside a closure, which narrowing
  // from a plain `= null` would not see.
  let current = null as (typeof pieces)[number] | null;
  let continuesPrevious = false;
  const close = () => {
    if (!current) return;
    const header = current.header;
    chunks.push({
      ordinal: chunks.length,
      start: current.start,
      end: current.end,
      text: text.slice(current.start, current.end),
      place: current.place,
      heading: current.heading,
      continuesPrevious,
      ...(header === undefined ? {} : { header: header.slice(0, rule.headerChars), ...(header.length > rule.headerChars ? { headerCut: true } : {}) }),
    });
    current = null;
  };
  for (const piece of pieces) {
    const mayJoin = current !== null && !piece.cut && current.place === piece.place && (joinSections || !piece.section) && piece.end - current.start <= rule.targetChars;
    if (current && mayJoin) {
      current = { ...current, end: piece.end, header: current.header ?? piece.header };
      continue;
    }
    close();
    continuesPrevious = piece.cut;
    current = { ...piece };
  }
  close();
  return chunks;
}

// The label a passage is sent under: its place, the headings above it, and
// for a sheet its header row.
export function passageLabel(chunk: Chunk): string {
  const parts = [chunk.place, chunk.heading].filter(Boolean);
  if (chunk.header !== undefined) parts.push(`columns: ${chunk.header.replaceAll('\t', ' | ')}${chunk.headerCut ? ' …' : ''}`);
  return parts.length ? `[${parts.join(' · ')}]` : '';
}

// The text a file contributes when some of its chunks are sent: chunks that
// follow each other become one slice of the file, exactly as the file has it,
// under the label of the first; a gap between them is marked.
export function passagesText(document: Document, chunks: Chunk[]): string {
  const sorted = [...chunks].sort((a, b) => a.ordinal - b.ordinal);
  const runs: Chunk[][] = [];
  for (const chunk of sorted) {
    const run = runs.at(-1);
    if (run && run.at(-1)!.ordinal + 1 === chunk.ordinal) run.push(chunk);
    else runs.push([chunk]);
  }
  return runs.map((run) => {
    const label = passageLabel(run[0]);
    const body = document.text.slice(run[0].start, run.at(-1)!.end);
    return label ? `${label}\n${body}` : body;
  }).join('\n\n[…]\n\n');
}

// The chosen chunks of one file, with the neighbours a cut inside a line
// makes inseparable added while `room` characters allow. A chunk that
// continues the one before is read only with it, and the other way round.
export function withNeighbours(chunks: Chunk[], chosen: number[], room: number): number[] {
  const taken = new Set(chosen);
  let used = chosen.reduce((sum, ordinal) => sum + chunks[ordinal].text.length, 0);
  const queue = [...chosen];
  while (queue.length) {
    const ordinal = queue.shift()!;
    const linked = [
      chunks[ordinal].continuesPrevious ? ordinal - 1 : -1,
      chunks[ordinal + 1]?.continuesPrevious ? ordinal + 1 : -1,
    ];
    for (const neighbour of linked) {
      if (neighbour < 0 || taken.has(neighbour)) continue;
      if (used + chunks[neighbour].text.length > room) continue;
      taken.add(neighbour);
      used += chunks[neighbour].text.length;
      queue.push(neighbour);
    }
  }
  return [...taken].sort((a, b) => a - b);
}
