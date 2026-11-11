// A what-if for `docs/adr/0001-context-and-citations.md`: what would other
// ways of choosing context deliver on an evaluation set, next to the measured
// baseline?
//
//   node --experimental-strip-types scripts/eval-context-chunks.mjs dev
//
// This is a simulation, not the application. It cuts the corpus into chunks,
// indexes them in an in-memory SQLite FTS5 table with the tokenizer and the
// query builder the application uses today (`lib/search.ts`), and runs every
// question through several strategies side by side. For each it reports, like
// the baseline, whether every expected file was found and whether every
// expected quote is inside the text that would be sent, and how much text
// that is.
//
// What it cannot say: how D1 ranks (same engine, another build), how a real
// model uses the text, or what an implementation costs. Needs Node 24: the
// SQLite in Node 22 has no FTS5.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';
import { normalizeText, questionSet } from '../eval/context/schema.ts';
import { wydobadzTekstDokumentu } from '../lib/document-text.ts';
import { buildSuggestQuery } from '../lib/search.ts';

const setName = process.argv[2];
if (!setName) {
  console.error('Usage: node --experimental-strip-types scripts/eval-context-chunks.mjs <set>');
  process.exit(2);
}
const SET = fileURLToPath(new URL(`../eval/context/sets/${setName}/`, import.meta.url));
const { questions } = questionSet.parse(JSON.parse(readFileSync(join(SET, 'questions.json'), 'utf8')));

// A chunk aims at this many characters and never grows past the maximum. A
// block that is longer on its own is cut at line ends.
const TARGET_CHARS = 1_500;
const MAX_CHARS = 2_400;
// "Files, then passages": files are chosen as today, then each brings either
// all of its text, when it is short, or its best passages.
const FILE_LIMIT = 5;
const WHOLE_FILE_CHARS = 6_000;
const PER_FILE_CHARS = 6_000;

// --- From a file to blocks --------------------------------------------------
//
// A block is text that belongs together, with where it sits in the file:
// a page of a PDF, the rows of a sheet under their header, a paragraph under
// its Markdown heading, a paragraph of anything else.

