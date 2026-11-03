'use client';

import { useEffect, useRef, useState } from 'react';
import { cleanTranscript, type SpeechSettings } from '@/lib/speech';
import { decodeRecording, onModelProgress, transcribe } from './whisper-client';

export type TalkPhase = 'idle' | 'starting' | 'recording' | 'transcribing';

// Shorter than this is a tap, not speech.
const MIN_RECORDING_MS = 300;

function microphoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError') return 'Microphone access was refused. Allow it in the browser’s site settings.';
  if (name === 'NotFoundError') return 'No microphone was found.';
  if (name === 'OverconstrainedError') return 'The chosen microphone is not connected. Pick another in Settings › Microphone.';
  return error instanceof Error ? error.message : 'The microphone could not be started.';
}

type Session = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number };

// Hold to record, release to transcribe. The recording is turned into text by
// Whisper in this browser and handed to `onTranscript`; it is not uploaded.
export function usePushToTalk(settings: SpeechSettings, onTranscript: (text: string) => void) {
  const [phase, setPhase] = useState<TalkPhase>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  // Released while the browser was still asking for the microphone.
  const releasedEarly = useRef(false);
  const latest = useRef({ settings, onTranscript });
  useEffect(() => { latest.current = { settings, onTranscript }; });

  useEffect(() => onModelProgress((model, percent) => {
    if (model === latest.current.settings.model) setProgress(percent >= 100 ? null : percent);
  }), []);
  // Leaving the page mid-recording turns the microphone off.
  useEffect(() => () => { session.current?.stream.getTracks().forEach((track) => track.stop()); }, []);

  async function start() {
    if (session.current || phase !== 'idle') return;
    setError(null);
    setPhase('starting');
    releasedEarly.current = false;
    try {
      const { deviceId } = latest.current.settings;
      const constraints: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      const current: Session = { recorder: new MediaRecorder(stream), stream, chunks: [], startedAt: Date.now() };
      current.recorder.ondataavailable = (event) => { if (event.data.size) current.chunks.push(event.data); };
      current.recorder.start();
      session.current = current;
      setPhase('recording');
      if (releasedEarly.current) await stop();
    } catch (caught) {
      setError(microphoneError(caught));
      setPhase('idle');
    }
  }

  async function stop() {
    const current = session.current;
    if (!current) { releasedEarly.current = true; return; }
    session.current = null;
    const stopped = new Promise<void>((resolve) => { current.recorder.onstop = () => resolve(); });
    current.recorder.stop();
    await stopped;
    current.stream.getTracks().forEach((track) => track.stop());
    if (Date.now() - current.startedAt < MIN_RECORDING_MS) {
      setError('Hold the button while you speak, and release it when you finish.');
      setPhase('idle');
      return;
    }
    setPhase('transcribing');
    try {
      const audio = await decodeRecording(new Blob(current.chunks, { type: current.recorder.mimeType }));
      const { model, language } = latest.current.settings;
      const text = cleanTranscript(await transcribe(audio, model, language));
      if (text) latest.current.onTranscript(text);
      else setError('No speech was recognised.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Speech recognition failed.');
    } finally {
      setPhase('idle');
      setProgress(null);
    }
  }

  return { phase, progress, error, start, stop, clearError: () => setError(null) };
}
