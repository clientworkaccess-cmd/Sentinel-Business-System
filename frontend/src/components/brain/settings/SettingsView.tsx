'use client';

import React, { useState } from 'react';
import { Bot, Users } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { isOwnerRole } from '@/types';
import { cn } from '@/lib/utils';
import { SentinelSettingsForm } from './SentinelSettingsForm';
import { TeamPanel } from './TeamPanel';

type Tab = 'sentinel' | 'team';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'sentinel', label: 'Sentinel', icon: Bot },
  { id: 'team', label: 'Team', icon: Users },
];

/** /brain/settings: the assistant's configuration and the team roster. Owner-only. */
export function SettingsView() {
  const role = useAuthStore((s) => s.user?.role);
  const [tab, setTab] = useState<Tab>('sentinel');

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-display text-[32px] leading-tight text-ink-black">Settings</h1>
        <p className="text-sm text-warm-gray mt-1">How Sentinel works for your company, and who is on the team.</p>
      </div>

      {!isOwnerRole(role) ? (
        <p className="text-sm text-warm-gray">Only the Owner can change settings.</p>
      ) : (
        <>
          <div role="tablist" aria-label="Settings sections" className="flex gap-1.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                id={`settings-tab-${id}`}
                role="tab"
                aria-selected={tab === id}
                aria-controls={`settings-panel-${id}`}
                onClick={() => setTab(id)}
                className={cn(
                  'shrink-0 px-3.5 h-8 rounded-full text-xs font-medium border transition inline-flex items-center gap-1.5',
                  tab === id ? 'bg-inverse text-white border-transparent' : 'bg-white border-stone-border text-warm-gray hover:text-ink-black',
                )}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <div id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
            {tab === 'sentinel' ? <SentinelSettingsForm /> : <TeamPanel />}
          </div>
        </>
      )}
    </div>
  );
}
