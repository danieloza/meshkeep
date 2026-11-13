// The format of an evaluation set for context retrieval. A set is a directory
// under `eval/context/sets/` with `team.json`, `projects.json`, `corpus/` and
// `questions.json`; the runner adds `baseline.json`. How results are counted
// is in `measure.ts`.
//
// Only erasable TypeScript here: `scripts/eval-context.mjs` imports this file
// straight from Node.

import { z } from 'zod';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

// --- team.json ---------------------------------------------------------------

export const team = z.object({
  members: z.array(z.object({
    id: slug,
    name: z.string().min(1),
    role: z.enum(['owner', 'member']),
  })).min(2),
}).refine((value) => value.members.filter((member) => member.role === 'owner').length === 1, 'A team has exactly one owner.');
export type Team = z.infer<typeof team>;

// --- projects.json -----------------------------------------------------------

export const project = z.object({
  id: slug,
  name: z.string().min(1),
  owner: slug,
  visibility: z.enum(['private', 'selected', 'team']),
  // People the project is shared with by name, besides its owner.
  members: z.array(z.object({ id: slug, role: z.enum(['editor', 'reader']) })),
});
export type Project = z.infer<typeof project>;

export const projects = z.object({ projects: z.array(project).min(1) });
export type Projects = z.infer<typeof projects>;

// The read rule of `lib/server/access.ts` (`readableBy`), restated over the
// set's own files. It only decides how questions are written; whether the
// application really refuses is measured through its API by the runner.
export function canRead(target: Project, memberId: string): boolean {
  return target.owner === memberId || target.visibility === 'team' || target.members.some((member) => member.id === memberId);
}

// Asking means sending a chat message, and the chat needs edit access to the
// project (`requireProjectAccess(…, 'edit')` in `app/api/chat/route.ts`): its
// owner, or someone it is shared with as an editor. A reader, and a member who
// sees a team project without being named in it, can search but not ask. So a
// set measures what people who can ask get; what a reader finds through
// search alone is not measured here.
export function canAsk(target: Project, memberId: string): boolean {
  return target.owner === memberId || target.members.some((member) => member.id === memberId && member.role === 'editor');
}

// --- questions.json ----------------------------------------------------------

export const KINDS = ['answerable', 'multi-file', 'no-answer', 'access'] as const;
export type Kind = (typeof KINDS)[number];

// What makes a question hard for retrieval. A question can carry several.
//   inflection      the question uses another grammatical form than the file
//   diacritics      Polish typed without diacritics (also `l` for `ł`)
//   synonym         the question and the file use different words
//   cross-language  the question is in one language, the file in the other
//   deep            the answer sits far into a long file
//   table           the answer is a row of a table or a spreadsheet
//   exact           the question names an identifier that appears verbatim
//   scan            the answer exists only in a file with no text layer
export const TAGS = ['inflection', 'diacritics', 'synonym', 'cross-language', 'deep', 'table', 'exact', 'scan'] as const;
export type Tag = (typeof TAGS)[number];

// `<project>/<path inside the project>`, as the file sits under `corpus/`.
const corpusFile = z.string().regex(/^[a-z0-9-]+\/[^\\]+$/);

// Where in the file the quote is. A claim of its own, apart from the quote:
// the test proves `page` for PDF, `sheet` for XLSX and `heading` for Markdown.
export const locator = z.union([
  z.object({ page: z.number().int().min(1) }).strict(),
  z.object({ sheet: z.number().int().min(1) }).strict(),
  z.object({ heading: z.string().min(1) }).strict(),
]);
export type Locator = z.infer<typeof locator>;

export const expectedSource = z.object({
  file: corpusFile,
  // Found in the file's text as MeshKeep's own extractors produce it, once
  // every run of whitespace on both sides is collapsed to one space
  // (`normalizeText` in `measure.ts`). Containment after normalizing, not a
  // byte-for-byte quotation.
  quote: z.string().min(3),
  locator: locator.optional(),
});
export type ExpectedSource = z.infer<typeof expectedSource>;

