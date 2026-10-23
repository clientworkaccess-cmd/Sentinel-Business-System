'use client';

import React, { useState } from 'react';
import { ACTIVITY, ACTIVITY_TOTALS, DETECTED_AGENTS, PROTECTED_FOLDERS, type ActivitySession } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { Chip, PanelHeader, Stat } from './parts';

/**
 * What AI agents did on this laptop, read from their own session logs by the
 * Sentinel desktop agent. View only: blocks shown here come from the agent's own settings.
 */
export function ActivityPanel() {
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const flagged = ACTIVITY.flatMap((x) => x.events).filter((e) => e.flag).length;

  return (
    <div className="space-y-6">
      <PanelHeader title="Agent activity" hint="What AI agents did on this laptop, read from their own logs. Nothing is uploaded." />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Files read" value={ACTIVITY_TOTALS.read} />
        <Stat label="Files changed" value={ACTIVITY_TOTALS.changed} />
        <Stat label="Commands run" value={ACTIVITY_TOTALS.commands} />
        <Stat label="Protected folders touched" value={flagged} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <label className="inline-flex items-center gap-2 text-xs text-warm-gray">
            <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} className="accent-cyan-500" />
            Only protected folders
          </label>
          {ACTIVITY.map((s) => <SessionCard key={s.id} s={s} onlyFlagged={onlyFlagged} />)}
        </div>

        <div className="space-y-4">
          <div className="stone-card p-4 space-y-2.5">
            <h3 className="text-sm font-semibold text-ink-black">Protected folders</h3>
            {PROTECTED_FOLDERS.map((f) => (
              <div key={f.path} className="flex items-center justify-between gap-2">
                <code className="text-xs text-ink-black truncate">{f.path}</code>
                <span className="text-[11px] text-warm-gray shrink-0">{f.label}</span>
              </div>
            ))}
            <button type="button" className="btn-ghost text-xs h-8 px-3 w-full">Add folder</button>
          </div>

          <div className="stone-card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-ink-black">Agents on this laptop</h3>
            {DETECTED_AGENTS.map((a) => (
              <div key={a.name} className="flex items-center justify-between gap-2">
                <p className="text-sm text-ink-black">{a.name}</p>
                <Chip tone={a.status === 'Tracked' ? 'green' : a.status === 'Chat only' ? 'amber' : 'gray'}>{a.status}</Chip>
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
      <div>
        <p className="text-sm font-semibold text-ink-black">{s.agent} · {s.task}</p>
        <p className="text-xs text-warm-gray">{s.folder} · started {s.started}</p>
      </div>
      <ol className="divide-y divide-stone-border">
        {events.map((e) => (
          <li key={`${e.time}-${e.text}`} className="py-2 flex items-start gap-3">
            <span className="text-xs text-warm-gray tabular-nums w-10 shrink-0 pt-0.5">{e.time}</span>
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm', e.blocked ? 'text-ink-black font-medium' : 'text-ink-black')}>{e.text}</p>
              <code className="text-xs text-warm-gray break-all">{e.target}</code>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {e.flag && <Chip tone="amber">{e.flag}</Chip>}
              {e.blocked && <Chip tone="red">Blocked</Chip>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
