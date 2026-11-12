import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { normalizeText } from '@/eval/context/measure';
import { baseline, canAsk, canRead, projects, questionSet, team, type ExpectedSource, type Projects, type QuestionSet, type Team } from '@/eval/context/schema';
import { ROZSZERZENIA_DOKUMENTOW, wydobadzTekstDokumentu } from '@/lib/document-text';
import { wydobadzTekstPdf } from '@/lib/server/pdf-text';

// Keeps the evaluation sets for context retrieval honest. A set is only worth
// measuring against when every expected quote really is in its file, every
// page number is proven, and every "forbidden" file really is out of the
// asker's reach. Whether the application then finds or refuses those files is
// measured through its API by `npm run eval:context`, not here.

const SETS = fileURLToPath(new URL('../eval/context/sets/', import.meta.url));
// The chat sends at most this many characters of file text with a message
// (`MAX_ATTACHMENT_CONTEXT_CHARS` in `app/api/chat/route.ts`).
const CHAT_FILE_BUDGET = 80_000;
const MAX_CORPUS_BYTES = 3_000_000;

function bytesOf(path: string): Uint8Array<ArrayBuffer> {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

function extensionOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

// The text of a corpus file, through the same extractors the application
// uses. `lib/server/file-text.ts` cannot be imported here, because it reads
// from R2; it routes plain text, PDF and office documents exactly like this.
const textCache = new Map<string, Promise<string>>();
function textOf(set: string, file: string): Promise<string> {
  const path = join(SETS, set, 'corpus', file);
  let text = textCache.get(path);
  if (!text) {
    const extension = extensionOf(file);
    if (extension === 'pdf') text = wydobadzTekstPdf(bytesOf(path)).then((result) => result.tekst);
    else if (ROZSZERZENIA_DOKUMENTOW.has(extension)) text = wydobadzTekstDokumentu(extension, bytesOf(path)).then((result) => result.tekst);
    else if (extension === 'md' || extension === 'txt') text = Promise.resolve(new TextDecoder().decode(bytesOf(path)).replaceAll('\0', ''));
    else throw new Error(`${file}: the evaluation corpus uses only txt, md, pdf, docx, xlsx, pptx and rtf.`);
    textCache.set(path, text);
  }
  return text;
}

// One page of a PDF on its own. The application merges the pages
// (`mergePages: true` in `lib/server/pdf-text.ts`), which loses the page
// boundaries, so a page number is checked here against the page itself.
async function pdfPages(set: string, file: string): Promise<string[]> {
  const document = await getDocumentProxy(bytesOf(join(SETS, set, 'corpus', file)));
  const { text } = await extractText(document, { mergePages: false });
  return text;
}

// The part of an extracted spreadsheet that belongs to one sheet. The
// extractor writes `# sheetN.xml` above each.
function sheetText(text: string, sheet: number): string {
  const parts = text.split(/^# sheet(\d+)\.xml$/m);
  const index = parts.indexOf(String(sheet));
  return index >= 0 ? parts[index + 1] ?? '' : '';
}

// The part of a Markdown file under one heading, up to the next heading.
function headingText(text: string, heading: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#{1,6} /, '').trim() === heading);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6} /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

async function locatorProblem(set: string, source: ExpectedSource): Promise<string | null> {
  if (!source.locator) return null;
  const extension = extensionOf(source.file);
  const quote = normalizeText(source.quote);
  if ('page' in source.locator) {
    if (extension !== 'pdf') return 'a page is given for a file that is not a PDF';
    const pages = await pdfPages(set, source.file);
    const page = pages[source.locator.page - 1];
    if (page === undefined) return `the PDF has ${pages.length} pages`;
    return normalizeText(page).includes(quote) ? null : `the quote is not on page ${source.locator.page}`;
  }
  if ('sheet' in source.locator) {
    if (extension !== 'xlsx') return 'a sheet is given for a file that is not a spreadsheet';
    return normalizeText(sheetText(await textOf(set, source.file), source.locator.sheet)).includes(quote) ? null : `the quote is not on sheet ${source.locator.sheet}`;
  }
  if (extension !== 'md') return 'a heading is given for a file that is not Markdown';
  return normalizeText(headingText(await textOf(set, source.file), source.locator.heading)).includes(quote) ? null : `the quote is not under "${source.locator.heading}"`;
}

function corpusFiles(set: string): string[] {
  const root = join(SETS, set, 'corpus');
  const walk = (directory: string): string[] => readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path) : [path];
  });
  return walk('').sort();
}

type LoadedSet = { name: string; team: Team; projects: Projects; questions: QuestionSet; files: string[] };