// A file that holds the answer but sits in a project the asker cannot open,
// with a search phrase that finds this file for the owner of its project. The
// runner sends the phrase as both people: the asker's empty result counts as
// a refusal only when the same phrase does find the file for its owner.
export const forbiddenSource = z.object({
  file: corpusFile,
  probe: z.string().min(3),
});
export type ForbiddenSource = z.infer<typeof forbiddenSource>;

export const question = z.object({
  id: z.string().regex(/^(pl|en)-[a-z]?\d{2,3}$/),
  lang: z.enum(['pl', 'en']),
  kind: z.enum(KINDS),
  // A member id from `team.json`: who asks.
  asker: slug,
  // The project the asker has open. Suggestions are made inside it.
  project: slug,
  question: z.string().min(12).max(500),
  // Every file the full answer needs.
  expected: z.array(expectedSource).default([]),
  // `no-answer`: files on the topic that do not hold the answer. Retrieving
  // them is not an error.
  related: z.array(corpusFile).default([]),
  // `access`: every file that holds the answer and is closed to the asker.
  forbidden: z.array(forbiddenSource).default([]),
  tags: z.array(z.enum(TAGS)).default([]),
}).superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: 'custom', message: `${value.id}: ${message}` });
  const files = new Set(value.expected.map((source) => source.file));
  if (!value.id.startsWith(`${value.lang}-`)) fail('the id starts with the language.');
  if (value.kind === 'answerable' && files.size !== 1) fail('an answerable question names exactly one file.');
  if (value.kind === 'multi-file' && files.size < 2) fail('a multi-file question names at least two files.');
  if ((value.kind === 'no-answer' || value.kind === 'access') && value.expected.length) fail('this kind has no expected sources.');
  if (value.kind === 'access' && !value.forbidden.length) fail('an access question names its forbidden files.');
  if (value.kind !== 'access' && value.forbidden.length) fail('only access questions have forbidden files.');
  if (value.kind !== 'no-answer' && value.related.length) fail('only no-answer questions have related files.');
  for (const file of [...files, ...value.related]) {
    if (!file.startsWith(`${value.project}/`)) fail(`${file} is not in the project the question is asked in.`);
  }
  for (const { file } of value.forbidden) {
    if (file.startsWith(`${value.project}/`)) fail(`${file} is in the asker's own project, so it cannot be forbidden.`);
  }
  if (new Set(value.forbidden.map((source) => source.file)).size !== value.forbidden.length) fail('a forbidden file is listed once.');
});
export type Question = z.infer<typeof question>;

export const questionSet = z.object({
  version: z.literal(1),
  set: slug,
  questions: z.array(question).min(1),
}).refine((value) => new Set(value.questions.map((item) => item.id)).size === value.questions.length, 'Question ids are unique.');
export type QuestionSet = z.infer<typeof questionSet>;

// --- baseline.json -----------------------------------------------------------

const suggestion = z.object({ rank: z.number().int().min(1), file: corpusFile });

// What the application did with one expected source.
const sourceOutcome = z.object({
  file: corpusFile,
  // Position among the suggestions, or null when the file was not suggested.
  rank: z.number().int().min(1).nullable(),
  // How the chat reported the file in its answer's manifest, or null when the
  // file was not sent at all.
  manifest: z.enum(['included', 'truncated', 'unreadable', 'skipped']).nullable(),
  // Whether the quote was in the text that this file itself contributed to
  // what the model provider received.
  delivered: z.boolean(),
});

