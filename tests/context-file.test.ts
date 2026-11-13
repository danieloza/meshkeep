import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { FILES: { get: mock.get } } }));
vi.mock('@/lib/server/file-text', () => ({
  jestZwyklymTekstem: () => false,
  MAX_CONTEXT_FILE_BYTES: 300_000,
  MAX_DOCUMENT_BYTES: 8_000_000,
  rozszerzeniePliku: () => 'pdf',
  trescPliku: vi.fn(),
}));

import { readContextDocument } from '@/lib/server/context-file';

// A genuine minimal PDF with one distinct text item on each page, built in
// memory so the reader and PDF parser both run on the 40/41-page boundary.
function pdfWithPages(count: number): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  const pageIds = Array.from({ length: count }, (_, i) => 4 + i * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${count} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pageIds.forEach((id, index) => {
    const stream = `BT /F1 12 Tf 40 700 Td (Page ${index + 1} marker) Tj ET`;
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  });
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i < objects.length; i += 1) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

describe('PDF passage page budget', () => {
  it('indexes only 40 pages and marks a 41-page PDF as partial', async () => {
    const bytes = pdfWithPages(41);
    mock.get.mockResolvedValue({ arrayBuffer: async () => bytes.buffer });
    const result = await readContextDocument({ id: 'f', projectId: 'p', relativePath: 'long.pdf', sha256: 'sha', name: 'long.pdf', objectKey: 'key', sizeBytes: bytes.length });
    expect(result.failed).toBe(false);
    expect(result.reason).toContain('Only the beginning');
    expect(result.document?.text).toContain('Page 40 marker');
    expect(result.document?.text).not.toContain('Page 41 marker');
    expect(result.document?.units.some((unit) => unit.place === 'page 40')).toBe(true);
    expect(result.document?.units.some((unit) => unit.place === 'page 41')).toBe(false);
  });
});
