'use client';

import React, { useState } from 'react';
import { FolderLock, Laptop, Sparkle } from 'lucide-react';
import { ACTIVITY, ACTIVITY_TOTALS, DETECTED_AGENTS, LABELLED_FOLDERS, type ActivitySession } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { Details, LocalBadge, PanelHeader, ResultBadge, RiskBadge, Stat } from './parts';

/**
 * What AI agents did on this laptop, read from their own session logs by the
 * Sentinel desktop agent. Visibility after the fact: it shows, it does not block
 * (blocks shown here come from the agent's own hooks and rules).
 */
export function ActivityPanel() {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const flagged = ACTIVITY.flatMap((x) => x.events).filter((e) => e.flag).length;

  return (
    <div className="space-y-6">
      <PanelHeader
        title="What AI agents did on this laptop"
        hint="The Sentinel desktop agent reads the activity logs that Claude Code and Codex already keep, and shows them as a story you can follow. Folders you label are flagged when an agent touches them."
        action={<LocalBadge />}
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Files looked at" value={ACTIVITY_TOTALS.read} />
        <Stat label="Files changed or moved" value={ACTIVITY_TOTALS.changed} />
        <Stat label="Commands run" value={ACTIVITY_TOTALS.commands} />
        <Stat label="Websites contacted" value={ACTIVITY_TOTALS.web} />
        <Stat label="Touched labelled folders" value={flagged} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <label className="inline-flex items-center gap-2 text-xs text-warm-gray">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="accent-cyan-500" />
            Only show what touched a labelled folder
          </label>
          {ACTIVITY.map((s) => <SessionCard key={s.id} s={s} onlyFlagged={onlyFlagged} />)}
        </div>

        <div className="space-y-4">
          <div className="stone-card p-4 space-y-2.5">
            <div className="flex items-center gap-2"><FolderLock className="w-4 h-4 text-cyan-signal" /><h3 className="text-sm font-semibold text-ink-black">Labelled folders</h3></div>
            {LABELLED_FOLDERS.map((f) => (
              <div key={f.path} className="flex items-center justify-between gap-2">
                <code className="text-xs text-ink-black truncate">{f.path}</code>
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-stone-border text-warm-gray shrink-0">{f.label}</span>
              </div>
            ))}
            <button type="button" className="btn-ghost text-xs h-8 px-3 w-full">Label a folder</button>
            <p className="text-[11px] text-ash-gray">You choose the labels. Sentinel doesn&apos;t guess what is confidential.</p>
          </div>

          <div className="stone-card p-4 space-y-2.5">
            <div className="flex items-center gap-2"><Laptop className="w-4 h-4 text-cyan-signal" /><h3 className="text-sm font-semibold text-ink-black">Agents on this laptop</h3></div>
            {DETECTED_AGENTS.map((a) => (
              <div key={a.name}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-ink-black">{a.name}</p>
                  <span className={cn('text-[11px] px-2 py-0.5 rounded-full border', a.status === 'Watched' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : a.status === 'Partly' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-stone-border bg-stone-100 text-stone-600')}>{a.status}</span>
                </div>
                <p className="text-xs text-warm-gray">{a.how}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionCard({ s, onlyFlagged }: { s: ActivitySession; onlyFlagged: boolean }) {
  const events = onlyFlagged ? s.events.filter((e) => e.flag) : s.events;
  if (events.length === 0) return null;
  return (
    <section className="stone-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-ink-black">{s.agent}: “{s.task}”</p>
        <span className="text-xs text-warm-gray">{s.folder} · started {s.started}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded border border-stone-border text-ash-gray ml-auto">Session {s.id}</span>
      </div>
      <ol className="relative border-l border-stone-border ml-1.5 space-y-3">
        {events.map((e) => (
          <li key={`${e.time}-${e.text}`} className="pl-4 relative">
            <span className={cn('absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-surface', e.flag ? 'bg-amber-500' : e.result === 'blocked' ? 'bg-rose-500' : 'bg-stone-border')} />
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <span className="text-xs text-warm-gray tabular-nums w-10 shrink-0">{e.time}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-black">
                  {e.text}
                  {e.firstTime && <span className="ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-cyan-signal"><Sparkle className="w-3 h-3" />First time</span>}
                </p>
                <code className="text-xs text-warm-gray break-all">{e.target}</code>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {e.flag && <span className="text-[11px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">{e.flag}</span>}
                <ResultBadge result={e.result} />
                {e.risk !== 'low' && <RiskBadge risk={e.risk} />}
              </div>
            </div>
            <div className="pl-12 mt-1"><Details>{e.detail}</Details></div>
          </li>
        ))}
      </ol>
    </section>
  );
}