// What one forbidden file shows; see `accessOutcome` in `measure.ts`.
const forbiddenOutcome = z.object({
  file: corpusFile,
  // HTTP status of `suggest-files` asked by the asker on the file's project.
  routeStatus: z.number().int(),
  probe: z.string(),
  // The probe, searched across all projects, finds this file for the owner of
  // its project, and for the asker.
  ownerFound: z.boolean(),
  askerFound: z.boolean(),
  outcome: z.enum(['refused', 'leaked', 'inconclusive']),
});

export const questionResult = z.object({
  id: z.string(),
  lang: z.enum(['pl', 'en']),
  kind: z.enum(KINDS),
  tags: z.array(z.enum(TAGS)),
  suggestions: z.array(suggestion),
  // What the chat message carrying the suggested files sent to the provider:
  // the size of the whole file-context message in characters, and how many
  // files the chat reported in each state. Null when no message was sent:
  // nothing was suggested, or the question is an access question.
  context: z.object({
    chars: z.number().int(),
    included: z.number().int(),
    truncated: z.number().int(),
    unreadable: z.number().int(),
    skipped: z.number().int(),
  }).nullable(),
  sources: z.array(sourceOutcome),
  // Scored questions only (`answerable`, `multi-file`): every expected file
  // was suggested, and every expected quote reached the provider from its own
  // file. Null for the kinds that are not scored.
  complete: z.boolean().nullable(),
  delivered: z.boolean().nullable(),
  // `no-answer`: which suggestions were listed as related.
  related: z.array(corpusFile).optional(),
  // `access`: one entry per forbidden file.
  access: z.array(forbiddenOutcome).optional(),
});
export type QuestionResult = z.infer<typeof questionResult>;

// Shares are fractions from 0 to 1. `n` stands next to every one of them: with
// five questions, one question is twenty percentage points.
const total = z.object({
  n: z.number().int(),
  // Questions where every expected file was suggested.
  complete: z.number(),
  // Mean share of a question's expected files that were suggested.
  found: z.number(),
  // Mean rank of the first expected file, over questions where one was found.
  firstRank: z.number().nullable(),
  // Questions where every expected quote reached the model provider.
  delivered: z.number(),
});
export type Total = z.infer<typeof total>;

// What a group of questions cost in context; see `contextTotal` in
// `measure.ts` for the two means and their denominators.
const contextTotal = z.object({
  n: z.number().int(),
  withContext: z.number().int(),
  meanChars: z.number().int(),
  meanCharsWhenSent: z.number().int(),
  maxChars: z.number().int(),
  // Mean number of files sent with a message, over the messages sent.
  meanFiles: z.number(),
  // Files over all messages, by what the chat reported for them.
  included: z.number().int(),
  truncated: z.number().int(),
  unreadable: z.number().int(),
  skipped: z.number().int(),
});

export const baseline = z.object({
  version: z.literal(1),
  set: slug,
  // What the run met, so a later reader can tell what the numbers describe.
  observed: z.object({
    // The most files any one question was offered.
    mostSuggestions: z.number().int(),
    files: z.number().int(),
    // Files per text state after indexing, as the files API reports it.
    fileText: z.record(z.string(), z.number().int()),
  }),
  totals: z.object({
    // Scored questions: `answerable` and `multi-file`.
    scored: total,
    byKind: z.record(z.string(), total),
    byLang: z.record(z.string(), total),
    byTag: z.record(z.string(), total),
    context: z.object({ scored: contextTotal, noAnswer: contextTotal }),
    // Not scored for retrieval: reported for what they are.
    noAnswer: z.object({ n: z.number().int(), withSuggestions: z.number().int(), onlyRelated: z.number().int() }),
    // Questions, then the forbidden files behind them. A question counts as
    // refused only when every one of its files is.
    access: z.object({
      n: z.number().int(),
      refused: z.number().int(),
      files: z.number().int(),
      filesRefused: z.number().int(),
      filesInconclusive: z.number().int(),
      filesLeaked: z.number().int(),
    }),
  }),
  questions: z.array(questionResult),
});
export type Baseline = z.infer<typeof baseline>;
