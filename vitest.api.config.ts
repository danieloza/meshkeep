import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Osobny config dla testow autoryzacji. Nie mieszamy ich z `npm test`, bo tamte
// chodza w 0,6 sekundy i sluza do szybkiej petli, a te buduja aplikacje i
// podnosza workera - kilkadziesiat sekund. Trzymanie ich razem zamienilo by
// szybki zestaw w wolny, wiec przestano by go uruchamiac.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/api/**/*.test.ts'],
    // Jeden worker na jednym porcie obsluguje caly plik. Rownolegle pliki
    // walczylyby o port i o stan bazy.
    fileParallelism: false,
    // Build plus start workera potrafia zajac ponad minute na zimno.
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
});
