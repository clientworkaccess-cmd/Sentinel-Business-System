'use client';

import React, { useState } from 'react';
import { Check, Copy, Eye, EyeOff, Lock, MessageSquareText, Plug } from 'lucide-react';
import { AI_CLIENTS, DEMO_EXCHANGE, MCP_TOOLS, SCOPE_BY_ROLE, SENTINEL_MCP_URL, getAi, type AiClient } from '@/demo/ai';
import { getPerson } from '@/demo/org';
import { useBrainStore } from '@/stores/useBrainStore';
import { cn } from '@/lib/utils';
import { AvatarStack } from '../atoms';
import { AiMark, Details, PanelHeader, Stat } from './parts';

/** Connect your AI: Sentinel as the company memory any AI can plug into over MCP. */
export function ConnectPanel() {
  const role = useBrainStore((s) => s.viewer.role);
  const scope = SCOPE_BY_ROLE[role];
  const [open, setOpen] = useState<AiClient['id'] | null>('claude');
  const connected = AI_CLIENTS.filter((a) => a.connected);
  const people = new Set(connected.flatMap((a) => a.userIds)).size;
  const lookups = connected.reduce((n, a) => n + a.lookupsToday, 0);

  return (
    <div className="space-y-6">
      <PanelHeader
        title="Give your AI your company's memory"
        hint="Add Sentinel to Claude, ChatGPT, Cursor or any AI that supports MCP. Each person's AI then knows your clients, projects and decisions, but only what that person is allowed to see."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="AIs connected" value={connected.length} hint={`of ${AI_CLIENTS.length} supported`} />
        <Stat label="People using it" value={people} />
        <Stat label="Lookups today" value={lookups} />
        <Stat label="Setup" value="1 link" hint="No install, no IT rollout" />
      </div>

      <LiveExchange />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-3">
          {AI_CLIENTS.map((ai) => (
            <AiCard key={ai.id} ai={ai} open={open === ai.id} onToggle={() => setOpen(open === ai.id ? null : ai.id)} />
          ))}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="stone-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-cyan-signal" />
              <h3 className="text-sm font-semibold text-ink-black">What your AI can see</h3>
            </div>
            <p className="text-xs text-warm-gray">
              Viewing as <span className="font-medium text-ink-black">{scope.who}</span>. Switch Owner / Admin / Member at the top: same AI, different slice.
            </p>
            <ul className="space-y-1.5">
              {scope.sees.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm text-ink-black"><Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />{s}</li>
              ))}
            </ul>
            <ul className="space-y-1.5 pt-2 border-t border-stone-border">
              {scope.hidden.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm text-warm-gray"><EyeOff className="w-4 h-4 text-ash-gray shrink-0 mt-0.5" />{s}</li>
              ))}
            </ul>
          </div>

          <div className="stone-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-cyan-signal" />
              <h3 className="text-sm font-semibold text-ink-black">What Sentinel gives your AI</h3>
            </div>
            <ul className="space-y-2">
              {MCP_TOOLS.map((t) => (
                <li key={t.name} className="text-sm text-ink-black flex items-start gap-2">
                  {t.gated ? <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" /> : <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />}
                  <span>{t.plain}</span>
                </li>
              ))}
            </ul>
            <Details>{MCP_TOOLS.map((t) => `${t.name}${t.gated ? '  → approval queue' : ''}`).join('\n')}</Details>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveExchange() {
  const ai = getAi(DEMO_EXCHANGE.ai);
  const p = getPerson(DEMO_EXCHANGE.personId);
  return (
    <div className="stone-card p-4 sm:p-5 bg-sky-wash/30">
      <div className="flex items-center gap-2 text-xs text-warm-gray">
        <MessageSquareText className="w-3.5 h-3.5 text-cyan-signal" />
        Just now in {ai.name}, asked by {p?.shortName ?? p?.name}
      </div>
      <div className="mt-3 flex items-start gap-3">
        <AiMark id={ai.id} size="sm" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-ink-black">“{DEMO_EXCHANGE.question}”</p>
          <p className="text-sm text-ink-black leading-relaxed">{DEMO_EXCHANGE.answer}</p>
          <div className="flex flex-wrap gap-1.5">
            {DEMO_EXCHANGE.sources.map((s) => (
              <span key={s} className="text-[11px] px-2 py-0.5 rounded-full border border-stone-border bg-surface text-warm-gray">{s}</span>
            ))}
          </div>
          <p className="text-[11px] text-ash-gray">Answered from Sentinel&apos;s memory, within {p?.shortName ?? p?.name}&apos;s Admin scope.</p>
        </div>
      </div>
    </div>
  );
}

function AiCard({ ai, open, onToggle }: { ai: AiClient; open: boolean; onToggle: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(SENTINEL_MCP_URL).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className={cn('stone-card overflow-hidden', open && 'border-cyan-edge/40')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 p-4 text-left">
        <AiMark id={ai.id} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-black">{ai.name} <span className="font-normal text-warm-gray">· {ai.maker}</span></p>
          <p className="text-xs text-warm-gray mt-0.5">
            {ai.connected ? `${ai.userIds.length} people · ${ai.lookupsToday} lookups today · last used ${ai.lastUsed}` : 'Not connected yet'}
          </p>
        </div>
        {ai.connected && <AvatarStack ids={ai.userIds} max={4} />}
        <span
          className={cn(
            'shrink-0 px-2 py-0.5 rounded-full border text-[11px] font-medium',
            ai.connected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-100 text-stone-600 border-stone-border',
          )}
        >
          {ai.connected ? 'Connected' : 'Not connected'}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-stone-border">
          <p className="text-xs font-medium text-ink-black pt-3">Add Sentinel to {ai.name}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs px-3 h-9 inline-flex items-center rounded-inputs border border-stone-border bg-stone-canvas text-ink-black">{SENTINEL_MCP_URL}</code>
            <button type="button" onClick={copy} className="btn-ghost text-xs h-9 px-3 inline-flex items-center gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ol className="space-y-1.5">
            {ai.steps.map((s, i) => (
              <li key={s} className="flex items-start gap-2 text-sm text-ink-black">
                <span className="w-5 h-5 shrink-0 rounded-full bg-inverse text-white text-[11px] inline-flex items-center justify-center">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <p className="text-xs text-warm-gray">Each person signs in with their own account, so their AI only sees what they are allowed to see.</p>
        </div>
      )}
    </div>
  );
}
