// A what-if for `docs/adr/0001-context-and-citations.md`: what would other
// ways of choosing context deliver on an evaluation set, next to the measured
// baseline?
//
//   node --experimental-strip-types scripts/eval-context-chunks.mjs dev
//
// This is a simulation, not the application. It cuts the corpus into chunks
// (`eval/context/chunking.ts`), indexes them in an in-memory SQLite FTS5 table
// with the tokenizer and the query builder the application uses today
// (`lib/search.ts`), and runs every question through several strategies side
// by side. It counts by the same rules as the baseline
// (`eval/context/measure.ts`): an expected file is found when a passage of it
// is chosen, a quote is delivered when it is in the text chosen from its own
// file, and the size of the context is the size of the message the chat would
// write around that text.
//
// What it cannot say: how D1 ranks (same engine, another build), how a real
// model uses the text, or what an implementation costs. Needs Node 24: the
// SQLite in Node 22 has no FTS5.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';
import { CHUNK_RULE, canonicalText, chunksOf, markdownBlocks, pageBlocks, paragraphBlocks, sheetBlocks } from '../eval/context/chunking.ts';
import { contextTotal, fileContextMessage, grouped, mimeOf, quoteDelivered, totalOf } from '../eval/context/measure.ts';
import { questionSet } from '../eval/context/schema.ts';
import { wydobadzTekstDokumentu } from '../lib/document-text.ts';
import { buildSuggestQuery } from '../lib/search.ts';

const setName = process.argv[2];
if (!setName) {
  console.error('Usage: node --experimental-strip-types scripts/eval-context-chunks.mjs <set>');
  process.exit(2);
}
const SET = fileURLToPath(new URL(`../eval/context/sets/${setName}/`, import.meta.url));
const { questions } = questionSet.parse(JSON.parse(readFileSync(join(SET, 'questions.json'), 'utf8')));

// "Files, then passages": files are chosen as today, then each brings either
// all of its text, when it is short, or its best passages.
const FILE_LIMIT = 5;
const WHOLE_FILE_CHARS = 6_000;
const PER_FILE_CHARS = 6_000;
// What the search index keeps of a file today (`lib/server/search-index.ts`).
const INDEXED_CHARS = 100_000;

// --- From a file to text and blocks -----------------------------------------

