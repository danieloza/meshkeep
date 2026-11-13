import { describe, expect, it } from 'vitest';
import { buildContextChunks, contextDocument, limitContextText, limitPdfPages, MAX_FILE_CHUNKS } from '@/lib/context-document';

const file = { id: 'file-a', projectId: 'project-a', relativePath: 'docs/test.md', sha256: 'a'.repeat(64) };

describe('context documents', () => {
  it('keeps source slices and exact heading labels through a long cut', async () => {
    const source = '# Contract\n\n## Charges\n\n' + 'x'.repeat(1_495) + 'ABCDEF1234' + 'y'.repeat(5_500);
    const document = contextDocument('md', source);
    const { rows, truncated } = await buildContextChunks(file, document);
    expect(truncated).toBe(false);
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      expect(row.content).toBe(document.text.slice(row.startChar, row.endChar));
      expect(row.projectId).toBe(file.projectId);
      expect(row.chunkKey).toMatch(/^[0-9a-f]{20}$/);
    }
    expect(rows.some((row) => row.heading === 'Contract › Charges')).toBe(true);
  });

  it('requires real PDF page boundaries and labels each page', async () => {
    expect(() => contextDocument('pdf', 'merged')).toThrow(/pages/);
    const document = contextDocument('pdf', 'ignored', ['First page.', '', 'Third page.']);
    const { rows } = await buildContextChunks(file, document);
    expect(rows.map((row) => row.place)).toEqual(['page 1', 'page 3']);
    expect(rows[1].label).toBe('[page 3]');
  });

  it('limits PDF text without losing page numbering or splitting Unicode', () => {
    const result = limitPdfPages(['abc', '', 'xy😀z', 'later'], 7);
    expect(result.truncated).toBe(true);
    expect(result.pages).toEqual(['abc', '', 'xy', '']);
    const document = contextDocument('pdf', '', result.pages);
    expect(document.text).toBe('abc\n\nxy');
    expect(document.units.map((unit) => unit.place)).toEqual(['page 1', 'page 3']);
    expect(limitPdfPages(['abc', '😀more', 'later'], 6).pages).toEqual(['abc', '', '']);
  });

  it('bounds extracted text at a Unicode boundary before creating units', () => {
    const result = limitContextText('x'.repeat(119_999) + '😀tail');
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(119_999);
    expect(contextDocument('txt', result.text).text).toBe(result.text);
  });

  it('gives identical bytes the same stamp but different file addresses', async () => {
    const document = contextDocument('txt', 'identical text');
    const a = (await buildContextChunks(file, document)).rows[0];
    const b = (await buildContextChunks({ ...file, id: 'file-b', relativePath: 'copy.txt' }, document)).rows[0];
    const changed = (await buildContextChunks({ ...file, sha256: 'b'.repeat(64) }, document)).rows[0];
    expect(a.chunkKey).toBe(b.chunkKey);
    expect(a.fileId).not.toBe(b.fileId);
    expect(a.chunkKey).not.toBe(changed.chunkKey);
  });

  it('reports the chunk limit rather than hiding truncation', async () => {
    const text = Array.from({ length: MAX_FILE_CHUNKS + 2 }, (_, index) => `# Section ${index}\n\n${'x'.repeat(1_000)}`).join('\n\n');
    const result = await buildContextChunks(file, contextDocument('md', text));
    expect(result.rows).toHaveLength(MAX_FILE_CHUNKS);
    expect(result.truncated).toBe(true);
  });
});
