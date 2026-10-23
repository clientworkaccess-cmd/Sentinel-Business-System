'use client';

import React, { useMemo, useState } from 'react';
import { ACCESS_LOG, AI_CLIENTS, LOOKUPS_TODAY, getAi, type AiId } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { PanelHeader, PersonChip, ResultBadge, Stat } from './parts';

/** Every lookup a connected AI makes through Sentinel: who, which AI, what, and the result. */
export function AccessPanel() {
  const [ai, setAi] = useState<AiId | 'all'>('all');
  const rows = useMemo(() => ACCESS_LOG.filter((r) => ai === 'all' || r.ai === ai), [ai]);

  return (
    <div className="space-y-6">
      <PanelHeader title="Access log" hint="Every lookup an AI makes through Sentinel." />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Lookups today" value={LOOKUPS_TODAY} />
        <Stat label="Blocked" value={ACCESS_LOG.filter((r) => r.result === 'blocked').length} />
        <Stat label="Partly hidden" value={ACCESS_LOG.filter((r) => r.result === 'partial').length} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['all', ...AI_CLIENTS.filter((a) => a.connected).map((a) => a.id)] as (AiId | 'all')[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setAi(id)}
            className={cn('px-3 h-8 rounded-full text-xs font-medium border transition', ai === id ? 'bg-inverse text-white border-transparent' : 'bg-surface border-stone-border text-warm-gray hover:text-ink-black')}
          >
            {id === 'all' ? 'All' : getAi(id).name}
          </button>
        ))}
      </div>

      <div className="stone-card overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ash-gray border-b border-stone-border">
              <th className="px-4 py-2.5 font-medium">Time</th>
              <th className="px-4 py-2.5 font-medium">Person</th>
              <th className="px-4 py-2.5 font-medium">AI</th>
              <th className="px-4 py-2.5 font-medium">Searched for</th>
              <th className="px-4 py-2.5 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.time}-${r.personId}`} className="border-b border-stone-border last:border-0 align-top">
                <td className="px-4 py-3 text-warm-gray tabular-nums">{r.time}</td>
                <td className="px-4 py-3"><PersonChip id={r.personId} /></td>
                <td className="px-4 py-3 text-xs text-ink-black">{getAi(r.ai).name}</td>
                <td className="px-4 py-3 text-ink-black">
                  {r.searched}
                  <p className="text-xs text-warm-gray mt-0.5">{r.note ?? `${r.sources} sources`}</p>
                </td>
                <td className="px-4 py-3"><ResultBadge result={r.result} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
