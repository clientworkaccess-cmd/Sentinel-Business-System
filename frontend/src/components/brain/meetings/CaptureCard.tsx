'use client';

import React, { useRef, useState } from 'react';
import { FileText, Loader2, Mic, Square, Upload } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api';
import { createFromText, uploadAudio, type MeetingDetail } from '@/lib/meetingsApi';
import { cn } from '@/lib/utils';
import { Card } from '../atoms';
import { useRecorder } from '../chat/voice';

type Mode = 'record' | 'upload' | 'paste';

const MODES: { id: Mode; label: string; icon: React.ElementType }[] = [
  { id: 'record', label: 'Record', icon: Mic },
  { id: 'upload', label: 'Upload file', icon: Upload },
  { id: 'paste', label: 'Paste text', icon: FileText },
];

/**
 * Three ways a meeting gets in: record it, upload a recording, or paste a
 * transcript.
 *
 * Live (backend auth): everything goes to the API, which transcribes and extracts
 * action items. Demo: the text is turned into a local voice note, as before.
 */
export function CaptureCard({
  live,
  onDemoText,
  onLiveCreated,
}: {
  live: boolean;
  onDemoText: (text: string, title?: string) => void;
  onLiveCreated: (meeting: MeetingDetail) => void;
}) {
  const recorder = useRecorder();
  const [mode, setMode] = useState<Mode>('record');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await work();
      setTitle('');
      setText('');
    } catch (err) {
      const axiosLike = typeof err === 'object' && err !== null && 'isAxiosError' in err;
      setNotice(!axiosLike && err instanceof Error ? err.message : apiErrorMessage(err, 'That could not be processed. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const sendAudio = (file: File) =>
    run('Transcribing and extracting action items…', async () => {
      if (live) {
        onLiveCreated(await uploadAudio(file, title || file.name.replace(/\.[^.]+$/, '')));
      } else {
        const form = new FormData();
        form.append('audio', file, file.name);
        form.append('language', 'auto');
        const res = await fetch('/api/brain/transcribe', { method: 'POST', body: form });
        if (!res.ok) throw new Error('Transcription is unavailable right now.');
        const { text: heard } = (await res.json()) as { text: string };
        if (!heard?.trim()) throw new Error('No speech was found in that file.');
        onDemoText(heard, title || undefined);
      }
    });

  const startRecording = async () => {
    setNotice(null);
    if (!(await recorder.start())) setNotice('Microphone is blocked or unavailable.');
  };

  const stopRecording = async () => {
    if (live) {
      const blob = await recorder.stopRaw();
      if (!blob) return setNotice('Nothing was recorded.');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      await sendAudio(new File([blob], `meeting-${stamp}.webm`, { type: blob.type || 'audio/webm' }));
    } else {
      const heard = await recorder.stop();
      if (heard.trim()) onDemoText(heard, title || undefined);
      else setNotice('Nothing was heard.');
    }
  };

  const submitText = () =>
    run('Extracting action items…', async () => {
      if (live) onLiveCreated(await createFromText(title.trim() || 'Pasted transcript', text.trim()));
      else onDemoText(text.trim(), title || undefined);
    });

  const recording = recorder.state === 'recording';
  const working = busy !== null || recorder.state === 'transcribing';

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Add a meeting" className="flex gap-1.5">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              disabled={recording || working}
              onClick={() => { setMode(id); setNotice(null); }}
              className={cn(
                'px-3 h-8 rounded-full text-xs font-medium border transition inline-flex items-center gap-1.5 disabled:opacity-50',
                mode === id ? 'bg-inverse text-white border-transparent' : 'border-stone-border text-warm-gray hover:text-ink-black bg-white',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting title (optional)"
          disabled={working}
          className="flex-1 min-w-[180px] h-9 px-3 rounded-full border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70"
        />
      </div>

      {mode === 'record' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-sky-wash/60 text-cyan-edge flex items-center justify-center shrink-0">
            <Mic className="w-5 h-5" />
          </span>
          <p className="flex-1 min-w-[180px] text-xs text-warm-gray">
            {busy ?? (recording ? 'Recording…' : 'Record a meeting or a quick note. Sentinel transcribes it and pulls out the action items.')}
          </p>
          {recording && (
            <div className="flex items-center gap-[3px] h-8" aria-hidden="true">
              {recorder.levels.slice(0, 18).map((l, i) => (
                <span key={i} className="w-[3px] rounded-full bg-cyan-signal" style={{ height: `${Math.round(l * 100)}%` }} />
              ))}
              <span className="ml-2 text-xs tabular-nums text-warm-gray">
                {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}
              </span>
            </div>
          )}
          {!recording && !working && (
            <button onClick={startRecording} className="btn-cyan text-sm inline-flex items-center gap-2">
              <Mic className="w-4 h-4" /> Record
            </button>
          )}
          {recording && (
            <>
              <button onClick={recorder.cancel} className="btn-ghost text-xs">Cancel</button>
              <button onClick={stopRecording} className="btn-cyan text-sm inline-flex items-center gap-2">
                <Square className="w-3.5 h-3.5 fill-current" /> Stop
              </button>
            </>
          )}
          {working && <Loader2 className="w-5 h-5 animate-spin text-cyan-signal" />}
        </div>
      )}

      {mode === 'upload' && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-[180px] text-xs text-warm-gray">
            {busy ?? 'Upload a meeting recording (mp3, m4a, wav, webm).'}
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/webm"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) sendAudio(f);
            }}
          />
          {working ? (
            <Loader2 className="w-5 h-5 animate-spin text-cyan-signal" />
          ) : (
            <button onClick={() => fileInput.current?.click()} className="btn-cyan text-sm inline-flex items-center gap-2">
              <Upload className="w-4 h-4" /> Choose file
            </button>
          )}
        </div>
      )}

      {mode === 'paste' && (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            disabled={working}
            placeholder="Paste the transcript or notes here."
            className="w-full p-3 rounded-cards border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70 resize-y"
          />
          <div className="flex items-center justify-end gap-3">
            {busy && <span className="text-xs text-warm-gray">{busy}</span>}
            <button
              onClick={submitText}
              disabled={working || text.trim().length < 5}
              className="btn-cyan text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Extract action items
            </button>
          </div>
        </div>
      )}

      {notice && <p className="text-xs text-rose-700">{notice}</p>}
    </Card>
  );
}
