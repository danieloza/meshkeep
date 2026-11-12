// A what-if for `docs/adr/0001-context-and-citations.md`: what would other
// ways of choosing context deliver on an evaluation set, next to the measured
// baseline?
//
//   node --experimental-strip-types scripts/eval-context-chunks.mjs dev
//
// This is a simulation, not the application. It cuts the corpus into chunks
// (`eval/context/chunking.ts`): slices of each file's text, never rewritten,
// with what they are about in a label. It indexes them in an in-memory SQLite
// FTS5 table with the tokenizer and the query builder the application uses
// today (`lib/search.ts`), and runs every question through several strategies
// side by side. It counts by the same rules as the baseline
// (`eval/context/measure.ts`): an expected file is found when text of it is
// chosen, a quote is delivered when it is in the text chosen from its own
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
import { CHUNK_RULE, canonicalText, chunksOf, lineUnits, markdownUnits, paragraphUnits, passageSearchLabel, passagesText, pdfDocument, selectPassages, sheetUnits, sourcePassageTexts, wholeSourceTexts } from '../eval/context/chunking.ts';
import { contextTotal, fileContextMessage, grouped, mean, mimeOf, quoteDelivered, remainingFileContextChars, totalOf } from '../eval/context/measure.ts';
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
// its whole text, when it is short, or its best passages.
const FILE_LIMIT = 5;
const WHOLE_FILE_CHARS = 6_000;
const PER_FILE_CHARS = 6_000;
// What the search index keeps of a file today (`lib/server/search-index.ts`).
const INDEXED_CHARS = 100_000;

// --- From a file to its text and its chunks --------------------------------

