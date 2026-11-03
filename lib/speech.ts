// Push-to-talk settings. Speech is turned into text by Whisper running in this
// browser: the recording never leaves it. The model is downloaded from Hugging
// Face on first use and kept in the browser's cache. Settings are per browser,
// because microphones are per machine. No zod here, so the browser can use it.

export const SPEECH_MODELS = {
  tiny: { repo: 'onnx-community/whisper-tiny', label: 'Tiny', sizeMb: 38, note: 'fastest, weakest outside English' },
  base: { repo: 'onnx-community/whisper-base', label: 'Base', sizeMb: 73, note: 'a balance of speed and accuracy' },
  small: { repo: 'onnx-community/whisper-small', label: 'Small', sizeMb: 237, note: 'slowest, most accurate, best for Polish' },
} as const;
export type SpeechModel = keyof typeof SPEECH_MODELS;

// `auto` lets Whisper detect the language; a fixed one is faster and steadier.
export const SPEECH_LANGUAGES = { auto: 'Detect automatically', polish: 'Polish', english: 'English', german: 'German', ukrainian: 'Ukrainian', spanish: 'Spanish', french: 'French' } as const;
export type SpeechLanguage = keyof typeof SPEECH_LANGUAGES;

// A key held to talk while the chat is open, by `KeyboardEvent.code`. Keys
// that type nothing, so holding one never puts characters into the message.
// Not Right Alt: on Polish and many other layouts it is AltGr, used for ą or ę.
export const HOLD_KEYS = { none: 'None (button only)', ControlRight: 'Right Ctrl', F8: 'F8', F9: 'F9', Pause: 'Pause' } as const;
export type HoldKey = keyof typeof HOLD_KEYS;

export type SpeechSettings = {
  // '' is the system default microphone.
  deviceId: string;
  language: SpeechLanguage;
  model: SpeechModel;
  holdKey: HoldKey;
  // Send the message as soon as the transcript lands, instead of leaving it to
  // be read and edited first.
  sendAfter: boolean;
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = { deviceId: '', language: 'auto', model: 'base', holdKey: 'none', sendAfter: false };

export const SPEECH_STORAGE_KEY = 'meshkeep-speech';

const oneOf = <T extends string>(options: Record<T, unknown>, value: unknown, fallback: T): T =>
  typeof value === 'string' && Object.hasOwn(options, value) ? (value as T) : fallback;

// Reads stored settings, falling back field by field, so one bad value does not
// reset the rest.
export function parseSpeechSettings(raw: unknown): SpeechSettings {
  let value: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try { const parsed: unknown = JSON.parse(raw); if (parsed && typeof parsed === 'object') value = parsed as Record<string, unknown>; } catch { /* defaults below */ }
  }
  return {
    deviceId: typeof value.deviceId === 'string' ? value.deviceId.slice(0, 200) : DEFAULT_SPEECH_SETTINGS.deviceId,
    language: oneOf(SPEECH_LANGUAGES, value.language, DEFAULT_SPEECH_SETTINGS.language),
    model: oneOf(SPEECH_MODELS, value.model, DEFAULT_SPEECH_SETTINGS.model),
    holdKey: oneOf(HOLD_KEYS, value.holdKey, DEFAULT_SPEECH_SETTINGS.holdKey),
    sendAfter: typeof value.sendAfter === 'boolean' ? value.sendAfter : DEFAULT_SPEECH_SETTINGS.sendAfter,
  };
}

export function readSpeechSettings(): SpeechSettings {
  try { return parseSpeechSettings(localStorage.getItem(SPEECH_STORAGE_KEY)); } catch { return DEFAULT_SPEECH_SETTINGS; }
}

export function writeSpeechSettings(settings: SpeechSettings) {
  try { localStorage.setItem(SPEECH_STORAGE_KEY, JSON.stringify(settings)); } catch { /* lasts until reload */ }
}

// Whisper marks silence and noise with bracketed tags such as [BLANK_AUDIO] or
// (music). They are not words anybody said, so they never reach the message.
export function cleanTranscript(transcript: string): string {
  return transcript.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

// Puts a transcript into the message box: after what is already typed, with a
// single space between.
export function appendTranscript(prompt: string, transcript: string): string {
  const text = cleanTranscript(transcript);
  if (!text) return prompt;
  const before = prompt.replace(/\s+$/, '');
  return before ? `${before} ${text}` : text;
}
