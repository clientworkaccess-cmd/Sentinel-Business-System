'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUp, AudioLines, Check, Loader2, Mic, RotateCcw, ShieldCheck, Square, Volume2, VolumeX, X,
} from 'lucide-react';
import { BrandLockup, MarkdownText } from '@/components/ui';
import { ORG, getItem, getPerson } from '@/demo/org';
import { SUGGESTED_PROMPTS } from '@/demo/prompts';
import { itemsInScope, scopeLabel } from '@/demo/visibility';
import type { BrainItem } from '@/demo/types';
import { useBrainChatStore, type BrainMessage } from '@/stores/useBrainChatStore';
import { useBrainStore } from '@/stores/useBrainStore';
import { cn } from '@/lib/utils';
import { ItemDrawer } from '../ItemDrawer';
import { KIND_META } from '../meta';
import { speakText, stopSpeaking, useDictation, useRecorder, speechRecognitionSupported } from './voice';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

export function ChatView() {
  const { viewer, scope } = useBrainStore();
  const { messages, busy, ask, reset } = useBrainChatStore();
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<BrainItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canDictate, setCanDictate] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const askedFromUrl = useRef(false);

  const me = getPerson(viewer.personId);
  const memoryCount = useMemo(() => itemsInScope(ORG, viewer, scope).length, [viewer, scope]);
  const dictation = useDictation(setDraft);
  const recorder = useRecorder();

  useEffect(() => setCanDictate(speechRecognitionSupported()), []);

  // A new role starts a new conversation: earlier answers may hold things it cannot see.
  const role = viewer.role;
  const firstRole = useRef(role);
  useEffect(() => {
    if (role === firstRole.current) return;
    firstRole.current = role;
    stopSpeaking();
    reset();
  }, [role, reset]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      dictation.stop();
      setDraft('');
      setNotice(null);
      stopSpeaking();
      const answer = await ask(text, viewer, scope);
      if (answer && voiceReplies) {
        setSpeakingId(answer.id);
        speakText(answer.content, () => setSpeakingId(null));
      }
    },
    [ask, busy, dictation, scope, viewer, voiceReplies],
  );

  // "Ask Sentinel about this" and the overview's ask box arrive as ?q=. Read after
  // mount rather than via useSearchParams, which needs a Suspense boundary that
  // can stall hydration of the whole chat.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (!q || askedFromUrl.current) return;
    askedFromUrl.current = true;
    router.replace('/brain/chat');
    send(q);
  }, [router, send]);

  const toggleDictation = () => {
    if (dictation.active) return dictation.stop();
    if (!dictation.start(draft)) setNotice('Live dictation needs Chrome or Edge. Use the mic to record instead.');
    input.current?.focus();
  };

  const startRecording = async () => {
    dictation.stop();
    setNotice(null);
    if (!(await recorder.start())) setNotice('Microphone is blocked. Allow mic access in the browser, or type your question.');
  };

  const finishRecording = async () => {
    const text = await recorder.stop();
    if (!text) return setNotice("I didn't catch that. Try again, a little closer to the mic.");
    // Editable before sending, so a misheard word can be fixed.
    setDraft(text);
    input.current?.focus();
  };

  const play = (m: BrainMessage) => {
    if (speakingId === m.id) {
      stopSpeaking();
      return setSpeakingId(null);
    }
    setSpeakingId(m.id);
    speakText(m.content, () => setSpeakingId(null));
  };

  return (
    <div className="h-full flex flex-col rounded-feature border border-stone-border bg-white shadow-card overflow-hidden">
      {/* Header */}
      <div className="h-14 shrink-0 px-4 sm:px-5 flex items-center justify-between border-b border-stone-border">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-black">Ask Sentinel</p>
          <p className="text-[11px] text-warm-gray truncate">
            Answers from {memoryCount} memories {me?.name.split(' ')[0]} can see in {scopeLabel(ORG, scope)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              if (voiceReplies) stopSpeaking();
              setVoiceReplies((v) => !v);
            }}
            aria-pressed={voiceReplies}
            className={cn(
              'h-8 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 border transition',
              voiceReplies ? 'border-cyan-edge/50 bg-sky-wash/50 text-cyan-edge' : 'border-stone-border text-warm-gray hover:text-ink-black',
            )}
          >
            {voiceReplies ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            Voice replies
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => {
                stopSpeaking();
                reset();
              }}
              title="New conversation"
              aria-label="New conversation"
              className="w-8 h-8 rounded-full inline-flex items-center justify-center text-warm-gray hover:text-ink-black hover:bg-stone-border/40 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Thread */}
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          {messages.length === 0 ? (
            <EmptyState firstName={me?.name.split(' ')[0] ?? ''} roleLabel={ROLE_LABEL[viewer.role]} prompts={SUGGESTED_PROMPTS[viewer.role]} onPick={send} />
          ) : (
            messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-inverse text-white px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  memoryCount={memoryCount}
                  speaking={speakingId === m.id}
                  onPlay={() => play(m)}
                  onOpenItem={setOpenItem}
                />
              ),
            )
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-stone-border bg-stone-canvas/60 px-3 sm:px-5 py-3">
        <div className="max-w-3xl mx-auto">
          {notice && <p className="text-xs text-amber-700 mb-2 px-1">{notice}</p>}
          {recorder.state === 'recording' ? (
            <div className="flex items-center gap-3 h-14 rounded-2xl border border-cyan-edge/50 bg-white px-3 shadow-subtle">
              <button onClick={recorder.cancel} aria-label="Cancel recording" className="w-9 h-9 rounded-full inline-flex items-center justify-center text-warm-gray hover:text-ink-black hover:bg-stone-border/40">
                <X className="w-4 h-4" />
              </button>
              <span className="relative flex w-2.5 h-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60 animate-ping" />
                <span className="relative inline-flex rounded-full w-2.5 h-2.5 bg-rose-500" />
              </span>
              <div className="flex-1 flex items-center justify-center gap-[3px] h-8" aria-hidden="true">
                {recorder.levels.map((l, i) => (
                  <span key={i} className="w-[3px] rounded-full bg-cyan-signal transition-[height] duration-75" style={{ height: `${Math.round(l * 100)}%` }} />
                ))}
              </div>
              <span className="text-xs tabular-nums text-warm-gray w-10 text-right">
                {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}
              </span>
              <button onClick={finishRecording} aria-label="Stop and transcribe" className="w-9 h-9 rounded-full bg-cyan-signal hover:bg-cyan-edge text-white inline-flex items-center justify-center transition">
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : recorder.state === 'transcribing' ? (
            <div className="flex items-center justify-center gap-2 h-14 rounded-2xl border border-stone-border bg-white text-sm text-warm-gray">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-signal" /> Transcribing…
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className={cn(
                'flex items-end gap-2 rounded-2xl border bg-white pl-4 pr-2 py-2 shadow-subtle transition',
                dictation.active ? 'border-cyan-edge/70 ring-4 ring-sky-wash/60' : 'border-stone-border focus-within:border-cyan-edge/60',
              )}
            >
              <textarea
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                rows={1}
                placeholder={dictation.active ? 'Listening… speak and watch it type' : 'Ask anything — English, اردو or Roman Urdu'}
                className="flex-1 resize-none bg-transparent outline-none text-[15px] leading-6 py-1.5 max-h-40 text-ink-black placeholder:text-ash-gray"
                style={{ height: 'auto' }}
                onInput={(e) => {
                  const t = e.currentTarget;
                  t.style.height = 'auto';
                  t.style.height = `${Math.min(160, t.scrollHeight)}px`;
                }}
              />
              {canDictate && (
                <button
                  type="button"
                  onClick={toggleDictation}
                  title={dictation.active ? 'Stop dictation' : 'Dictate: type by voice'}
                  aria-label={dictation.active ? 'Stop dictation' : 'Dictate'}
                  aria-pressed={dictation.active}
                  className={cn(
                    'w-9 h-9 rounded-full inline-flex items-center justify-center transition shrink-0',
                    dictation.active ? 'bg-sky-wash text-cyan-edge' : 'text-warm-gray hover:text-ink-black hover:bg-stone-border/40',
                  )}
                >
                  {dictation.active ? <Square className="w-3.5 h-3.5 fill-current" /> : <AudioLines className="w-4 h-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={startRecording}
                disabled={busy}
                title="Record a voice question"
                aria-label="Record a voice question"
                className="w-9 h-9 rounded-full inline-flex items-center justify-center text-warm-gray hover:text-ink-black hover:bg-stone-border/40 transition shrink-0 disabled:opacity-40"
              >
                <Mic className="w-4 h-4" />
              </button>
              <button
                type="submit"
                disabled={!draft.trim() || busy}
                aria-label="Send"
                className="w-9 h-9 rounded-full bg-cyan-signal hover:bg-cyan-edge disabled:bg-stone-muted text-white inline-flex items-center justify-center transition shrink-0"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
              </button>
            </form>
          )}
          <p className="mt-2 px-1 text-[11px] text-ash-gray flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3" />
            Sentinel only answers from what a {ROLE_LABEL[viewer.role]} can see. Anything sent outside the company waits for human approval.
          </p>
        </div>
      </div>

      <ItemDrawer item={openItem} onClose={() => setOpenItem(null)} onOpenItem={setOpenItem} />
    </div>
  );
}

function EmptyState({ firstName, roleLabel, prompts, onPick }: { firstName: string; roleLabel: string; prompts: string[]; onPick: (q: string) => void }) {
  return (
    <div className="pt-8 sm:pt-14 text-center">
      <div className="inline-flex"><BrandLockup size="lg" /></div>
      <h1 className="font-display text-[34px] sm:text-[42px] leading-[1.1] text-ink-black mt-5">
        Ask your business <span className="cyan-highlight">out loud</span>.
      </h1>
      <p className="text-sm text-warm-gray mt-3 max-w-md mx-auto">
        Type, dictate, or record a question, {firstName}. Sentinel answers from your company&apos;s memory, scoped to what you can see as {roleLabel}.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 text-left">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="group stone-card px-4 py-3.5 text-sm text-ink-black hover:shadow-preview hover:-translate-y-0.5 transition duration-200"
          >
            {p}
            <span className="block text-[11px] text-ash-gray mt-1 group-hover:text-cyan-edge transition">Ask this →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const THINKING_STEPS = (n: number) => [`Searching ${n} memories you can see`, 'Connecting people, clients and meetings', 'Writing the answer'];

function AssistantMessage({
  message: m, memoryCount, speaking, onPlay, onOpenItem,
}: { message: BrainMessage; memoryCount: number; speaking: boolean; onPlay: () => void; onOpenItem: (i: BrainItem) => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (m.status !== 'thinking') return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, 2)), 1100);
    return () => clearInterval(t);
  }, [m.status]);

  const sources = m.sources.map(getItem).filter((i): i is BrainItem => !!i);

  return (
    <div className="flex gap-3">
      <div className="shrink-0 pt-0.5"><BrandLockup /></div>
      <div className="flex-1 min-w-0">
        {m.status === 'thinking' ? (
          <div className="flex items-center gap-2 h-8 text-sm text-warm-gray">
            <span className="flex gap-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-signal animate-bounce" style={{ animationDelay: `${i * 140}ms` }} />
              ))}
            </span>
            {THINKING_STEPS(memoryCount)[step]}…
          </div>
        ) : (
          <div className="text-[15px] leading-relaxed text-ink-black/90">
            <MarkdownText content={m.content} />
            {m.status === 'streaming' && <span className="inline-block w-1.5 h-4 align-middle bg-cyan-signal/70 animate-pulse ml-0.5" />}
          </div>
        )}

        {m.status === 'done' && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {sources.map((s) => {
              const Icon = KIND_META[s.kind].icon;
              return (
                <button
                  key={s.id}
                  onClick={() => onOpenItem(s)}
                  className="inline-flex items-center gap-1.5 max-w-[240px] px-2.5 py-1 rounded-full border border-stone-border bg-stone-canvas text-xs text-warm-gray hover:text-ink-black hover:border-stone-muted transition"
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
            <button
              onClick={onPlay}
              aria-label={speaking ? 'Stop reading aloud' : 'Read aloud'}
              title={speaking ? 'Stop' : 'Read aloud'}
              className={cn(
                'w-7 h-7 rounded-full inline-flex items-center justify-center transition',
                speaking ? 'bg-sky-wash text-cyan-edge' : 'text-ash-gray hover:text-ink-black hover:bg-stone-border/40',
              )}
            >
              {speaking ? <Square className="w-3 h-3 fill-current" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
