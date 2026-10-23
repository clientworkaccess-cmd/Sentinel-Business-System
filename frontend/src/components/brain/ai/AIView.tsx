'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Activity, ClipboardCheck, Cpu, KeyRound, ListChecks, Plug, ScanSearch, ScrollText } from 'lucide-react';
import { AI_APPROVALS } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { AccessPanel } from './AccessPanel';
import { ActivityPanel } from './ActivityPanel';
import { ApprovalsPanel } from './ApprovalsPanel';
import { ConnectPanel } from './ConnectPanel';
import { KeysPanel } from './KeysPanel';
import { ModelUsagePanel } from './ModelUsagePanel';
import { LangProvider } from './parts';
import { RulesPanel } from './RulesPanel';
import { XrayPanel } from './XrayPanel';

const TABS = [
  { id: 'connect', label: 'Connect your AI', icon: Plug, Panel: ConnectPanel },
  { id: 'approvals', label: 'Approvals', icon: ClipboardCheck, Panel: ApprovalsPanel, badge: AI_APPROVALS.length },
  { id: 'rules', label: 'Rules', icon: ListChecks, Panel: RulesPanel },
  { id: 'access', label: 'Access log', icon: ScrollText, Panel: AccessPanel },
  { id: 'keys', label: 'Keys to your business', icon: KeyRound, Panel: KeysPanel },
  { id: 'xray', label: 'AI X-ray', icon: ScanSearch, Panel: XrayPanel },
  { id: 'activity', label: 'Agent activity', icon: Activity, Panel: ActivityPanel },
  { id: 'model', label: 'Model & usage', icon: Cpu, Panel: ModelUsagePanel },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** /brain/ai: the company memory, plugged into every AI your team uses, and kept in check. */
export function AIView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'connect') as TabId;
  const { Panel } = TABS.find((t) => t.id === current)!;

  return (
    <LangProvider>
      <div className="space-y-6 min-w-0">
        <div>
          <h1 className="font-display text-[32px] leading-tight text-ink-black">AI &amp; Agents</h1>
          <p className="text-sm text-warm-gray mt-1 max-w-3xl">
            Every AI is smart, but it doesn&apos;t remember your company. Sentinel is the memory it&apos;s missing: plugged into the AI your team already uses, with each person seeing only their part.
          </p>
        </div>

        <div role="tablist" aria-label="AI and agents sections" className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {TABS.map(({ id, label, icon: Icon, ...rest }) => {
            const badge = 'badge' in rest ? rest.badge : undefined;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={current === id}
                onClick={() => router.replace(`${pathname}?tab=${id}`, { scroll: false })}
                className={cn(
                  'shrink-0 px-3.5 h-8 rounded-full text-xs font-medium border transition inline-flex items-center gap-1.5 whitespace-nowrap',
                  current === id ? 'bg-inverse text-white border-transparent' : 'bg-surface border-stone-border text-warm-gray hover:text-ink-black',
                )}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
                {badge ? <span className="ml-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] inline-flex items-center justify-center">{badge}</span> : null}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" aria-label={TABS.find((t) => t.id === current)!.label}>
          <Panel />
        </div>
      </div>
    </LangProvider>
  );
}
