'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, Search, X } from 'lucide-react';
import { CATEGORY_LABELS, CONNECTORS, type Connector, type ConnectorCategory } from '@/demo/connectors';
import { useConnectorsStore } from '@/stores/useConnectorsStore';
import { cn } from '@/lib/utils';
import { ConnectModal } from './ConnectModal';
import { ConnectorLogo } from './ConnectorLogo';

type Filter = 'all' | 'connected' | ConnectorCategory;

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ConnectorCategory[];

export function ConnectorsView() {
  const status = useConnectorsStore((s) => s.status);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Connector | null>(null);

  // Deep links like ?category=meetings (from the Meetings page). Read after mount:
  // useSearchParams would need a Suspense boundary that can stall hydration.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('category');
    if (c && (c === 'connected' || c in CATEGORY_LABELS)) setFilter(c as Filter);
  }, []);

  const connectedCount = CONNECTORS.filter((c) => status[c.id] === 'connected').length;

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: CONNECTORS.length, connected: connectedCount };
    for (const c of CONNECTORS) m[c.category] = (m[c.category] ?? 0) + 1;
    return m;
  }, [connectedCount]);

  const q = query.trim().toLowerCase();
  const shown = CONNECTORS.filter((c) => {
    if (filter === 'connected' && status[c.id] !== 'connected') return false;
    if (filter !== 'all' && filter !== 'connected' && c.category !== filter) return false;
    if (!q) return true;
    return [c.name, c.description, CATEGORY_LABELS[c.category], ...c.syncs].some((s) => s.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] leading-tight text-ink-black">Connectors</h1>
          <p className="text-sm text-warm-gray mt-1">
            Connect the tools your team already uses. Sentinel reads them, links everything together, and respects who can see what.
          </p>
        </div>
        <div className="flex items-center gap-5 text-sm">
          <Stat value={connectedCount} label="connected" accent />
          <Stat value={CONNECTORS.length} label="in this gallery" />
          <Stat value="500+" label="via Composio" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="relative block max-w-md">
          <span className="sr-only">Search apps</span>
          <Search className="w-4 h-4 text-ash-gray absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search 54 apps: Gmail, WhatsApp, Jira…"
            className="w-full h-11 pl-10 pr-9 rounded-full border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-ash-gray hover:text-ink-black">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </label>

        <div role="tablist" aria-label="Categories" className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {(['all', 'connected', ...CATEGORIES] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'shrink-0 px-3 h-8 rounded-full text-xs font-medium border transition whitespace-nowrap',
                filter === f ? 'bg-inverse text-white border-transparent' : 'bg-white border-stone-border text-warm-gray hover:text-ink-black',
              )}
            >
              {f === 'all' ? 'All' : f === 'connected' ? 'Connected' : CATEGORY_LABELS[f]}
              <span className={cn('ml-1.5 tabular-nums', filter === f ? 'text-white/60' : 'text-ash-gray')}>{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="stone-card p-10 text-center">
          <p className="text-sm text-ink-black">No app matches “{query}”.</p>
          <p className="text-xs text-warm-gray mt-1">Sentinel reaches 500+ more apps through Composio. Request it and we&apos;ll add it to the gallery.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {shown.map((c) => (
            <ConnectorCard key={c.id} connector={c} state={status[c.id]} onOpen={() => setOpen(c)} />
          ))}
          {filter === 'all' && !q && <RequestCard />}
        </div>
      )}

      {open && <ConnectModal connector={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Stat({ value, label, accent }: { value: number | string; label: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <p className={cn('font-display text-2xl leading-none tabular-nums', accent ? 'text-cyan-edge' : 'text-ink-black')}>{value}</p>
      <p className="text-[11px] text-warm-gray mt-1">{label}</p>
    </div>
  );
}

function ConnectorCard({ connector: c, state, onOpen }: { connector: Connector; state: Connector['status']; onOpen: () => void }) {
  const connected = state === 'connected';
  const soon = state === 'coming_soon';
  return (
    <div className="group stone-card p-4 flex flex-col gap-3 hover:shadow-preview hover:-translate-y-0.5 transition duration-200">
      <div className="flex items-start gap-3">
        <ConnectorLogo connector={c} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-black truncate">{c.name}</p>
          <p className="text-[11px] text-ash-gray truncate">{CATEGORY_LABELS[c.category]}</p>
        </div>
        {connected && (
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700 inline-flex items-center gap-1 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Connected
          </span>
        )}
      </div>
      <p className="text-xs text-warm-gray leading-relaxed line-clamp-2 min-h-[2.5rem]">{c.description}</p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[11px] text-ash-gray truncate">{c.syncs.join(' · ')}</span>
        {soon ? (
          <span className="text-xs text-ash-gray px-3 py-1.5 shrink-0">Coming soon</span>
        ) : connected ? (
          <button onClick={onOpen} className="btn-ghost text-xs px-3 py-1.5 shrink-0">Manage</button>
        ) : (
          <button onClick={onOpen} className="btn-cyan text-xs px-3 py-1.5 shrink-0 inline-flex items-center gap-1">
            Connect <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function RequestCard() {
  return (
    <div className="rounded-cards border border-dashed border-stone-muted p-4 flex flex-col items-start justify-center gap-2 text-left">
      <span className="w-11 h-11 rounded-xl border border-dashed border-stone-muted flex items-center justify-center text-warm-gray">
        <Plus className="w-5 h-5" />
      </span>
      <p className="text-sm font-medium text-ink-black">500+ more apps</p>
      <p className="text-xs text-warm-gray">Any app on Composio can be connected. Ask and it shows up here.</p>
    </div>
  );
}
