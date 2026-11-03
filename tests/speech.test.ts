import { describe, expect, it } from 'vitest';
import { appendTranscript, cleanTranscript, DEFAULT_SPEECH_SETTINGS, HOLD_KEYS, parseSpeechSettings } from '@/lib/speech';

describe('parseSpeechSettings', () => {
  it('falls back to the defaults for nothing or garbage', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '42']) {
      expect(parseSpeechSettings(raw), JSON.stringify(raw) ?? 'undefined').toEqual(DEFAULT_SPEECH_SETTINGS);
    }
  });

  it('keeps the valid fields and replaces only the bad ones', () => {
    const stored = JSON.stringify({ deviceId: 'usb-mic', language: 'polish', model: 'huge', holdKey: 'F8', sendAfter: 'yes' });
    expect(parseSpeechSettings(stored)).toEqual({ deviceId: 'usb-mic', language: 'polish', model: 'base', holdKey: 'F8', sendAfter: false });
  });

  it('never offers a key that types characters, such as AltGr', () => {
    expect(Object.keys(HOLD_KEYS)).not.toContain('AltRight');
    expect(parseSpeechSettings(JSON.stringify({ holdKey: 'AltRight' })).holdKey).toBe('none');
  });
});

describe('cleanTranscript and appendTranscript', () => {
  it('drops the tags Whisper writes for silence and noise', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] ')).toBe('');
    expect(cleanTranscript('(music) Hello   there [inaudible] ')).toBe('Hello there');
  });

  it('adds the transcript after what is typed, with one space', () => {
    expect(appendTranscript('', ' Dzień dobry. ')).toBe('Dzień dobry.');
    expect(appendTranscript('Notes:  ', 'first point')).toBe('Notes: first point');
    expect(appendTranscript('Keep this', '[BLANK_AUDIO]')).toBe('Keep this');
  });
});
