'use client';

import { useEffect, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { HOLD_KEYS, type HoldKey, readSpeechSettings, SPEECH_LANGUAGES, SPEECH_MODELS, type SpeechLanguage, type SpeechModel, type SpeechSettings, writeSpeechSettings } from '@/lib/speech';
import { loadSpeechModel, onModelProgress, removeSpeechModels, speechModelCached, speechSupported } from './whisper-client';

const field = 'h-9 w-full rounded-lg border border-line-strong bg-surface-raised px-2 text-xs outline-none focus:ring-2 focus:ring-ring/30';

// A live input level, so the right microphone can be picked before talking to
// the chat. Nothing is recorded: the meter reads the stream and drops it.
function LevelMeter({ deviceId }: { deviceId: string }) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;
    let active = true;
    navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((media) => {
        if (!active) { media.getTracks().forEach((track) => track.stop()); return; }
        stream = media;
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(media).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          setLevel(Math.min(1, rms * 4));
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch((caught: unknown) => { if (active) setError(caught instanceof DOMException && caught.name === 'NotAllowedError' ? 'Microphone access was refused.' : 'The microphone could not be opened.'); });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
  }, [deviceId]);
  if (error) return <p className="text-[11px] text-danger-text">{error}</p>;
  return <>
    <meter aria-label="Input level" className="sr-only" max={100} min={0} value={Math.round(level * 100)} />
    <div aria-hidden className="h-2 w-full overflow-hidden rounded-full bg-surface-fill">
      <div className="h-full rounded-full bg-brand transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  </>;
}

export function MicrophoneSettings({ onNotice }: { onNotice: (message: string) => void }) {
  const [settings, setSettings] = useState<SpeechSettings>(readSpeechSettings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [cached, setCached] = useState<boolean | null>(null);
  const [cacheVersion, setCacheVersion] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [supported] = useState(speechSupported);

  function update(change: Partial<SpeechSettings>) {
    const next = { ...settings, ...change };
    setSettings(next);
    writeSpeechSettings(next);
  }

  useEffect(() => {
    if (!supported) return;
    let active = true;
    const list = () => navigator.mediaDevices.enumerateDevices().then((all) => { if (active) setDevices(all.filter((device) => device.kind === 'audioinput')); }).catch(() => undefined);
    void list();
    navigator.mediaDevices.addEventListener('devicechange', list);
    return () => { active = false; navigator.mediaDevices.removeEventListener('devicechange', list); };
  }, [supported]);

  useEffect(() => {
    let active = true;
    speechModelCached(settings.model).then((value) => { if (active) setCached(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [settings.model, cacheVersion]);

  useEffect(() => onModelProgress((model, percent) => { if (model === settings.model) setProgress(percent >= 100 ? null : percent); }), [settings.model]);

  // Browsers name microphones only after access is granted once.
  async function showNames() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput'));
    } catch { onNotice('Microphone access was refused. Allow it in the browser’s site settings.'); }
  }

  async function download() {
    setProgress(0);
    try {
      await loadSpeechModel(settings.model);
      onNotice(`${SPEECH_MODELS[settings.model].label} model is ready in this browser.`);
    } catch (caught) { onNotice(caught instanceof Error ? caught.message : 'The model could not be downloaded.'); }
    finally { setProgress(null); setCacheVersion((version) => version + 1); }
  }

  async function remove() {
    if (!window.confirm('Remove the downloaded speech models from this browser? The next recording downloads one again.')) return;
    await removeSpeechModels();
    onNotice('Speech models removed from this browser.');
    setCacheVersion((version) => version + 1);
  }

  if (!supported) return <Card className="border-0 bg-surface-raised/90 shadow-none ring-line"><CardContent className="py-5 text-sm text-ink-muted">This browser cannot record audio or run speech recognition, so push-to-talk is not available here.</CardContent></Card>;

  const named = devices.some((device) => device.label);
  const model = SPEECH_MODELS[settings.model];

  return <Card className="border-0 bg-surface-raised/90 shadow-none ring-line">
    <CardHeader>
      <CardTitle className="text-base">Push-to-talk</CardTitle>
      <CardDescription>Hold the microphone button under the message box, speak, and release. Whisper turns the recording into text in this browser: the audio is never uploaded. The model is downloaded from Hugging Face once and kept in this browser. These settings apply to this browser only.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4 text-xs">
      <div className="space-y-1.5">
        <label className="font-medium" htmlFor="speech-device">Microphone</label>
        <div className="flex gap-2">
          <select className={field} id="speech-device" onChange={(event) => update({ deviceId: event.target.value })} value={settings.deviceId}>
            <option value="">System default</option>
            {devices.filter((device) => device.deviceId && device.deviceId !== 'default').map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
          </select>
          <Button aria-pressed={testing} onClick={() => setTesting((value) => !value)} size="sm" type="button" variant="outline">{testing ? <MicOff /> : <Mic />}{testing ? 'Stop test' : 'Test'}</Button>
        </div>
        {!named && <button className="text-[11px] text-brand-text underline-offset-2 hover:underline" onClick={() => void showNames()} type="button">Show microphone names</button>}
        {testing && <LevelMeter deviceId={settings.deviceId} />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 font-medium" htmlFor="speech-language">Language
          <select className={field} id="speech-language" onChange={(event) => update({ language: event.target.value as SpeechLanguage })} value={settings.language}>
            {Object.entries(SPEECH_LANGUAGES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 font-medium" htmlFor="speech-hold-key">Hold a key to talk
          <select className={field} id="speech-hold-key" onChange={(event) => update({ holdKey: event.target.value as HoldKey })} value={settings.holdKey}>
            {Object.entries(HOLD_KEYS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 font-medium">Model</legend>
        {(Object.keys(SPEECH_MODELS) as SpeechModel[]).map((key) => <label className="flex items-center gap-2" key={key}>
          <input checked={settings.model === key} name="speech-model" onChange={() => update({ model: key })} type="radio" />
          <span><b className="font-medium">{SPEECH_MODELS[key].label}</b> · {SPEECH_MODELS[key].sizeMb} MB · <span className="text-ink-muted">{SPEECH_MODELS[key].note}</span></span>
        </label>)}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-ink-muted">
          <span>{cached === null ? 'Checking…' : cached ? `${model.label} is downloaded in this browser.` : `${model.label} is not downloaded yet. The first recording downloads ${model.sizeMb} MB.`}</span>
          {cached === false && <Button disabled={progress !== null} onClick={() => void download()} size="sm" type="button" variant="outline">{progress !== null ? `Downloading ${progress}%` : 'Download now'}</Button>}
          <Button onClick={() => void remove()} size="sm" type="button" variant="ghost">Remove downloaded models</Button>
        </div>
      </fieldset>

      <label className="flex items-center gap-2">
        <input checked={settings.sendAfter} onChange={(event) => update({ sendAfter: event.target.checked })} type="checkbox" />
        Send the message as soon as the speech is transcribed
      </label>
    </CardContent>
  </Card>;
}
