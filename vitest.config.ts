import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Osobny config, żeby testy nie ładowały `vite.config.ts` razem z pluginem
// Cloudflare — te testy celowo pokrywają wyłącznie czystą logikę, bez Workera.
export default defineConfig({
  resolve: {
    alias: {
      // `server-only` rzuca wyjątkiem poza renderem serwerowym, a moduły
      // z `lib/server` importują go na starcie.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Testy autoryzacji buduja aplikacje i podnosza workera, wiec maja wlasny
    // config i wlasne polecenie (`npm run test:api`). Bez tego wykluczenia
    // wpadalyby tutaj i zamienily szybka petle w kilkudziesieciosekundowa.
    exclude: ['tests/api/**', 'node_modules/**', 'dist/**'],
  },
});