function bytesOf(path) {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

// Lines that fit together under `limit` characters, each group led by
// `header` when one is given (a table's header row, for one).
function pack(lines, limit, header = '') {
  const groups = [];
  let current = [];
  let size = header.length;
  for (const line of lines) {
    if (current.length && size + line.length + 1 > limit) {
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

const cleanPdf = (text) => text.replaceAll(' ', ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// The text of a file as the search index holds it today: everything the
// extractor returns, cut at the 100 000 characters `lib/server/search-index.ts`
// keeps.
async function indexedTextOf(file) {
  const path = join(SET, 'corpus', file);
  const extension = file.split('.').pop().toLowerCase();
  let text;
  if (extension === 'pdf') {
    const merged = await extractText(await getDocumentProxy(bytesOf(path)), { mergePages: true });
    text = cleanPdf(Array.isArray(merged.text) ? merged.text.join('\n') : merged.text);
  } else if (extension === 'xlsx' || extension === 'docx') {
    text = (await wydobadzTekstDokumentu(extension, bytesOf(path))).tekst;
  } else {
    text = new TextDecoder().decode(bytesOf(path)).replaceAll('\0', '');
  }
  return text.slice(0, 100_000);
}

async function blocksOf(file) {
  const path = join(SET, 'corpus', file);
  const extension = file.split('.').pop().toLowerCase();

  if (extension === 'pdf') {
    const { text } = await extractText(await getDocumentProxy(bytesOf(path)), { mergePages: false });
    return text.map((page, index) => ({ text: cleanPdf(page), place: `page ${index + 1}`, heading: '' })).filter((block) => block.text);
  }

  if (extension === 'xlsx') {
    const { tekst } = await wydobadzTekstDokumentu('xlsx', bytesOf(path));
    const parts = tekst.split(/^# sheet(\d+)\.xml$/m);
    const blocks = [];
    for (let i = 1; i < parts.length; i += 2) {
      const [header = '', ...rows] = parts[i + 1].trim().split('\n');
      // Every chunk of a sheet repeats its header row: a row of numbers says
      // nothing without the names of its columns.
      for (const text of pack(rows, TARGET_CHARS, header)) blocks.push({ text, place: `sheet ${parts[i]}`, heading: '' });
    }
    return blocks;
  }

  if (extension === 'docx') {
    const { tekst } = await wydobadzTekstDokumentu('docx', bytesOf(path));
    return tekst.split('\n').filter((line) => line.trim()).map((text) => ({ text, place: '', heading: '' }));
  }

  const text = new TextDecoder().decode(bytesOf(path)).replaceAll('\0', '');
  if (extension === 'md') {
    // A block carries the headings above it, so a chunk from the middle of a
    // long file still says what it is about.
    const blocks = [];
    const trail = [];
    let lines = [];
    const flush = () => {
      const body = lines.join('\n').trim();
      if (body) {
        const heading = trail.filter(Boolean).join(' › ');
        for (const paragraph of body.split(/\n{2,}/)) blocks.push({ text: paragraph, place: '', heading });
      }
      lines = [];
    };
    let fenced = false;
    for (const line of text.split('\n')) {
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
  return text.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).map((paragraph) => ({ text: paragraph.trim(), place: '', heading: '' }));
}

// Blocks in order, joined while they fit.
//   `joinSections` false: a chunk never crosses a heading, so chunks are small
//   and each is about one thing.
//   `joinSections` true: neighbouring sections share a chunk while it has
//   room, each led by its heading, so a chunk holds more of what the file says
//   around a fact. A chunk still never crosses a page or a sheet.
function chunksOf(blocks, joinSections) {
  const chunks = [];
  let current = null;
  const close = () => { if (current) chunks.push(current); current = null; };
  for (const block of blocks) {
    const pieces = block.text.length > MAX_CHARS ? pack(block.text.split('\n'), TARGET_CHARS) : [block.text];
    for (const piece of pieces) {
      const sameSection = current && current.lastHeading === block.heading;
      const samePlace = current && current.place === block.place;
      const text = joinSections && block.heading && !sameSection ? `${block.heading}\n${piece}` : piece;
      const mayJoin = samePlace && (joinSections || sameSection);
      if (current && mayJoin && current.text.length + text.length + 2 <= TARGET_CHARS) {
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

// --- The indexes ------------------------------------------------------------

const files = readdirSync(join(SET, 'corpus'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name).slice(join(SET, 'corpus').length + 1).replaceAll('\\', '/'))
  .sort();

const database = new DatabaseSync(':memory:');
// The same tokenizer as `file_texts_fts` in `drizzle/0003_search_index.sql`.
const TOKENIZER = "tokenize='unicode61 remove_diacritics 2'";
database.exec(`CREATE VIRTUAL TABLE whole USING fts5(path, content, project UNINDEXED, file UNINDEXED, ${TOKENIZER})`);
for (const table of ['small', 'joined']) {
  database.exec(`CREATE VIRTUAL TABLE ${table} USING fts5(path, heading, content, project UNINDEXED, file UNINDEXED, ordinal UNINDEXED, ${TOKENIZER})`);
}

const shape = {};
const fileChunks = new Map();
for (const file of files) {
  const [project, ...rest] = file.split('/');
  const path = rest.join('/');
  const blocks = await blocksOf(file);
  database.prepare('INSERT INTO whole (path, content, project, file) VALUES (?, ?, ?, ?)').run(path, await indexedTextOf(file), project, file);
  for (const [table, joinSections] of [['small', false], ['joined', true]]) {
    const chunks = chunksOf(blocks, joinSections);
    if (joinSections) fileChunks.set(file, chunks.map((chunk) => chunk.text));
    const insert = database.prepare(`INSERT INTO ${table} (path, heading, content, project, file, ordinal) VALUES (?, ?, ?, ?, ?, ?)`);
    chunks.forEach((chunk, ordinal) => insert.run(path, chunk.heading, chunk.text, project, file, ordinal));
    const lengths = chunks.map((chunk) => chunk.text.length);
    const entry = shape[table] ?? (shape[table] = { chunks: 0, chars: 0, longest: 0 });
    entry.chunks += chunks.length;
    entry.chars += lengths.reduce((sum, length) => sum + length, 0);
    entry.longest = Math.max(entry.longest, ...lengths);
  }
}
for (const entry of Object.values(shape)) entry.meanChars = Math.round(entry.chars / entry.chunks);

// --- The strategies ---------------------------------------------------------
//
// Each takes a question and returns the passages that would be sent, in the
// order they would be sent, as `{ file, content }`.

// Path and heading count for more than the body, as the path does today
// (`bm25(file_texts_fts, 4.0, 1.0)` in the suggest-files route).
function topChunks(table, limit) {
  const select = database.prepare(`SELECT file, content FROM ${table} WHERE ${table} MATCH ? AND project = ? ORDER BY bm25(${table}, 4.0, 2.0, 1.0) LIMIT ?`);
  return (question, match) => select.all(match, question.project, limit);
}

// Files as the application chooses them today, but each file then brings all
// of its text when it is short, and otherwise only its best passages. No file
// can take the room of the ones ranked below it.
function filesThenPassages(totalChars) {
  const pickFiles = database.prepare('SELECT file FROM whole WHERE whole MATCH ? AND project = ? ORDER BY bm25(whole, 4.0, 1.0) LIMIT ?');
  const pickPassages = database.prepare('SELECT ordinal, content FROM joined WHERE joined MATCH ? AND file = ? ORDER BY bm25(joined, 4.0, 2.0, 1.0) LIMIT 40');
  return (question, match) => {
    const sent = [];
    let room = totalChars;
    for (const { file } of pickFiles.all(match, question.project, FILE_LIMIT)) {
      const all = fileChunks.get(file);
      let passages;
      if (all.reduce((sum, text) => sum + text.length, 0) <= WHOLE_FILE_CHARS) {
        passages = all.map((content, ordinal) => ({ ordinal, content }));
      } else {
        passages = [];
        let used = 0;
        for (const passage of pickPassages.all(match, file)) {
          if (used + passage.content.length > PER_FILE_CHARS) continue;
          passages.push(passage);
          used += passage.content.length;
        }
        // Back into the order of the document, so the model reads them as
        // the file has them.
        passages.sort((a, b) => a.ordinal - b.ordinal);
      }
      for (const passage of passages) {
        if (passage.content.length > room) continue;
        sent.push({ file, content: passage.content });
        room -= passage.content.length;
      }
    }
    return sent;
  };
}

const STRATEGIES = {
  'small-chunks-top6': { describe: 'Best 6 chunks of the project; a chunk never crosses a heading.', pick: topChunks('small', 6) },
  'small-chunks-top12': { describe: 'Best 12 chunks of the project; a chunk never crosses a heading.', pick: topChunks('small', 12) },
  'joined-chunks-top6': { describe: 'Best 6 chunks of the project; neighbouring sections share a chunk.', pick: topChunks('joined', 6) },
  'joined-chunks-top12': { describe: 'Best 12 chunks of the project; neighbouring sections share a chunk.', pick: topChunks('joined', 12) },
  'files-then-passages-12k': { describe: 'Best 5 files as today; a short file whole, a long file by its best passages; 12 000 characters in all.', pick: filesThenPassages(12_000) },
  'files-then-passages-24k': { describe: 'Best 5 files as today; a short file whole, a long file by its best passages; 24 000 characters in all.', pick: filesThenPassages(24_000) },
};

// --- The questions ----------------------------------------------------------

const round = (value) => Math.round(value * 10_000) / 10_000;
const mean = (values) => (values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0);

function ask(question, pick) {
  const match = buildSuggestQuery(question.question.slice(0, 500));
  const hits = match ? pick(question, match) : [];
  const sent = normalizeText(hits.map((hit) => hit.content).join('\n\n'));
  const sources = question.expected.map((source) => ({
    file: source.file,
    found: hits.some((hit) => hit.file === source.file),
    delivered: sent.includes(normalizeText(source.quote)),
  }));
  return {
    id: question.id,
    kind: question.kind,
    lang: question.lang,
    tags: question.tags,
    passages: hits.length,
    files: new Set(hits.map((hit) => hit.file)).size,
    chars: hits.reduce((sum, hit) => sum + hit.content.length, 0),
    complete: sources.every((source) => source.found),
    delivered: sources.every((source) => source.delivered),
  };
}

function totalOf(results) {
  return {
    n: results.length,
    complete: mean(results.map((result) => (result.complete ? 1 : 0))),
    delivered: mean(results.map((result) => (result.delivered ? 1 : 0))),
    meanChars: Math.round(mean(results.map((result) => result.chars))),
    maxChars: Math.max(0, ...results.map((result) => result.chars)),
  };
}

function grouped(results, keysOf) {
  const groups = new Map();
  for (const result of results) for (const key of keysOf(result)) groups.set(key, [...(groups.get(key) ?? []), result]);
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => [key, totalOf(items)]));
}

const strategies = {};
for (const [name, { describe, pick }] of Object.entries(STRATEGIES)) {
  const results = questions.filter((question) => question.kind !== 'access').map((question) => ask(question, pick));
  const scored = results.filter((result) => result.kind === 'answerable' || result.kind === 'multi-file');
  strategies[name] = {
    describe,
    scored: totalOf(scored),
    byKind: grouped(scored, (result) => [result.kind]),
    byLang: grouped(scored, (result) => [result.lang]),
    byTag: grouped(scored, (result) => (result.tags.length ? result.tags : ['plain'])),
    noAnswer: totalOf(results.filter((result) => result.kind === 'no-answer')),
    notDelivered: scored.filter((result) => !result.delivered).map((result) => result.id),
    questions: results.map(({ id, passages, files: fileCount, chars, complete, delivered }) => ({ id, passages, files: fileCount, chars, complete, delivered })),
  };
}

// How faithful the simulation is: its choice of files, made the way the
// application makes it, set against what the application suggested when the
// baseline was measured. Where they agree, a difference between a strategy and
// the baseline comes from the strategy, not from the simulation.
const baselinePath = join(SET, 'baseline.json');
const measured = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
let fidelity = null;
if (measured) {
  const pickFiles = database.prepare('SELECT file FROM whole WHERE whole MATCH ? AND project = ? ORDER BY bm25(whole, 4.0, 1.0) LIMIT ?');
  const differing = [];
  for (const question of questions) {
    const match = buildSuggestQuery(question.question.slice(0, 500));
    const simulated = match ? pickFiles.all(match, question.project, FILE_LIMIT).map((row) => row.file) : [];
    const suggested = measured.questions.find((result) => result.id === question.id)?.suggestions.map((suggestion) => suggestion.file) ?? [];
    if (JSON.stringify(simulated) !== JSON.stringify(suggested)) differing.push(question.id);
  }
  fidelity = { questions: questions.length, sameFilesInSameOrder: questions.length - differing.length, differing };
}

const output = {
  version: 1,
  set: setName,
  simulation: true,
  fidelity,
  rule: { targetChars: TARGET_CHARS, maxChars: MAX_CHARS, fileLimit: FILE_LIMIT, wholeFileChars: WHOLE_FILE_CHARS, perFileChars: PER_FILE_CHARS, weights: { path: 4, heading: 2, content: 1 } },
  corpus: { files: files.length, ...shape },
  strategies,
};
writeFileSync(join(SET, 'simulation.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`${files.length} files. Small chunks: ${shape.small.chunks}, mean ${shape.small.meanChars} characters. Joined chunks: ${shape.joined.chunks}, mean ${shape.joined.meanChars} characters.`);
const row = (name, total, missed) => console.log(`${name.padEnd(26)} found ${String(Math.round(total.complete * 100)).padStart(3)}%  delivered ${String(Math.round(total.delivered * 100)).padStart(3)}%  mean ${String(total.meanChars).padStart(6)} chars  max ${String(total.maxChars).padStart(6)}${missed ? `  missed: ${missed}` : ''}`);
if (measured) {
  console.log(`Fidelity: the simulated choice of files matches the application's suggestions, file for file and in order, for ${fidelity.sameFilesInSameOrder} of ${fidelity.questions} questions${fidelity.differing.length ? ` (differs: ${fidelity.differing.join(', ')})` : ''}.`);
  const { scored, context } = measured.totals;
  const missed = measured.questions.filter((result) => (result.kind === 'answerable' || result.kind === 'multi-file') && !result.delivered).map((result) => result.id).join(', ');
  row('baseline (measured)', { complete: scored.complete, delivered: scored.delivered, meanChars: context.scored.meanChars, maxChars: context.scored.maxChars }, missed);
}
for (const [name, strategy] of Object.entries(strategies)) row(name, strategy.scored, strategy.notDelivered.join(', '));
console.log(`Written to eval/context/sets/${setName}/simulation.json`);
