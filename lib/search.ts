// Turns what a person typed into an FTS5 query, and back from the index's
// snippets into highlighted text. Shared by the server and the browser.
//
// Nothing the user types reaches MATCH as syntax. Input is reduced to words
// made of letters and digits, and each word becomes a quoted prefix term, so
// quotes, `NEAR(`, `*`, `-` or column filters are plain text, not operators.

// Snippet markers. Control characters, because they cannot occur in the text
// the index returns, unlike brackets or HTML.
export const MARK_START = '\u0002';
export const MARK_END = '\u0003';

const MAX_TERMS = 8;
const MAX_SUGGEST_TERMS = 12;

// Dropped from file suggestions only. A question is joined with OR, so a word
// like "the" or "jak" would rank every file in the project.
const STOPWORDS = new Set([
  'about', 'all', 'and', 'any', 'are', 'can', 'could', 'does', 'explain', 'for', 'from', 'have', 'how',
  'into', 'not', 'please', 'should', 'show', 'tell', 'that', 'the', 'this', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'would', 'you', 'your',
  'albo', 'czy', 'dla', 'dlaczego', 'gdzie', 'jak', 'jaka', 'jaki', 'jakie', 'jest', 'kiedy', 'która',
  'które', 'który', 'lub', 'mam', 'może', 'możesz', 'nie', 'oraz', 'pokaż', 'powiedz', 'proszę', 'przez',
  'przy', 'się', 'tak', 'tego', 'tym', 'wyjaśnij', 'ze', 'że',
]);

export function searchTerms(input: string, minLength = 2): string[] {
  const words = input.normalize('NFKC').toLocaleLowerCase('pl').match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].filter((word) => word.length >= minLength);
}

// Polish inflects by changing word endings: "synchronizacja" in the search box
// should find "synchronizacji" in a file. A full stemmer is out of reach in
// SQLite, so longer words drop their last one or two letters and the rest is
// matched as a prefix. Short words and numbers are kept whole, where trimming
// would match almost anything.
export function stem(term: string): string {
  if (!/^\p{L}+$/u.test(term) || term.length <= 4) return term;
  return term.slice(0, term.length <= 6 ? -1 : -2);
}

// `remove_diacritics` folds ą, ć, ę, ń, ó, ś, ź and ż, but not ł: Unicode treats
// it as a letter of its own, not l with a mark. Someone typing "zolw" for
// "żółw" would find nothing, so a word with l also tries its ł spelling.
function termGroup(word: string): string {
  const term = stem(word);
  const variants = term.includes('l') ? [term, term.replaceAll('l', 'ł')] : [term];
  const quoted = variants.map((variant) => `"${variant}"*`);
  return quoted.length > 1 ? `(${quoted.join(' OR ')})` : quoted[0];
}

// Search box: every word must match.
export function buildMatchQuery(input: string): string | null {
  const terms = searchTerms(input).slice(0, MAX_TERMS);
  return terms.length ? terms.map(termGroup).join(' AND ') : null;
}

// File suggestions for a question: any meaningful word may match, and the
// ranking decides. Requiring every word of a whole sentence would rarely find
// anything.
export function buildSuggestQuery(input: string): string | null {
  const terms = searchTerms(input, 3).filter((term) => !STOPWORDS.has(term)).slice(0, MAX_SUGGEST_TERMS);
  return terms.length ? terms.map(termGroup).join(' OR ') : null;
}

export type SnippetPart = { text: string; hit: boolean };

export function splitHighlights(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  for (const [index, chunk] of snippet.split(MARK_START).entries()) {
    if (index === 0) {
      if (chunk) parts.push({ text: chunk, hit: false });
      continue;
    }
    const end = chunk.indexOf(MARK_END);
    if (end === -1) {
      if (chunk) parts.push({ text: chunk, hit: false });
      continue;
    }
    if (end > 0) parts.push({ text: chunk.slice(0, end), hit: true });
    const rest = chunk.slice(end + 1);
    if (rest) parts.push({ text: rest, hit: false });
  }
  return parts;
}

export type ConversationHit = { conversationId: string; projectId: string; projectName: string; title: string; role: string; snippet: string };
export type FileHit = { fileId: string; projectId: string; projectName: string; path: string; snippet: string };
export type SearchResults = { conversations: ConversationHit[]; files: FileHit[]; unindexedFiles: number };
