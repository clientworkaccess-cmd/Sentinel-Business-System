'use client';

/**
 * Voice for the chat: record → transcribe, live dictation, and spoken replies.
 *
 * Every path has a browser fallback so a missing ElevenLabs key or a flaky
 * network never leaves the presenter with a dead mic:
 *   - recording also runs the browser recogniser in parallel, and its transcript
 *     is used when /api/brain/transcribe is unavailable;
 *   - spoken replies fall back to speechSynthesis.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal Web Speech typings — not in TypeScript's DOM lib. */
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function createRecognition(lang = 'en-US'): Recognition | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  return r;
}

export const speechRecognitionSupported = () => !!createRecognition();

/** Joins final results plus the current interim one. */
function transcriptOf(e: RecognitionEvent, finals: string[]): { finals: string[]; text: string } {
  const next = [...finals];
  let interim = '';
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i];
    if (r.isFinal) next[i] = r[0].transcript;
    else interim += r[0].transcript;
  }
  return { finals: next, text: `${next.filter(Boolean).join(' ')} ${interim}`.replace(/\s+/g, ' ').trim() };
}

/* ── Live dictation ────────────────────────────────────────────────────── */

export function useDictation(onText: (text: string) => void) {
  const [active, setActive] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const finals = useRef<string[]>([]);
  const base = useRef('');

  const stop = useCallback(() => {
    rec.current?.stop();
    rec.current = null;
    setActive(false);
  }, []);

  const start = useCallback(
    (existing: string) => {
      const r = createRecognition();
      if (!r) return false;
      base.current = existing ? `${existing.trim()} ` : '';
      finals.current = [];
      r.onresult = (e) => {
        const t = transcriptOf(e, finals.current);
        finals.current = t.finals;
        onText(base.current + t.text);
      };
      r.onerror = () => stop();
      r.onend = () => setActive(false);
      r.start();
      rec.current = r;
      setActive(true);
      return true;
    },
    [onText, stop],
  );

  useEffect(() => () => rec.current?.abort(), []);
  return { active, start, stop, supported: speechRecognitionSupported };
}

/* ── Record → transcribe ───────────────────────────────────────────────── */

export type RecorderState = 'idle' | 'recording' | 'transcribing';

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [levels, setLevels] = useState<number[]>(() => Array(28).fill(0.08));
  const [seconds, setSeconds] = useState(0);
  const media = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const raf = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const backup = useRef<Recognition | null>(null);
  const backupText = useRef('');

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (timer.current) clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    audioCtx.current?.close().catch(() => undefined);
    backup.current?.abort();
    stream.current = null;
    audioCtx.current = null;
    backup.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      chunks.current = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const mr = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.start(250);
      media.current = mr;

      // Live waveform from the same stream.
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(s).connect(analyser);
      audioCtx.current = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        setLevels(Array.from({ length: 28 }, (_, i) => Math.max(0.08, (data[i % data.length] ?? 0) / 255)));
        raf.current = requestAnimationFrame(tick);
      };
      tick();

      // Backup transcript, in case server transcription is unavailable.
      backupText.current = '';
      const r = createRecognition();
      if (r) {
        let finals: string[] = [];
        r.onresult = (e) => {
          const t = transcriptOf(e, finals);
          finals = t.finals;
          backupText.current = t.text;
        };
        r.onerror = () => undefined;
        try { r.start(); backup.current = r; } catch { /* already running */ }
      }

      setSeconds(0);
      timer.current = setInterval(() => setSeconds((x) => x + 1), 1000);
      setState('recording');
      return true;
    } catch {
      cleanup();
      setState('idle');
      return false;
    }
  }, [cleanup]);

  const cancel = useCallback(() => {
    media.current?.stop();
    media.current = null;
    cleanup();
    setState('idle');
  }, [cleanup]);

  /** Stop and transcribe. Resolves to the text, or '' when nothing was heard. */
  const stop = useCallback(async (): Promise<string> => {
    const mr = media.current;
    if (!mr) return '';
    const stopped = new Promise<void>((resolve) => (mr.onstop = () => resolve()));
    mr.stop();
    media.current = null;
    backup.current?.stop();
    await stopped;
    const fallbackText = backupText.current;
    cleanup();
    setState('transcribing');

    const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
    try {
      const form = new FormData();
      form.append('audio', blob, 'speech.webm');
      form.append('language', 'auto');
      const res = await fetch('/api/brain/transcribe', { method: 'POST', body: form, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      const { text } = (await res.json()) as { text: string };
      return text || fallbackText;
    } catch {
      return fallbackText;
    } finally {
      setState('idle');
    }
  }, [cleanup]);

  /** Stop and hand back the raw audio, without transcribing (the backend does it). */
  const stopRaw = useCallback(async (): Promise<Blob | null> => {
    const mr = media.current;
    if (!mr) return null;
    const stopped = new Promise<void>((resolve) => (mr.onstop = () => resolve()));
    mr.stop();
    media.current = null;
    backup.current?.stop();
    await stopped;
    cleanup();
    setState('idle');
    const blob = new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' });
    return blob.size ? blob : null;
  }, [cleanup]);

  return { state, levels, seconds, start, stop, stopRaw, cancel };
}

/* ── Spoken replies ────────────────────────────────────────────────────── */

/** Markdown → something a voice can read. */
export function speakable(md: string): string {
  return md
    .replace(/\*\*|__|\*|`/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/→/g, ' to ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  current?.pause();
  current = null;
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
}

/** ElevenLabs first; the browser's own voice if that is unavailable. */
export async function speakText(md: string, onEnd?: () => void): Promise<void> {
  stopSpeaking();
  const text = speakable(md);
  if (!text) return;
  try {
    const res = await fetch('/api/brain/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    current = audio;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      onEnd?.();
    };
    await audio.play();
  } catch {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return onEnd?.();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    u.onend = () => onEnd?.();
    synth.speak(u);
  }
}
