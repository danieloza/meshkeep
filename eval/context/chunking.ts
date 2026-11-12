// How a file's text is cut into chunks, for the simulation in
// `scripts/eval-context-chunks.mjs` and for the tests that pin the rule down.
// This is the rule `docs/adr/0001-context-and-citations.md` proposes, not code
// the application runs.
//
// Only erasable TypeScript, and no imports: Node runs this file as it is.

// A block is text that belongs together, with where it sits in the file: a
// page of a PDF, rows of a sheet under their header, a paragraph under its
// Markdown headings, a paragraph of anything else.
export type Block = { text: string; place: string; heading: string };
export type Chunk = { text: string; place: string; heading: string };

export type ChunkRule = {
  // A chunk aims at this many characters.
  targetChars: number;
  // No chunk is longer than this.
  maxChars: number;
};

export const CHUNK_RULE: ChunkRule = { targetChars: 1_500, maxChars: 2_400 };

// One line ending everywhere. A checkout on Windows may hold the same file
// with CRLF, and a paragraph break must be the same break in both.
export function canonicalText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

// A line longer than the maximum, cut into pieces of at most the target. The
// cut falls on a space where one is in reach, and inside a word only where
// there is none. Nothing is dropped: the pieces joined with nothing between
// them are the line again.
export function splitLongLine(line: string, rule: ChunkRule = CHUNK_RULE): string[] {
  if (line.length <= rule.maxChars) return [line];
  const pieces: string[] = [];
  let rest = line;
  while (rest.length > rule.targetChars) {
    let cut = rest.lastIndexOf(' ', rule.targetChars);
    if (cut < rule.targetChars / 2) cut = rule.targetChars;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}

// Lines grouped so that each group stays within the target, every group led
// by `header` when one is given (a table's header row, for one). A line that
// is too long on its own is cut first, so no group passes the maximum.
export function pack(lines: string[], rule: ChunkRule = CHUNK_RULE, header = ''): string[] {
  const groups: string[][] = [];
  let current: string[] = [];
  let size = header.length;
  for (const line of lines.flatMap((entry) => splitLongLine(entry, rule))) {
    if (current.length && size + line.length + 1 > rule.targetChars) {
      groups.push(current);
      current = [];
      size = header.length;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length) groups.push(current);
  return groups.map((group) => (header ? [header, ...group] : group).join('\n'));
}

// Plain text: one block per paragraph.
export function paragraphBlocks(text: string): Block[] {
  return canonicalText(text).split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean)
    .map((paragraph) => ({ text: paragraph, place: '', heading: '' }));
}

// Markdown: one block per paragraph, carrying the headings above it, so a
// chunk from the middle of a long file still says what it is about. A `#`
// inside a fenced code block is not a heading.
export function markdownBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const trail: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    const body = lines.join('\n').trim();
    if (body) {
      const heading = trail.filter(Boolean).join(' › ');
      for (const paragraph of body.split(/\n{2,}/)) blocks.push({ text: paragraph.trim(), place: '', heading });
    }
    lines = [];
  };
  let fenced = false;
  for (const line of canonicalText(text).split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const match = fenced ? null : line.match(/^(#{1,6}) (.*)$/);
    if (match) {
      flush();
      trail.length = match[1].length - 1;
      trail[match[1].length - 1] = match[2].trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  return blocks;
}

// A spreadsheet as MeshKeep's extractor writes it: `# sheetN.xml`, then
// tab-separated rows. Every block of a sheet repeats the header row: a row of
// numbers says nothing without the names of its columns.
export function sheetBlocks(extracted: string, rule: ChunkRule = CHUNK_RULE): Block[] {
  const parts = canonicalText(extracted).split(/^# sheet(\d+)\.xml$/m);
  const blocks: Block[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const [header = '', ...rows] = parts[i + 1].trim().split('\n');
    for (const text of pack(rows, rule, header)) blocks.push({ text, place: `sheet ${parts[i]}`, heading: '' });
  }
  return blocks;
}

// A PDF, one block per page that has text.
export function pageBlocks(pages: string[]): Block[] {
  return pages.map((page, index) => ({ text: canonicalText(page).trim(), place: `page ${index + 1}`, heading: '' })).filter((block) => block.text);
}

// Blocks in order, joined while they fit.
//   `joinSections` false: a chunk never crosses a heading, so chunks are small
//   and each is about one thing.
//   `joinSections` true: neighbouring sections share a chunk while it has
//   room, each led by its heading, so a chunk holds more of what the file says
//   around a fact.
// Either way a chunk never crosses a page or a sheet and never passes the
// maximum.
export function chunksOf(blocks: Block[], joinSections: boolean, rule: ChunkRule = CHUNK_RULE): Chunk[] {
  const chunks: Chunk[] = [];
  let current: (Chunk & { lastHeading: string }) | null = null;
  const close = () => {
    if (current) chunks.push({ text: current.text, place: current.place, heading: current.heading });
    current = null;
  };
  for (const block of blocks) {
    const pieces = block.text.length > rule.maxChars ? pack(block.text.split('\n'), rule) : [block.text];
    for (const piece of pieces) {
      const sameSection: boolean = current !== null && current.lastHeading === block.heading;
      const samePlace: boolean = current !== null && current.place === block.place;
      const led: string = joinSections && block.heading && !sameSection ? `${block.heading}\n${piece}` : piece;
      // The heading is kept in its own field as well, so it may be left out
      // of the text where it would push the chunk past the maximum.
      const text: string = led.length <= rule.maxChars ? led : piece;
      const mayJoin = samePlace && (joinSections || sameSection);
      if (current && mayJoin && current.text.length + text.length + 2 <= rule.targetChars) {
        current.text += `\n\n${text}`;
        current.lastHeading = block.heading;
      } else {
        close();
        current = { text, place: block.place, heading: block.heading, lastHeading: block.heading };
      }
    }
  }
  close();
  return chunks;
}
