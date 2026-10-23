'use client';

import React, { useMemo, useState } from 'react';
import { ACCESS_LOG, AI_CLIENTS, getAi, type AiId } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { AiMark, PanelHeader, PersonChip, ResultBadge, Stat } from './parts';

/** Which AI read what, on whose behalf. Every lookup through Sentinel is logged. */
export function AccessPanel() {
  const [ai, setAi] = useState<AiId | 'all'>('all');
  const rows = useMemo(() => ACCESS_LOG.filter((r) => ai === 'all' || r.ai === ai), [ai]);
  const blocked = ACCESS_LOG.filter((r) => r.result === 'blocked').length;
  const withheld = ACCESS_LOG.filter((r) => r.withheld).length;

  return (
    <div className="space-y-6">
      <PanelHeader
        title="Access log"
        hint="Every time a connected AI looks something up, Sentinel records who asked, which AI, what it read and what it held back. Nothing is hidden from the Owner."
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Lookups today" value={128} />
        <Stat label="Blocked by role" value={blocked} hint="Outside that person's scope" />
        <Stat label="Partly withheld" value={withheld} hint="Some sources held back" />
        <Stat label="Kept for" value="1 year" hint="Exportable for audits" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['all', ...AI_CLIENTS.filter((a) => a.connected).map((a) => a.id)] as (AiId | 'all')[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setAi(id)}
            className={cn('px-3 h-8 rounded-full text-xs font-medium border transition', ai === id ? 'bg-inverse text-white border-transparent' : 'bg-surface border-stone-border text-warm-gray hover:text-ink-black')}
          >
            {id === 'all' ? 'All AIs' : getAi(id).name}
          </button>
        ))}
      </div>

      <div className="stone-card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ash-gray border-b border-stone-border">
              <th className="px-4 py-2.5 font-medium">Time</th>
              <th className="px-4 py-2.5 font-medium">Person</th>
              <th className="px-4 py-2.5 font-medium">AI</th>
              <th className="px-4 py-2.5 font-medium">What it looked up</th>
              <th className="px-4 py-2.5 font-medium">Scope</th>
              <th className="px-4 py-2.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.time}-${r.personId}`} className="border-b border-stone-border last:border-0 align-top">
                <td className="px-4 py-3 text-warm-gray tabular-nums">{r.time}</td>
                <td className="px-4 py-3"><PersonChip id={r.personId} /></td>
                <td className="px-4 py-3"><span className="inline-flex items-center gap-2"><AiMark id={r.ai} size="sm" /><span className="text-xs">{getAi(r.ai).name}</span></span></td>
                <td className="px-4 py-3 text-ink-black">
                  {r.lookedUp}
                  <p className="text-xs text-warm-gray mt-0.5">{r.sources ? `${r.sources} sources returned` : 'No sources returned'}{r.withheld ? ` · ${r.withheld}` : ''}</p>
                </td>
                <td className="px-4 py-3 text-xs text-warm-gray">{r.scope}</td>
                <td className="px-4 py-3"><ResultBadge result={r.result} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
