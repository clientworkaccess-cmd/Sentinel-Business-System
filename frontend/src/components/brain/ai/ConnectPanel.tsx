'use client';

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { AI_CLIENTS, LATEST_LOOKUP, MCP_TOOLS, SCOPE_BY_ROLE, SENTINEL_MCP_URL, getAi, type AiClient } from '@/demo/ai';
import { getPerson } from '@/demo/org';
import { useBrainStore } from '@/stores/useBrainStore';
import { cn } from '@/lib/utils';
import { AvatarStack } from '../atoms';
import { AiMark, Chip, PanelHeader, Stat } from './parts';

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
      <PanelHeader title="Connect AI" hint="Add Sentinel to Claude, ChatGPT or Cursor. Each person's AI only sees what their role allows." />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="AI tools connected" value={connected.length} />
        <Stat label="People using it" value={people} />
        <Stat label="Lookups today" value={lookups} />
      </div>

      <LatestLookup />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-3">
          {AI_CLIENTS.map((ai) => (
            <AiCard key={ai.id} ai={ai} open={open === ai.id} onToggle={() => setOpen(open === ai.id ? null : ai.id)} />
          ))}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="stone-card p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-ink-black">What the AI can see</h3>
              <p className="text-xs text-warm-gray mt-0.5">Viewing as {scope.who}</p>
            </div>
            <ScopeList label="Can see" items={scope.sees} />
            <ScopeList label="Hidden" items={scope.hidden} muted />
          </div>

          <div className="stone-card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-ink-black">What the AI can do</h3>
            <ul className="space-y-1.5">
              {MCP_TOOLS.map((t) => (
                <li key={t.plain} className="flex items-center justify-between gap-2 text-sm text-ink-black">
                  {t.plain}
                  {t.gated && <Chip tone="amber">Needs approval</Chip>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScopeList({ label, items, muted }: { label: string; items: string[]; muted?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-1">{label}</p>
      <ul className="space-y-1">
        {items.map((s) => <li key={s} className={cn('text-sm', muted ? 'text-warm-gray' : 'text-ink-black')}>{s}</li>)}
      </ul>
    </div>
  );
}

/** What Sentinel actually sees: the AI's search and the sources it returned (not the chat). */
function LatestLookup() {
  const ai = getAi(LATEST_LOOKUP.ai);
  const p = getPerson(LATEST_LOOKUP.personId);
  return (
    <div className="stone-card p-4 flex items-start gap-3">
      <AiMark id={ai.id} size="sm" />
      <div className="min-w-0 space-y-1">
        <p className="text-xs text-warm-gray">Latest lookup · {p?.shortName ?? p?.name} via {ai.name} · just now</p>
        <p className="text-sm text-ink-black">Searched for “{LATEST_LOOKUP.query}”</p>
        <p className="text-xs text-warm-gray">Returned: {LATEST_LOOKUP.sources.join(' · ')}</p>
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
          <p className="text-sm font-semibold text-ink-black">{ai.name}</p>
          <p className="text-xs text-warm-gray mt-0.5">{ai.connected ? `${ai.userIds.length} people · ${ai.lookupsToday} lookups today` : 'Not connected'}</p>
        </div>
        {ai.connected && <AvatarStack ids={ai.userIds} max={4} />}
        <Chip tone={ai.connected ? 'green' : 'gray'}>{ai.connected ? 'Connected' : 'Off'}</Chip>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 space-y-3 border-t border-stone-border">
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs px-3 h-9 inline-flex items-center rounded-inputs border border-stone-border bg-stone-canvas text-ink-black">{SENTINEL_MCP_URL}</code>
            <button type="button" onClick={copy} className="btn-ghost text-xs h-9 px-3 inline-flex items-center gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ol className="space-y-1.5">
            {ai.steps.map((s, i) => (
              <li key={s} className="flex items-start gap-2 text-sm text-ink-black">
                <span className="w-5 h-5 shrink-0 rounded-full bg-stone-100 text-ink-black text-[11px] inline-flex items-center justify-center">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
