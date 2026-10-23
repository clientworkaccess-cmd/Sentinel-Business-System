'use client';

import React, { useState } from 'react';
import { ScanSearch } from 'lucide-react';
import { XRAY_TARGETS, type XrayTarget } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { Details, LocalBadge, PanelHeader, RiskBadge } from './parts';

const CAP_STYLE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  watch: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-rose-200 bg-rose-50 text-rose-700',
};

/** AI X-ray: look inside a connector or MCP server before you turn it on. */
export function XrayPanel() {
  const [selected, setSelected] = useState<XrayTarget>(XRAY_TARGETS[0]);
  const [scanning, setScanning] = useState(false);

  const pick = (t: XrayTarget) => {
    setScanning(true);
    setTimeout(() => { setSelected(t); setScanning(false); }, 700);
  };

  return (
    <div className="space-y-6">
      <PanelHeader
        title="AI X-ray"
        hint="Before you or your team turn on a new AI tool or MCP server, Sentinel looks inside: what it can reach, where it sends data, and whether its instructions hide anything."
        action={<LocalBadge text="Checked on this machine" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          {XRAY_TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t)}
              className={cn('w-full text-left stone-card p-3.5 transition', selected.id === t.id ? 'border-cyan-edge/60' : 'hover:border-stone-border')}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-black truncate">{t.name}</p>
                <RiskBadge risk={t.verdict} />
              </div>
              <p className="text-xs text-warm-gray mt-1">{t.source}</p>
            </button>
          ))}
          <p className="text-xs text-ash-gray px-1">Opened automatically when someone adds a connector from the gallery.</p>
        </div>

        <div className="lg:col-span-2 stone-card p-5 space-y-4">
          {scanning ? (
            <div className="py-14 flex flex-col items-center gap-3 text-warm-gray">
              <ScanSearch className="w-8 h-8 text-cyan-signal animate-pulse" />
              <p className="text-sm">Reading tool descriptions and network endpoints…</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg text-ink-black">{selected.name}</p>
                  <p className="text-xs text-warm-gray">{selected.source}</p>
                </div>
                <RiskBadge risk={selected.verdict} />
              </div>
              <p className="text-sm text-ink-black">{selected.summary}</p>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-2">What it can do</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {selected.caps.map((c) => (
                    <div key={c.label} className={cn('rounded-md border px-3 py-2', CAP_STYLE[c.level])}>
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="text-xs opacity-90">{c.why}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-2">What we found</p>
                <ul className="space-y-2">
                  {selected.findings.map((f) => (
                    <li key={f.text} className="flex items-start gap-2.5">
                      <RiskBadge risk={f.risk} className="shrink-0" />
                      <span className="text-sm text-ink-black">{f.text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap gap-2">
                {selected.verdict === 'act_now' || selected.verdict === 'high' ? (
                  <>
                    <button type="button" className="btn-cyan text-xs h-8 px-3">Keep it off</button>
                    <button type="button" className="btn-ghost text-xs h-8 px-3">Tell the person who added it</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn-cyan text-xs h-8 px-3">Turn it on</button>
                    <button type="button" className="btn-ghost text-xs h-8 px-3">Turn on with “ask before public writes”</button>
                  </>
                )}
              </div>
              <Details>{selected.details}</Details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
