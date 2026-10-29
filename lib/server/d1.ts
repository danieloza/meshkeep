import 'server-only';

// D1 accepts at most 100 bound parameters per statement, and a batch applies
// that limit to every statement inside it. Lists that go into `IN (...)` are
// split into chunks below it, leaving room for the other conditions.
export const D1_IN_CHUNK = 90;

export function inChunks<T>(items: T[], size = D1_IN_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}