function load(name: string): LoadedSet {
  const read = (file: string) => JSON.parse(readFileSync(join(SETS, name, file), 'utf8')) as unknown;
  return {
    name,
    team: team.parse(read('team.json')),
    projects: projects.parse(read('projects.json')),
    questions: questionSet.parse(read('questions.json')),
    files: corpusFiles(name),
  };
}

const setNames = readdirSync(SETS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

describe('evaluation sets for context', () => {
  it('the dev set exists', () => {
    expect(setNames).toContain('dev');
  });

  describe.each(setNames)('set %s', (name) => {
    const set = load(name);
    const projectOf = (file: string) => set.projects.projects.find((project) => file.startsWith(`${project.id}/`));
    const memberIds = new Set(set.team.members.map((member) => member.id));

    it('names itself, and its people and projects refer to each other', () => {
      expect(set.questions.set).toBe(name);
      for (const project of set.projects.projects) {
        expect(memberIds, `${project.id}: owner`).toContain(project.owner);
        for (const member of project.members) expect(memberIds, `${project.id}: member`).toContain(member.id);
      }
      // Every file sits in a project directory, or nothing could own it.
      for (const file of set.files) expect(projectOf(file), file).toBeDefined();
    });

    it('every question is asked by a member who can chat in the project, about files that exist', () => {
      for (const question of set.questions.questions) {
        expect(memberIds, question.id).toContain(question.asker);
        const project = set.projects.projects.find((candidate) => candidate.id === question.project);
        expect(project, `${question.id}: project`).toBeDefined();
        expect(canAsk(project!, question.asker), `${question.id}: the asker can send a chat message in the project`).toBe(true);
        const named = [...question.expected.map((source) => source.file), ...question.related, ...question.forbidden.map((source) => source.file)];
        for (const file of named) expect(set.files, `${question.id}: ${file}`).toContain(file);
      }
    });

    it('holds its text files with LF line endings, whatever the checkout', () => {
      // The corpus is uploaded byte for byte, so its bytes are part of the
      // result. `eval/context/.gitattributes` keeps Git from turning LF into
      // CRLF on Windows; a checkout made before that file existed, or an
      // editor that saved CRLF, is caught here.
      const withCarriageReturn = set.files
        .filter((file) => ['md', 'txt'].includes(extensionOf(file)))
        .filter((file) => readFileSync(join(SETS, name, 'corpus', file)).includes(0x0d));
      expect(withCarriageReturn).toEqual([]);
    });

    it('every expected quote is in the text of its file', async () => {
      const missing: string[] = [];
      for (const question of set.questions.questions) {
        for (const source of question.expected) {
          const text = normalizeText(await textOf(name, source.file));
          if (!text.includes(normalizeText(source.quote))) missing.push(`${question.id}: "${source.quote}" is not in ${source.file}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it('every locator is proven: the page, the sheet or the heading holds the quote', async () => {
      const problems: string[] = [];
      for (const question of set.questions.questions) {
        for (const source of question.expected) {
          const problem = await locatorProblem(name, source);
          if (problem) problems.push(`${question.id}: ${source.file}: ${problem}`);
        }
      }
      expect(problems).toEqual([]);
    });

    it('forbidden files are out of the asker\'s reach and within their owner\'s', () => {
      for (const question of set.questions.questions.filter((item) => item.kind === 'access')) {
        for (const { file } of question.forbidden) {
          const project = projectOf(file)!;
          expect(canRead(project, question.asker), `${question.id}: ${file} must be closed to ${question.asker}`).toBe(false);
          expect(canRead(project, project.owner)).toBe(true);
        }
      }
    });

    it('every probe names words that are in its forbidden file', async () => {
      // Search asks for every word of the phrase, so a probe with a word the
      // file does not have could never find it, for anyone. Whether the
      // application then finds it for the owner is the runner's control.
      const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ł', 'l').toLowerCase();
      const problems: string[] = [];
      for (const question of set.questions.questions) {
        for (const { file, probe } of question.forbidden) {
          const text = fold(`${file} ${await textOf(name, file)}`);
          for (const word of fold(probe).split(/\s+/)) {
            // The first letters are enough: search matches words by their stem.
            if (!text.includes(word.slice(0, Math.max(4, word.length - 2)))) problems.push(`${question.id}: "${word}" of the probe is not in ${file}`);
          }
        }
      }
      expect(problems).toEqual([]);
    });

    it('a file tagged as a scan has no text, and an answer tagged as deep lies past the chat budget', async () => {
      for (const question of set.questions.questions) {
        if (question.tags.includes('scan')) {
          const texts = await Promise.all(question.related.map((file) => textOf(name, file)));
          expect(texts.some((text) => text === ''), `${question.id}: one related file is a scan`).toBe(true);
        }
        if (question.tags.includes('deep')) {
          const depths = await Promise.all(question.expected.map(async (source) => normalizeText(await textOf(name, source.file)).indexOf(normalizeText(source.quote))));
          expect(Math.max(...depths), `${question.id}: depth of the answer`).toBeGreaterThan(CHAT_FILE_BUDGET);
        }
      }
    });

    it('its baseline, when measured, covers exactly its questions', () => {
      const path = join(SETS, name, 'baseline.json');
      if (!existsSync(path)) return;
      const measured = baseline.parse(JSON.parse(readFileSync(path, 'utf8')));
      expect(measured.set).toBe(name);
      expect(measured.questions.map((result) => result.id)).toEqual(set.questions.questions.map((question) => question.id));
      const scored = set.questions.questions.filter((question) => question.kind === 'answerable' || question.kind === 'multi-file');
      expect(measured.totals.scored.n).toBe(scored.length);
      expect(measured.observed.files).toBe(set.files.length);

      // Scored questions carry a verdict, the others carry none.
      for (const result of measured.questions) {
        const isScored = result.kind === 'answerable' || result.kind === 'multi-file';
        expect(result.complete === null, `${result.id}: complete`).toBe(!isScored);
        expect(result.delivered === null, `${result.id}: delivered`).toBe(!isScored);
      }
      // Every forbidden file has its own control, and the totals count files.
      const forbidden = set.questions.questions.flatMap((question) => question.forbidden.map((source) => source.file));
      expect(measured.questions.flatMap((result) => (result.access ?? []).map((entry) => entry.file))).toEqual(forbidden);
      const { access, context } = measured.totals;
      expect(access.files).toBe(forbidden.length);
      expect(access.filesRefused + access.filesInconclusive + access.filesLeaked).toBe(access.files);
      // Context sizes count every question of the group, with or without context.
      expect(context.scored.n).toBe(scored.length);
      expect(context.noAnswer.n).toBe(set.questions.questions.filter((question) => question.kind === 'no-answer').length);
    });
  });

  describe('the dev set', () => {
    const set = load('dev');
    const questions = set.questions.questions;
    const count = (test: (question: (typeof questions)[number]) => boolean) => questions.filter(test).length;

    it('is large and varied enough to be a first point of reference', () => {
      expect(questions.length).toBeGreaterThanOrEqual(40);
      expect(count((question) => question.lang === 'pl')).toBeGreaterThanOrEqual(questions.length / 2);
      expect(count((question) => question.kind === 'no-answer')).toBeGreaterThanOrEqual(5);
      expect(count((question) => question.kind === 'access')).toBeGreaterThanOrEqual(5);
      expect(count((question) => question.kind === 'multi-file')).toBeGreaterThanOrEqual(5);
      expect(count((question) => question.lang === 'pl' && (question.tags.includes('inflection') || question.tags.includes('diacritics')))).toBeGreaterThanOrEqual(5);
    });

    it('covers the file types, one scan, one long file, and every visibility', async () => {
      const extensions = new Set(set.files.map(extensionOf));
      for (const extension of ['txt', 'md', 'pdf', 'docx', 'xlsx']) expect(extensions, extension).toContain(extension);

      const pdfs = set.files.filter((file) => extensionOf(file) === 'pdf');
      const pdfTexts = await Promise.all(pdfs.map((file) => textOf('dev', file)));
      expect(pdfTexts.filter((text) => text === '').length, 'scans').toBe(1);
      const pageCounts = await Promise.all(pdfs.map(async (file) => (await pdfPages('dev', file)).length));
      expect(Math.max(...pageCounts), 'a PDF with several pages').toBeGreaterThan(1);

      const lengths = await Promise.all(set.files.map(async (file) => (await textOf('dev', file)).length));
      expect(Math.max(...lengths), 'a file longer than the chat budget').toBeGreaterThan(CHAT_FILE_BUDGET);

      expect(new Set(set.projects.projects.map((project) => project.visibility))).toEqual(new Set(['private', 'selected', 'team']));

      const bytes = set.files.reduce((sum, file) => sum + statSync(join(SETS, 'dev', 'corpus', file)).size, 0);
      expect(bytes).toBeLessThanOrEqual(MAX_CORPUS_BYTES);
    });

    it('has a measured baseline', () => {
      expect(existsSync(join(SETS, 'dev', 'baseline.json'))).toBe(true);
    });
  });
});
