// How a passage counts as delivered at its place, read from what the model
// provider received (ADR 0001, section 7, row B). Shared by the runner
// (`scripts/eval-context.mjs`) and the tests.
//
// A long file reaches the provider as runs: a label line, then the file's own
// text. The manifest lists the chunks behind each run, with their locator and
// the characters each adds to its run's body. With that, the reader cuts the
// section into label lines and bodies without the document, and only bodies
// can hold a quote: a generated label never counts.
//
// Only erasable TypeScript. Node runs this file as it is.

import { nextMarkdownFence } from './chunking.ts';
import { normalizeText } from './measure.ts';

// The manifest note of a long file the chat sent as before, because its
// passages were not available. `tests/api/chat-passages.test.ts` pins that the
// chat writes exactly this, so the runner's count of such files is real.
export const FALLBACK_NOTE = 'Passages were not available yet.';

export type Locator = { page: number } | { sheet: number } | { heading: string };
export type SentPassage = { ordinal: number; locator?: Locator; length: number };
export type PassageRun = { locator?: Locator; label: string | null; body: string; ordinals: number[] };

const sameLocator = (a?: Locator, b?: Locator) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The runs of one file's section, as the chat writes them (`passagesText`):
// consecutive chunks with the same locator form one run; runs are separated by
// a blank line, or by an omission mark where chunks were left out; a run has
// a label line exactly when its chunks have a locator. The section must be
// consumed exactly, or the reader refuses it: a measurement on a format it
// does not understand would be worse than none.
export function splitPassages(section: string, passages: SentPassage[]): PassageRun[] {
  if (!passages.length) throw new Error('A file sent by passages lists none.');
  const groups: SentPassage[][] = [];
  for (const [index, passage] of passages.entries()) {
    const previous = passages[index - 1];
    if (previous && passage.ordinal <= previous.ordinal) throw new Error('The passages of a file are not in file order.');
    const group = groups.at(-1);
    if (group && previous.ordinal + 1 === passage.ordinal && sameLocator(previous.locator, passage.locator)) group.push(passage);
    else groups.push([passage]);
  }
  const runs: PassageRun[] = [];
  let at = 0;
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
  return runs;
}

// The parts of a Markdown body under the heading `heading`: the region from
// that heading's line to the next heading line of any level, as the
// simulation reads it (`sourcePassageTexts`). Before the body's first heading
// line, the text is under the run's own heading trail, whose last component
// is the heading it is under. A `#` line inside a code fence is not a heading.
export function textsUnderHeading(body: string, trail: string, heading: string): string[] {
  const texts: string[] = [];
  let under = trail === heading || trail.endsWith(` › ${heading}`);
  let lines: string[] = [];
  let fence: ReturnType<typeof nextMarkdownFence> = null;
  const flush = () => { if (under && lines.length) texts.push(lines.join('\n')); lines = []; };
  for (const line of body.split('\n')) {
    const match = fence ? null : line.match(/^(#{1,6}) (.*)$/);
    if (match) {
      flush();
      under = match[2].trim() === heading;
      continue;
    }
    fence = nextMarkdownFence(line, fence);
    lines.push(line);
  }
  flush();
  return texts;
}

// Whether a quote reached the provider inside a passage body of its file, at
// its expected place: the same page or sheet, or under the same heading. With
// no expected place, any body counts.
export function passageQuoteDelivered(quote: string, runs: PassageRun[], locator?: Locator): boolean {
  const wanted = normalizeText(quote);
  const holds = (text: string) => normalizeText(text).includes(wanted);
  return runs.some((run) => {
    if (!locator) return holds(run.body);
    if ('heading' in locator) {
      const trail = run.locator && 'heading' in run.locator ? run.locator.heading : '';
      return textsUnderHeading(run.body, trail, locator.heading).some(holds);
    }
    return sameLocator(run.locator, locator) && holds(run.body);
  });
}