function bytesOf(path) {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

const extensionOf = (file) => file.split('.').pop().toLowerCase();
// As `lib/server/pdf-text.ts` cleans what pdf.js returns.
const cleanPdf = (text) => text.replaceAll(' ', ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// The text of a file as the application extracts it today. This is what the
// chat sends when it sends a file whole, and what the index holds (cut at
// 100 000 characters).
async function extractedTextOf(file) {
  const path = join(SET, 'corpus', file);
  const extension = extensionOf(file);
  if (extension === 'pdf') {
    const merged = await extractText(await getDocumentProxy(bytesOf(path)), { mergePages: true });
    return cleanPdf(Array.isArray(merged.text) ? merged.text.join('\n') : merged.text);
  }
  if (extension === 'xlsx' || extension === 'docx') return (await wydobadzTekstDokumentu(extension, bytesOf(path))).tekst;
  return new TextDecoder().decode(bytesOf(path)).replaceAll('\0', '');
}

// The file as the proposed extraction would read it: its text with line
// endings made one, and its units. PDF pages are read one by one, so that a
// chunk knows its page.
async function documentOf(file) {
  const path = join(SET, 'corpus', file);
  const extension = extensionOf(file);
  if (extension === 'pdf') {
    const { text } = await extractText(await getDocumentProxy(bytesOf(path)), { mergePages: false });
    return pdfDocument(text.map(cleanPdf));
  }
  if (extension === 'xlsx') {
    const text = canonicalText((await wydobadzTekstDokumentu('xlsx', bytesOf(path))).tekst);
    return { text, units: sheetUnits(text) };
  }
  if (extension === 'docx') {
    // The extractor writes one paragraph per line.
    const text = canonicalText((await wydobadzTekstDokumentu('docx', bytesOf(path))).tekst);
    return { text, units: lineUnits(text) };
  }
  const text = canonicalText(new TextDecoder().decode(bytesOf(path)).replaceAll('\0', ''));
  return { text, units: extension === 'md' ? markdownUnits(text) : paragraphUnits(text) };
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
// The label (place, headings, a sheet's header row) is searchable beside the
// text, so a row is found by the names of its columns.
for (const table of ['small', 'joined']) {
  database.exec(`CREATE VIRTUAL TABLE ${table} USING fts5(path, label, content, project UNINDEXED, file UNINDEXED, ordinal UNINDEXED, ${TOKENIZER})`);
}

const shape = {};
const documents = new Map();
const wholeTexts = new Map();
const chunksByTable = { small: new Map(), joined: new Map() };
for (const file of files) {
  const project = file.split('/')[0];
  const extracted = await extractedTextOf(file);
  wholeTexts.set(file, extracted);
  database.prepare('INSERT INTO whole (path, content, project, file) VALUES (?, ?, ?, ?)').run(pathIn(file), extracted.slice(0, INDEXED_CHARS), project, file);
  const document = await documentOf(file);
  documents.set(file, document);
  for (const [table, joinSections] of [['small', false], ['joined', true]]) {
    const chunks = chunksOf(document, joinSections);
    chunksByTable[table].set(file, chunks);
    const insert = database.prepare(`INSERT INTO ${table} (path, label, content, project, file, ordinal) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const chunk of chunks) insert.run(pathIn(file), passageSearchLabel(chunk), chunk.text, project, file, chunk.ordinal);
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
// Each takes a question and returns, per chosen file in the order it is sent,
// the text the file contributes.

// Path and label count for more than the text, as the path does today
// (`bm25(file_texts_fts, 4.0, 1.0)` in the suggest-files route).
function topChunks(table, limit) {
  const select = database.prepare(`SELECT file, ordinal FROM ${table} WHERE ${table} MATCH ? AND project = ? ORDER BY bm25(${table}, 4.0, 2.0, 1.0) LIMIT ?`);
  return (question, match) => {
    const chosen = new Map();
    for (const { file, ordinal } of select.all(match, question.project, limit)) chosen.set(file, [...(chosen.get(file) ?? []), Number(ordinal)]);
    return new Map([...chosen.entries()].map(([file, ordinals]) => {
      const chunks = chunksByTable[table].get(file);
      const selected = ordinals.map((ordinal) => chunks[ordinal]);
      return [file, { text: passagesText(documents.get(file), selected), chunks: selected }];
    }));
  };
}

const pickFiles = database.prepare('SELECT file FROM whole WHERE whole MATCH ? AND project = ? ORDER BY bm25(whole, 4.0, 1.0) LIMIT ?');

// Files as the application chooses them today. A short file is sent whole,
// as its extracted text, exactly as the chat sends it now. A long file sends
// its best passages, verbatim under their labels, with the neighbours a cut
// inside a line makes inseparable. No file can take the room of the ones
// ranked below it.
function filesThenPassages(totalChars) {
  const pickPassages = database.prepare('SELECT ordinal FROM joined WHERE joined MATCH ? AND file = ? ORDER BY bm25(joined, 4.0, 2.0, 1.0) LIMIT 40');
  return (question, match) => {
    const sent = new Map();
    for (const { file } of pickFiles.all(match, question.project, FILE_LIMIT)) {
      const whole = wholeTexts.get(file);
      const current = [...sent.entries()].map(([path, value]) => ({ path: pathIn(path), mimeType: mimeOf(path), sizeBytes: sizeOf.get(path), text: value.text }));
      const room = remainingFileContextChars(current, { path: pathIn(file), mimeType: mimeOf(file), sizeBytes: sizeOf.get(file) }, totalChars);
      if (whole.length <= WHOLE_FILE_CHARS) {
        if (!whole || whole.length > room) continue;
        sent.set(file, { text: whole, chunks: null });
        continue;
      }
      const chunks = chunksByTable.joined.get(file);
      const allowance = Math.min(PER_FILE_CHARS, room);
      const ordinals = selectPassages(documents.get(file), chunks, pickPassages.all(match, file).map(({ ordinal }) => Number(ordinal)), allowance);
      if (!ordinals.length) continue;
      const selected = ordinals.map((ordinal) => chunks[ordinal]);
      sent.set(file, { text: passagesText(documents.get(file), selected), chunks: selected });
    }
    return sent;
  };
}

const STRATEGIES = {
  'small-chunks-top6': { describe: 'Best 6 chunks of the project; a chunk starts at every heading.', pick: topChunks('small', 6) },
  'small-chunks-top12': { describe: 'Best 12 chunks of the project; a chunk starts at every heading.', pick: topChunks('small', 12) },
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
  const sent = match ? pick(question, match) : new Map();
  const message = fileContextMessage([...sent.entries()].map(([file, value]) => ({ path: pathIn(file), mimeType: mimeOf(file), sizeBytes: sizeOf.get(file), text: value.text })));

  const scored = isScored(question.kind);
  const sources = question.expected.map((source) => {
    const value = sent.get(source.file);
    const delivered = quoteDelivered(source.quote, value?.text);
    const passages = value?.chunks === null ? wholeSourceTexts(documents.get(source.file), source.locator)
      : value ? sourcePassageTexts(documents.get(source.file), value.chunks, source.locator) : [];
    const passageDelivered = delivered && passages.some((text) => quoteDelivered(source.quote, text));
    return { file: source.file, found: Boolean(value), delivered, passageDelivered };
  });
  return {
    id: question.id,
    kind: question.kind,
    lang: question.lang,
    tags: question.tags,
    files: sent.size,
    // Characters of the file-context message, or null when nothing is sent.
    chars: sent.size ? message.length : null,
    sources,
    // A question with no expected source is not scored.
    complete: scored ? sources.every((source) => source.found) : null,
    delivered: scored ? sources.every((source) => source.delivered) : null,
    passageDelivered: scored ? sources.every((source) => source.passageDelivered) : null,
  };
}

// The simulation knows whether a file was chosen, not its place in a list, so
// a chosen file counts as rank 1 for the shared totals and `firstRank` is
// left out.
function total(results) {
  const { n, complete, found, delivered } = totalOf(results.map((result) => ({ ranks: result.sources.map((source) => (source.found ? 1 : null)), delivered: result.sources.map((source) => source.delivered) })));
  return { n, complete, found, delivered, passageDelivered: mean(results.map((result) => (result.passageDelivered ? 1 : 0))) };
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
    deliveredWithoutPassage: scored.filter((result) => result.delivered && !result.passageDelivered).map((result) => result.id),
    questions: results.map(({ id, kind, files: fileCount, chars, complete, delivered, passageDelivered, sources }) => ({ id, kind, files: fileCount, chars, complete, delivered, passageDelivered, sources })),
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
  rule: { ...CHUNK_RULE, fileLimit: FILE_LIMIT, wholeFileChars: WHOLE_FILE_CHARS, perFileChars: PER_FILE_CHARS, weights: { path: 4, label: 2, text: 1 } },
  corpus: { files: files.length, ...shape },
  strategies,
};
writeFileSync(join(SET, 'simulation.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

console.log(`${files.length} files. Small chunks: ${shape.small.chunks}, mean ${shape.small.meanChars} characters, longest ${shape.small.longest}. Joined chunks: ${shape.joined.chunks}, mean ${shape.joined.meanChars} characters, longest ${shape.joined.longest}.`);
const row = (name, scored, context, noAnswer, missed) => console.log(
  `${name.padEnd(26)} n=${scored.n} found ${String(Math.round(scored.complete * scored.n)).padStart(2)} delivered ${String(Math.round(scored.delivered * scored.n)).padStart(2)}  mean ${String(context.meanChars).padStart(6)} max ${String(context.maxChars).padStart(6)}  no-answer n=${noAnswer.n}: ${noAnswer.withContext} with context, mean ${String(noAnswer.meanChars).padStart(6)} (${String(noAnswer.meanCharsWhenSent).padStart(6)} when sent)${missed ? `  missed: ${missed}` : ''}`,
);
if (measured) {
  console.log(`Fidelity (files only): the simulated choice of files matches the application's suggestions, file for file and in order, for ${fidelity.sameFilesInSameOrder} of ${fidelity.questions} questions${fidelity.differing.length ? ` (differs: ${fidelity.differing.join(', ')})` : ''}.`);
  const { scored, context } = measured.totals;
  const missed = measured.questions.filter((result) => isScored(result.kind) && !result.delivered).map((result) => result.id).join(', ');
  row('baseline (measured)', scored, context.scored, context.noAnswer, missed);
}
for (const [name, strategy] of Object.entries(strategies)) row(name, strategy.scored, strategy.context.scored, strategy.context.noAnswer, strategy.notDelivered.join(', '));
console.log(`Written to eval/context/sets/${setName}/simulation.json`);
