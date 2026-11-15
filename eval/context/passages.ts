// How a passage counts as delivered at its place, read from what the model
// provider received and checked against the source file (ADR 0001, section
// 7, row B). Shared by the runner (`scripts/eval-context.mjs`) and the tests.
//
// A long file reaches the provider as a note line, then runs: a label line,
// then the file's own text. The manifest lists the chunks behind each run,
// with their locator and the characters each adds to its run's body. With
// that, the reader cuts the section into the note, label lines and bodies.
// Each body must then equal the source document's text for those chunks, and
// a quote counts only inside the source region of its expected place, as the
// simulation reads it (`sourcePassageTexts`). A label never counts.
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
export type PassageSection = { note: string; runs: PassageRun[] };

const sameLocator = (a?: Locator, b?: Locator) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// One file's section, as the chat writes it: the note line, then the runs as
// `passagesText` writes them. Consecutive chunks with the same locator form
// one run; runs are separated by a blank line, or by an omission mark where
// chunks were left out; a run has a label line exactly when its chunks have a
// locator. The section must be consumed exactly, or the reader refuses it: a
// measurement on a format it does not understand would be worse than none.
export function splitPassages(section: string, passages: SentPassage[]): PassageSection {
  if (!passages.length) throw new Error('A file sent by passages lists none.');
  const noteEnd = section.indexOf('\n');
  const note = noteEnd < 0 ? '' : section.slice(0, noteEnd);
  if (!/^\[.+\]$/.test(note)) throw new Error('A file sent by passages has no note line.');
  const groups: SentPassage[][] = [];
  for (const [index, passage] of passages.entries()) {
    const previous = passages[index - 1];
    if (previous && passage.ordinal <= previous.ordinal) throw new Error('The passages of a file are not in file order.');
    const group = groups.at(-1);
    if (group && previous.ordinal + 1 === passage.ordinal && sameLocator(previous.locator, passage.locator)) group.push(passage);
    else groups.push([passage]);
  }
  const runs: PassageRun[] = [];
  let at = noteEnd + 1;
  for (const [index, group] of groups.entries()) {
    if (index) {
      const separator = groups[index - 1].at(-1)!.ordinal + 1 === group[0].ordinal ? '\n\n' : '\n\n[…]\n\n';
      if (!section.startsWith(separator, at)) throw new Error(`Passage run ${index + 1} does not start where its manifest says.`);
      at += separator.length;
    }
    let label: string | null = null;
    if (group[0].locator) {
      const end = section.indexOf('\n', at);
      label = end < 0 ? '' : section.slice(at, end);
      if (!/^\[.+\]$/.test(label)) throw new Error(`Passage run ${index + 1} has no label line.`);
      at = end + 1;
    }
    const length = group.reduce((sum, passage) => sum + passage.length, 0);
    if (at + length > section.length) throw new Error(`Passage run ${index + 1} is shorter than its manifest says.`);
    runs.push({ locator: group[0].locator, label, body: section.slice(at, at + length), ordinals: group.map((passage) => passage.ordinal) });
    at += length;
  }
  if (at !== section.length) throw new Error('The section holds more than its passages.');
  return { note: note.slice(1, -1), runs };
}

// The chunks behind a file's passages, from the source document chunked by the
// shared rule, after checking that every run the provider received is the
// document's own text for those chunks, under their own label, and that the
// manifest describes each chunk as the source does: its locator, the
// characters it adds to its run's body, and, when `keys` are given, its stamp.
// The manifest is what a citation will keep, so it is checked, not trusted. A
// mismatch stops the run: the measurement does not guess.
export function sentSourceChunks(document: Document, chunks: Chunk[], passages: SentPassage[], runs: PassageRun[], keys?: string[]): Chunk[] {
  const sent = passages.map((passage) => {
    const chunk = chunks[passage.ordinal];
    if (!chunk) throw new Error(`Passage ${passage.ordinal} is not a chunk of its source file.`);
    if (JSON.stringify(passage.locator ?? null) !== JSON.stringify(chunkLocator(chunk) ?? null)) {
      throw new Error(`The manifest gives passage ${passage.ordinal} a locator its source chunk does not have.`);
    }
    if (keys && passage.chunkKey !== keys[passage.ordinal]) throw new Error(`The manifest gives passage ${passage.ordinal} a stamp its source chunk does not have.`);
    return chunk;
  });
  const expected = passageRuns(document, sent);
  if (expected.length !== runs.length) throw new Error('The runs sent do not match the source chunks behind them.');
  for (const [index, run] of expected.entries()) {
    if (run.body !== runs[index].body || (run.label || null) !== runs[index].label) {
      throw new Error(`Passage run ${index + 1} sent is not the source text of its chunks.`);
    }
    // Each chunk of the source run adds its slice, and after the first the
    // text since the chunk before.
    const members = sent.filter((chunk) => chunk.ordinal >= run.first.ordinal && chunk.ordinal <= run.last.ordinal);
    for (const [position, chunk] of members.entries()) {
      const length = chunk.end - (position ? members[position - 1].end : chunk.start);
      if (passages.find((passage) => passage.ordinal === chunk.ordinal)!.length !== length) {
        throw new Error(`The manifest gives passage ${chunk.ordinal} a length its source chunk does not have.`);
      }
    }
  }
  return sent;
}

// Whether a quote was delivered inside the source region of its expected
// place, within the chunks sent: the simulation's own rule, including the
// first occurrence of a repeated heading. With no expected place, any sent
// source slice counts.
export function sourcePassageDelivered(quote: string, document: Document, sent: Chunk[], locator?: Locator): boolean {
  return sourcePassageTexts(document, sent, locator).some((text) => quoteDelivered(quote, text));
}
