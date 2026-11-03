/// <reference lib="webworker" />
/// <reference types="vite/client" />
// Whisper, off the main thread, so a long transcription never freezes the
// page. It runs on the CPU through ONNX Runtime's plain WebAssembly build,
// served by MeshKeep itself: the WebGPU builds are over 25 MB, the limit for
// one static file on Cloudflare, and the library's default is to fetch them
// from a public CDN that the content security policy does not allow. Only
// the model weights come from Hugging Face, once, into the browser's cache.

import './worker-scope';
import { env, pipeline } from '@huggingface/transformers';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { SPEECH_MODELS, type SpeechLanguage, type SpeechModel } from '@/lib/speech';

export type WorkerRequest =
  | { type: 'load'; model: SpeechModel }
  | { type: 'transcribe'; id: number; model: SpeechModel; language: SpeechLanguage; audio: Float32Array };

export type WorkerResponse =
  | { type: 'progress'; model: SpeechModel; file: string; loaded: number; total: number }
  | { type: 'ready'; model: SpeechModel }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

env.allowLocalModels = false;
// The cache would hand the runtime's loader to ONNX as a blob: URL, which the
// content security policy does not allow for scripts.
env.useWasmCache = false;
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
// Threads need cross-origin isolation, which MeshKeep does not turn on.
wasm.numThreads = 1;

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | Array<{ text: string }>>;
const loaded = new Map<SpeechModel, Promise<Transcriber>>();

const post = (message: WorkerResponse) => self.postMessage(message);

function load(model: SpeechModel): Promise<Transcriber> {
  let pending = loaded.get(model);
  if (!pending) {
    pending = pipeline('automatic-speech-recognition', SPEECH_MODELS[model].repo, {
      device: 'wasm',
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      progress_callback: (event: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (event.status === 'progress' && event.file) post({ type: 'progress', model, file: event.file, loaded: event.loaded ?? 0, total: event.total ?? 0 });
      },
    }) as unknown as Promise<Transcriber>;
    // A failed download is not remembered, so the next press tries again.
    pending.catch(() => loaded.delete(model));
    loaded.set(model, pending);
  }
  return pending;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const transcriber = await load(request.model);
    if (request.type === 'load') { post({ type: 'ready', model: request.model }); return; }
    const output = await transcriber(request.audio, {
      language: request.language === 'auto' ? null : request.language,
      task: 'transcribe',
      chunk_length_s: 30,
    });
    const text = Array.isArray(output) ? output.map((part) => part.text).join(' ') : output.text;
    post({ type: 'result', id: request.id, text });
  } catch (error) {
    post({ type: 'error', id: request.type === 'transcribe' ? request.id : undefined, message: error instanceof Error ? error.message : 'Speech recognition failed.' });
  }
};
