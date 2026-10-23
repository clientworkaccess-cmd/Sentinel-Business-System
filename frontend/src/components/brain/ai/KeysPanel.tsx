'use client';

import React, { useState } from 'react';
import { KEYS } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { Mark, PanelHeader, PersonChip, RiskBadge, Stat } from './parts';

/** AI apps people connected to company Google and Slack accounts, with one click to remove. */
export function KeysPanel() {
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const live = KEYS.filter((k) => !removed[k.app]);

  return (
    <div className="space-y-6">
      <PanelHeader title="App access" hint="AI apps your team connected to company Google and Slack accounts." />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Apps with access" value={live.length} />
        <Stat label="Full access" value={live.filter((k) => k.fullAccess).length} />
        <Stat label="Unused 30+ days" value={live.filter((k) => k.unused).length} />
      </div>

      <div className="space-y-2">
        {KEYS.map((k) => {
          const gone = removed[k.app];
          return (
            <div key={k.app} className={cn('stone-card p-4 flex items-start gap-3', gone && 'opacity-50')}>
              <Mark name={k.app} color={k.color} />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold text-ink-black">{k.app} <span className="font-normal text-warm-gray">· {k.account}</span></p>
                <p className="text-sm text-ink-black">{k.canDo}{k.note && <span className="text-warm-gray"> · {k.note}</span>}</p>
                <p className="text-xs text-warm-gray inline-flex flex-wrap items-center gap-x-1.5">Added by <PersonChip id={k.connectedById} /> · last used {k.lastUsed}</p>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <RiskBadge risk={k.risk} />
                <button type="button" onClick={() => setRemoved((r) => ({ ...r, [k.app]: !gone }))} className="btn-ghost text-xs h-8 px-3">
                  {gone ? 'Undo' : 'Remove'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ash-gray">From Google Workspace admin settings. Removing access signs the app out.</p>
    </div>
  );
}