function bytesOf(path) {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

const extensionOf = (file) => file.split('.').pop().toLowerCase();
// As `lib/server/pdf-text.ts` cleans what pdf.js returns.
const cleanPdf = (text) => text.replaceAll(' ', ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// The text of a file as the search index holds it today: everything the
// extractor returns, cut where the index cuts it. Plain text is taken as the
// file has it, line endings included, because that is what the application
// indexes.
async function indexedTextOf(file) {
  const path = join(SET, 'corpus', file);
  const extension = extensionOf(file);
  let text;
  if (extension === 'pdf') {
    const merged = await extractText(await getDocumentProxy(bytesOf(path)), { mergePages: true });
    text = cleanPdf(Array.isArray(merged.text) ? merged.text.join('\n') : merged.text);
  } else if (extension === 'xlsx' || extension === 'docx') {
    text = (await wydobadzTekstDokumentu(extension, bytesOf(path))).tekst;
  } else {
    text = new TextDecoder().decode(bytesOf(path)).replaceAll('\0', '');
  }
  return text.slice(0, INDEXED_CHARS);
}

async function blocksOf(file) {
  const path = join(SET, 'corpus', file);
  const extension = extensionOf(file);
  if (extension === 'pdf') {
    const { text } = await extractText(await getDocumentProxy(bytesOf(path)), { mergePages: false });
    return pageBlocks(text.map(cleanPdf));
  }
  if (extension === 'xlsx') return sheetBlocks((await wydobadzTekstDokumentu('xlsx', bytesOf(path))).tekst);
  if (extension === 'docx') {
    // The extractor writes one paragraph per line.
    const { tekst } = await wydobadzTekstDokumentu('docx', bytesOf(path));
    return canonicalText(tekst).split('\n').filter((line) => line.trim()).map((text) => ({ text, place: '', heading: '' }));
  }
  const text = new TextDecoder().decode(bytesOf(path)).replaceAll('\0', '');
  return extension === 'md' ? markdownBlocks(text) : paragraphBlocks(text);
}

// --- The indexes ------------------------------------------------------------

const files = readdirSync(join(SET, 'corpus'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name).slice(join(SET, 'corpus').length + 1).replaceAll('\\', '/'))
  .sort();
const pathIn = (file) => file.slice(file.indexOf('/') + 1);

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
  const project = file.split('/')[0];
  const blocks = await blocksOf(file);
  database.prepare('INSERT INTO whole (path, content, project, file) VALUES (?, ?, ?, ?)').run(pathIn(file), await indexedTextOf(file), project, file);
  for (const [table, joinSections] of [['small', false], ['joined', true]]) {
    const chunks = chunksOf(blocks, joinSections);
    if (joinSections) fileChunks.set(file, chunks.map((chunk) => chunk.text));
    const insert = database.prepare(`INSERT INTO ${table} (path, heading, content, project, file, ordinal) VALUES (?, ?, ?, ?, ?, ?)`);
    chunks.forEach((chunk, ordinal) => insert.run(pathIn(file), chunk.heading, chunk.text, project, file, ordinal));
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

const pickFiles = database.prepare('SELECT file FROM whole WHERE whole MATCH ? AND project = ? ORDER BY bm25(whole, 4.0, 1.0) LIMIT ?');

// Files as the application chooses them today, but each file then brings all
// of its text when it is short, and otherwise only its best passages. No file
// can take the room of the ones ranked below it.
function filesThenPassages(totalChars) {
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

const isScored = (kind) => kind === 'answerable' || kind === 'multi-file';
const sizeOf = new Map(files.map((file) => [file, statSync(join(SET, 'corpus', file)).size]));

function ask(question, pick) {
  const match = buildSuggestQuery(question.question.slice(0, 500));
  const hits = match ? pick(question, match) : [];

  // The text each file would contribute, in the order its first passage is
  // sent, and the message the chat would write around it.
  const byFile = new Map();
  for (const hit of hits) byFile.set(hit.file, [...(byFile.get(hit.file) ?? []), hit.content]);
  const sections = [...byFile.entries()].map(([file, passages]) => ({ file, text: passages.join('\n\n') }));
  const message = fileContextMessage(sections.map(({ file, text }) => ({ path: pathIn(file), mimeType: mimeOf(file), sizeBytes: sizeOf.get(file), text })));

  const scored = isScored(question.kind);
  const sources = question.expected.map((source) => ({
    file: source.file,
    found: byFile.has(source.file),
    // Only text chosen from the source's own file can deliver its quote.
    delivered: quoteDelivered(source.quote, sections.find((section) => section.file === source.file)?.text),
  }));
  return {
    id: question.id,
    kind: question.kind,
    lang: question.lang,
    tags: question.tags,
    passages: hits.length,
    files: byFile.size,
    // Characters of the file-context message, or null when nothing is sent.
    chars: hits.length ? message.length : null,
    sources,
    // A question with no expected source is not scored.
    complete: scored ? sources.every((source) => source.found) : null,
    delivered: scored ? sources.every((source) => source.delivered) : null,
  };
}

// The simulation knows whether a file was chosen, not its place in a list, so
// a chosen file counts as rank 1 for the shared totals and `firstRank` is
// left out.
function total(results) {
  const { n, complete, found, delivered } = totalOf(results.map((result) => ({ ranks: result.sources.map((source) => (source.found ? 1 : null)), delivered: result.sources.map((source) => source.delivered) })));
  return { n, complete, found, delivered };
}
const contextOf = (results) => contextTotal(results.map((result) => result.chars));

const strategies = {};
for (const [name, { describe, pick }] of Object.entries(STRATEGIES)) {
  const results = questions.filter((question) => question.kind !== 'access').map((question) => ask(question, pick));
  const scored = results.filter((result) => isScored(result.kind));
  const noAnswer = results.filter((result) => result.kind === 'no-answer');
  strategies[name] = {
    describe,
    scored: total(scored),
    byKind: grouped(scored, (result) => [result.kind], total),
    byLang: grouped(scored, (result) => [result.lang], total),
    byTag: grouped(scored, (result) => (result.tags.length ? result.tags : ['plain']), total),
    context: { scored: contextOf(scored), noAnswer: contextOf(noAnswer) },
    notDelivered: scored.filter((result) => !result.delivered).map((result) => result.id),
    questions: results.map(({ id, kind, passages, files: fileCount, chars, complete, delivered }) => ({ id, kind, passages, files: fileCount, chars, complete, delivered })),
  };
}

// How faithful the simulation is: its choice of files, made the way the
// application makes it, set against what the application suggested when the
// baseline was measured. Where they agree, a difference between a strategy and
// the baseline does not come from how files are ranked. It says nothing about
// passages: the application has none to compare with.
const baselinePath = join(SET, 'baseline.json');
const measured = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
let fidelity = null;
if (measured) {
  const differing = [];
  for (const question of questions) {
    const match = buildSuggestQuery(question.question.slice(0, 500));
    const simulated = match ? pickFiles.all(match, question.project, FILE_LIMIT).map((row) => row.file) : [];
    const suggested = measured.questions.find((result) => result.id === question.id)?.suggestions.map((suggestion) => suggestion.file) ?? [];
    if (JSON.stringify(simulated) !== JSON.stringify(suggested)) differing.push(question.id);
  }
  fidelity = { covers: 'the choice and order of files only', questions: questions.length, sameFilesInSameOrder: questions.length - differing.length, differing };
}

const output = {
  version: 1,
  set: setName,
  simulation: true,
  fidelity,
  rule: { ...CHUNK_RULE, fileLimit: FILE_LIMIT, wholeFileChars: WHOLE_FILE_CHARS, perFileChars: PER_FILE_CHARS, weights: { path: 4, heading: 2, content: 1 } },
  corpus: { files: files.length, ...shape },
  strategies,
};
writeFileSync(join(SET, 'simulation.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`${files.length} files. Small chunks: ${shape.small.chunks}, mean ${shape.small.meanChars} characters, longest ${shape.small.longest}. Joined chunks: ${shape.joined.chunks}, mean ${shape.joined.meanChars} characters, longest ${shape.joined.longest}.`);
const row = (name, scored, context, noAnswer, missed) => console.log(
  `${name.padEnd(26)} n=${scored.n} found ${String(Math.round(scored.complete * scored.n)).padStart(2)} delivered ${String(Math.round(scored.delivered * scored.n)).padStart(2)}  mean ${String(context.meanChars).padStart(6)} max ${String(context.maxChars).padStart(6)}  no-answer n=${noAnswer.n}: ${noAnswer.withContext} with context, mean ${String(noAnswer.meanChars).padStart(6)}${missed ? `  missed: ${missed}` : ''}`,
);
if (measured) {
  console.log(`Fidelity (files only): the simulated choice of files matches the application's suggestions, file for file and in order, for ${fidelity.sameFilesInSameOrder} of ${fidelity.questions} questions${fidelity.differing.length ? ` (differs: ${fidelity.differing.join(', ')})` : ''}.`);
  const { scored, context } = measured.totals;
  const missed = measured.questions.filter((result) => isScored(result.kind) && !result.delivered).map((result) => result.id).join(', ');
  row('baseline (measured)', scored, context.scored, context.noAnswer, missed);
}
for (const [name, strategy] of Object.entries(strategies)) row(name, strategy.scored, strategy.context.scored, strategy.context.noAnswer, strategy.notDelivered.join(', '));
console.log(`Written to eval/context/sets/${setName}/simulation.json`);
