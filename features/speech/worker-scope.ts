/// <reference lib="webworker" />
// vinext folds `typeof window` to "object" in every client bundle, and the
// worker bundle inherits it. transformers.js then reads `window.document` to
// tell a page from a worker, and a worker has no `window`, so it threw on load.
// Pointing `window` at the worker's own scope keeps that check honest:
// `document` is undefined here, so the library sees a worker. Imported before
// the library, so it runs first.
(globalThis as { window?: unknown }).window ??= globalThis;

export {};
