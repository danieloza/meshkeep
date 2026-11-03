'use client';

import { SPEECH_MODELS, type SpeechLanguage, type SpeechModel } from '@/lib/speech';
import type { WorkerRequest, WorkerResponse } from './whisper.worker';

// One worker for the whole page, created on first use: until someone talks,
// neither the speech code nor the model is downloaded.
let worker: Worker | null = null;
let nextId = 1;
const transcriptions = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void }>();
const loads = new Map<SpeechModel, { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }>();
const downloaded = new Map<SpeechModel, Map<string, number>>();
const progressListeners = new Set<(model: SpeechModel, percent: number) => void>();

// transformers.js keeps model files in these two caches of the browser.
const MODEL_CACHES = ['transformers-cache', 'experimental_transformers-hash-cache'];

// A worker that fails to start or crashes fails everything waiting on it, and
// is dropped so the next press starts a new one instead of waiting forever.
function failAll(message: string) {
  worker?.terminate();
  worker = null;
  for (const [id, pending] of transcriptions) { pending.reject(new Error(message)); transcriptions.delete(id); }
  for (const [model, load] of loads) { load.reject(new Error(message)); loads.delete(model); }
}

function speechWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onerror = (event) => { event.preventDefault(); failAll(`Speech recognition stopped: ${event.message || 'the worker failed to start'}.`); };
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'progress') {
      const files = downloaded.get(message.model) ?? new Map<string, number>();
      files.set(message.file, message.loaded);
      downloaded.set(message.model, files);
      // Against the known size of the weights: the per-file totals arrive one
      // file at a time and would make the bar jump back.
      const bytes = [...files.values()].reduce((sum, value) => sum + value, 0);
      const percent = Math.min(99, Math.round((bytes / (SPEECH_MODELS[message.model].sizeMb * 1_048_576)) * 100));
      progressListeners.forEach((listener) => listener(message.model, percent));
    } else if (message.type === 'ready') {
      loads.get(message.model)?.resolve();
      progressListeners.forEach((listener) => listener(message.model, 100));
    } else if (message.type === 'result') {
      transcriptions.get(message.id)?.resolve(message.text);
      transcriptions.delete(message.id);
    } else if (message.id !== undefined) {
      transcriptions.get(message.id)?.reject(new Error(message.message));
      transcriptions.delete(message.id);
    } else {
      // A failed download: every load waiting for it fails, and the next
      // attempt starts afresh.
      for (const [model, load] of loads) { load.reject(new Error(message.message)); loads.delete(model); }
    }
  };
  return worker;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function onModelProgress(listener: (model: SpeechModel, percent: number) => void): () => void {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}

// Downloads the model, or finds it in the cache, without transcribing.
export function loadSpeechModel(model: SpeechModel): Promise<void> {
  const existing = loads.get(model);
  if (existing) return existing.promise;
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  loads.set(model, { promise, resolve, reject });
  speechWorker().postMessage({ type: 'load', model } satisfies WorkerRequest);
  return promise;
}

export function transcribe(audio: Float32Array, model: SpeechModel, language: SpeechLanguage): Promise<string> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    transcriptions.set(id, { resolve, reject });
    // The buffer is transferred, not copied: a minute of audio is 4 MB.
    speechWorker().postMessage({ type: 'transcribe', id, model, language, audio } satisfies WorkerRequest, [audio.buffer]);
  });
}

// Whether the model's weights are already in this browser.
export async function speechModelCached(model: SpeechModel): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  const cache = await caches.open(MODEL_CACHES[0]);
  const keys = await cache.keys();
  return keys.some((request) => request.url.includes(`/${SPEECH_MODELS[model].repo}/`) && request.url.endsWith('_quantized.onnx'));
}

// Deletes every downloaded model and stops the worker, which still holds one.
export async function removeSpeechModels(): Promise<void> {
  worker?.terminate();
  worker = null;
  loads.clear();
  downloaded.clear();
  if (typeof caches !== 'undefined') await Promise.all(MODEL_CACHES.map((name) => caches.delete(name)));
}

// Whisper expects 16 kHz mono. The browser resamples while decoding when the
// context runs at that rate; channels are averaged into one.
export async function decodeRecording(recording: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: 16_000 });
  try {
    const buffer = await context.decodeAudioData(await recording.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) mono[index] += data[index] / buffer.numberOfChannels;
    }
    return mono;
  } finally {
    void context.close();
  }
}
