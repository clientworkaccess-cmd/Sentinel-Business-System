'use client';

import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { KEYS } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { Mark, PanelHeader, PersonChip, RiskBadge, Stat } from './parts';

/** "Who has keys to your business": AI apps people connected to company accounts. */
export function KeysPanel() {
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const live = KEYS.filter((k) => !removed[k.app]);
  const broad = live.filter((k) => k.broad).length;
  const sendEmail = live.filter((k) => /send/i.test(k.canDo) && k.app !== 'Sentinel').length;

  return (
    <div className="space-y-6">
      <PanelHeader
        title="Who has keys to your business"
        hint="AI apps your team connected to company Gmail, Drive, Calendar and Slack with “Sign in with Google”. What each can do, in plain words, and one click to take access back."
      />

      <div className="stone-card p-4 flex items-start gap-3 bg-amber-50 border-amber-200">
        <KeyRound className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <p className="text-sm text-ink-black">
          <span className="font-semibold">{live.length} AI apps can reach your company accounts.</span>{' '}
          {broad} can read everything in an inbox or Drive, and {sendEmail} can email clients without going through Sentinel&apos;s approvals.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="AI apps with access" value={live.length} />
        <Stat label="Full inbox or Drive" value={broad} />
        <Stat label="Can email clients directly" value={sendEmail} hint="Bypasses approvals" />
        <Stat label="Unused for 30+ days" value={live.filter((k) => /days ago/.test(k.lastUsed)).length} />
      </div>

      <div className="space-y-2">
        {KEYS.map((k) => {
          const gone = removed[k.app];
          return (
            <div key={k.app} className={cn('stone-card p-4 flex flex-wrap sm:flex-nowrap items-start gap-3', gone && 'opacity-50')}>
              <Mark name={k.app} color={k.color} />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-semibold text-ink-black">
                  {k.app} <span className="font-normal text-warm-gray">· {k.account}</span>
                </p>
                <p className="text-sm text-ink-black">{k.canDo}</p>
                <p className="text-xs text-warm-gray inline-flex flex-wrap items-center gap-x-2">Connected by <PersonChip id={k.connectedById} /> · last used {k.lastUsed}</p>
                {k.note && <p className="text-xs text-warm-gray">{k.note}</p>}
              </div>
              <div className="flex sm:flex-col items-end gap-2 shrink-0">
                <RiskBadge risk={k.risk} />
                {k.app !== 'Sentinel' && (
                  <button
                    type="button"
                    onClick={() => setRemoved((r) => ({ ...r, [k.app]: !gone }))}
                    className={cn('text-xs h-8 px-3', gone ? 'btn-ghost' : 'btn-cyan')}
                  >
                    {gone ? 'Undo' : 'Remove access'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ash-gray">Read from your Google Workspace and Slack admin settings. Removing access here revokes the app&apos;s sign-in; the person can reconnect through Sentinel instead.</p>
    </div>
  );
}
