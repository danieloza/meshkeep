import { describe, expect, it } from 'vitest';
import { buildMatchQuery, buildSuggestQuery, MARK_END, MARK_START, searchTerms, splitHighlights, stem } from '@/lib/search';

describe('search query building', () => {
  it('turns words into prefix terms that must all match', () => {
    expect(buildMatchQuery('sync api')).toBe('"sync"* AND "api"*');
  });

  it('never passes FTS syntax through from user input', () => {
    // Quotes, operators, column filters and NEAR are reduced to plain words.
    expect(buildMatchQuery('"drop" OR content:secret NEAR(a b) -x *')).toBe('"drop"* AND "or"* AND "conte"* AND "secre"* AND "near"*');
    expect(buildMatchQuery('***')).toBeNull();
    expect(buildMatchQuery('   ')).toBeNull();
  });

  it('also tries the ł spelling of a word typed with l', () => {
    // remove_diacritics folds ó and ż, but ł is a separate letter in Unicode.
    expect(buildMatchQuery('zolw')).toBe('("zolw"* OR "zołw"*)');
    expect(buildMatchQuery('Żółw')).toBe('"żółw"*');
  });

  it('keeps letters from any script and drops one-character noise', () => {
    expect(searchTerms('Łódź a 2026 Zürich')).toEqual(['łódź', '2026', 'zürich']);
  });

  it('suggests files from the meaningful words of a question', () => {
    expect(buildSuggestQuery('How does the sync agent run?')).toBe('"sync"* OR "agen"* OR "run"*');
    expect(buildSuggestQuery('jak to jest?')).toBeNull();
  });

  it('adds the ł spelling without guessing the language', () => {
    // An English word gains a variant that never occurs in text, which costs
    // nothing; guessing the language would cost Polish matches.
    expect(buildSuggestQuery('deleted files')).toBe('("delet"* OR "dełet"*) OR ("file"* OR "fiłe"*)');
  });
});

describe('word endings', () => {
  it('lets one form of a Polish word find the others', () => {
    // The typed form and the form in the text share the trimmed prefix.
    for (const [typed, inText] of [['synchronizacja', 'synchronizacji'], ['migracja', 'migracji'], ['kolejka', 'kolejki'], ['pliki', 'plikach'], ['pliki', 'plików']]) {
      expect(inText.startsWith(stem(typed)), `${typed} → ${inText}`).toBe(true);
    }
  });

  it('documents the limit: endings of different length do not meet', () => {
    // Trimming is not a stemmer. A long ending typed in the box can cut too
    // little; the shorter form ("pliki") finds both.
    expect('plików'.startsWith(stem('plikach'))).toBe(false);
  });

  it('keeps short words and numbers whole', () => {
    expect(stem('zolw')).toBe('zolw');
    expect(stem('2026')).toBe('2026');
    expect(stem('v2026a')).toBe('v2026a');
  });
});

describe('snippet highlights', () => {
  it('splits marked hits from the surrounding text', () => {
    expect(splitHighlights(`a ${MARK_START}hit${MARK_END} b ${MARK_START}two${MARK_END}`)).toEqual([
      { text: 'a ', hit: false },
      { text: 'hit', hit: true },
      { text: ' b ', hit: false },
      { text: 'two', hit: true },
    ]);
  });

  it('treats an unmatched marker as plain text instead of losing it', () => {
    expect(splitHighlights(`x${MARK_START}y`)).toEqual([{ text: 'x', hit: false }, { text: 'y', hit: false }]);
    expect(splitHighlights('')).toEqual([]);
  });
});
