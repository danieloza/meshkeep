// How a passage counts as delivered at its place, read from what the model
// provider received and checked against the source file (ADR 0001, section
// 7, row B). Shared by the runner (`scripts/eval-context.mjs`) and the tests.
//
// A long file reaches the provider as a note line, then runs: a label line,
// then the file's own text. The manifest lists the chunks sent, with their
// locator and the characters each adds to its run's body. The reader maps
// them onto the source document's chunks, groups them into runs by the
// sender's own rule (`passageRuns`), and cuts the section by those runs. Each
// label and body must equal the source's, each manifest entry must describe
// its source chunk, and a quote counts only inside the source region of its
// expected place, as the simulation reads it (`sourcePassageTexts`). A label
// never counts.
//
// Only erasable TypeScript. Node runs this file as it is.

import { type Chunk, chunkLocator, type Document, type PassageLocator, passageRuns, sourcePassageTexts } from './chunking.ts';
import { quoteDelivered } from './measure.ts';

// The manifest note of a long file the chat sent as before, because its
// passages were not available. `tests/api/chat-passages.test.ts` pins that the
// chat writes exactly this, so the runner's count of such files is real.
export const FALLBACK_NOTE = 'Passages were not available yet.';

export type Locator = PassageLocator;
export type SentPassage = { ordinal: number; chunkKey?: string; locator?: Locator; length: number };
export type PassageRun = { locator?: Locator; label: string | null; body: string; ordinals: number[] };
// A source file as the indexer reads it: its document, its chunks and, when
// known, each chunk's stamp (`eval/context/sources.ts`).
export type PassageSource = { document: Document; chunks: Chunk[]; keys?: string[] };
export type PassageSection = { note: string; runs: PassageRun[]; sent: Chunk[] };

// One file's section, as the chat writes it, read against its source:
//   - the note line;
//   - then the runs, as `passagesText` writes them: separated by a blank line,
//     or by an omission mark where chunks were left out; a label line when the
//     run has a label; then its body.
// The run boundaries come from the source chunks and the sender's own rule,
// so a new label within one page or sheet starts a new run here as there.
// Everything must match the source: the chunks, each label and body, and each
// manifest entry's locator, length and (with `keys`) stamp. The section must
// be consumed exactly. Anything else stops the run: a measurement on a format
// it does not understand, or on a manifest it cannot verify, would be worse
// than none.
export function readPassageSection(section: string, passages: SentPassage[], source: PassageSource): PassageSection {
  const { document, chunks, keys } = source;
  if (!passages.length) throw new Error('A file sent by passages lists none.');
  for (const [index, passage] of passages.entries()) {
    if (index && passage.ordinal <= passages[index - 1].ordinal) throw new Error('The passages of a file are not in file order.');
  }
  const noteEnd = section.indexOf('\n');
  const note = noteEnd < 0 ? '' : section.slice(0, noteEnd);
  if (!/^\[.+\]$/.test(note)) throw new Error('A file sent by passages has no note line.');

  const sent = passages.map((passage) => {
    const chunk = chunks[passage.ordinal];
    if (!chunk) throw new Error(`Passage ${passage.ordinal} is not a chunk of its source file.`);
    if (JSON.stringify(passage.locator ?? null) !== JSON.stringify(chunkLocator(chunk) ?? null)) {
      throw new Error(`The manifest gives passage ${passage.ordinal} a locator its source chunk does not have.`);
    }
    if (keys && passage.chunkKey !== keys[passage.ordinal]) throw new Error(`The manifest gives passage ${passage.ordinal} a stamp its source chunk does not have.`);
    return chunk;
  });
  const lengthOf = new Map(passages.map((passage) => [passage.ordinal, passage.length]));

  // The sender's own grouping of the chunks sent into runs.
  const groups = passageRuns(document, sent).map((run) => sent.filter((chunk) => chunk.ordinal >= run.first.ordinal && chunk.ordinal <= run.last.ordinal));

  const runs: PassageRun[] = [];
  let at = noteEnd + 1;
  for (const [index, group] of groups.entries()) {
    const first = group[0];
    const last = group.at(-1)!;
    if (index) {
      const separator = groups[index - 1].at(-1)!.ordinal + 1 === first.ordinal ? '\n\n' : '\n\n[…]\n\n';
      if (!section.startsWith(separator, at)) throw new Error(`Passage run ${index + 1} does not start where its source says.`);
      at += separator.length;
    }
    const expected = passageRuns(document, group);
    if (expected.length !== 1) throw new Error(`Passage run ${index + 1} is not one run of its source.`);
    let label: string | null = null;
    if (expected[0].label) {
      const end = section.indexOf('\n', at);
      label = end < 0 ? '' : section.slice(at, end);
      if (label !== expected[0].label) throw new Error(`Passage run ${index + 1} does not have its source label line.`);
      at = end + 1;
    }
    // The body is as long as the manifest says, and must be the source's own.
    const length = group.reduce((sum, chunk) => sum + lengthOf.get(chunk.ordinal)!, 0);
    if (at + length > section.length) throw new Error(`Passage run ${index + 1} is shorter than its manifest says.`);
    const body = section.slice(at, at + length);
    if (body !== document.text.slice(first.start, last.end)) throw new Error(`Passage run ${index + 1} sent is not the source text of its chunks.`);
    // Each chunk adds its slice, and after the first the text since the chunk before.
    for (const [position, chunk] of group.entries()) {
      if (lengthOf.get(chunk.ordinal) !== chunk.end - (position ? group[position - 1].end : chunk.start)) {
        throw new Error(`The manifest gives passage ${chunk.ordinal} a length its source chunk does not have.`);
      }
    }
    runs.push({ locator: chunkLocator(first), label, body, ordinals: group.map((chunk) => chunk.ordinal) });
    at += length;
  }
  if (at !== section.length) throw new Error('The section holds more than its passages.');
  return { note: note.slice(1, -1), runs, sent };
}

// Whether a quote was delivered inside the source region of its expected
// place, within the chunks sent: the simulation's rule, including the first
// occurrence of a repeated heading. With no expected place, any sent source
// slice counts.
export function sourcePassageDelivered(quote: string, document: Document, sent: Chunk[], locator?: Locator): boolean {
  return sourcePassageTexts(document, sent, locator).some((text) => quoteDelivered(quote, text));
}
