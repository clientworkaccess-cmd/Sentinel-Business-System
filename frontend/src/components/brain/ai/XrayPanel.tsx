'use client';

import React, { useState } from 'react';
import { XRAY_TARGETS, type Tone, type XrayTarget } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { Chip, Details, PanelHeader, RiskBadge } from './parts';

const LEVEL_TONE: Record<XrayTarget['permissions'][number]['level'], Tone> = { ok: 'green', watch: 'amber', danger: 'red' };

/** AI X-ray: check an MCP server's tools and instructions before you turn it on. */
export function XrayPanel() {
  const [selected, setSelected] = useState<XrayTarget>(XRAY_TARGETS[0]);
  const [scanning, setScanning] = useState(false);
  const risky = selected.verdict === 'act_now' || selected.verdict === 'high';

  const pick = (t: XrayTarget) => {
    setScanning(true);
    setTimeout(() => { setSelected(t); setScanning(false); }, 600);
  };

  return (
    <div className="space-y-6">
      <PanelHeader title="AI X-ray" hint="Check an AI tool or MCP server before you turn it on." />

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
        </div>

        <div className="lg:col-span-2 stone-card p-5 space-y-4">
          {scanning ? (
            <p className="py-14 text-center text-sm text-warm-gray animate-pulse">Scanning…</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg text-ink-black">{selected.name}</p>
                  <p className="text-sm text-ink-black mt-0.5">{selected.summary}</p>
                </div>
                <RiskBadge risk={selected.verdict} />
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-2">Permissions</p>
                <div className="flex flex-wrap gap-2">
                  {selected.permissions.map((c) => <Chip key={c.label} tone={LEVEL_TONE[c.level]}>{c.label}</Chip>)}
                </div>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-2">Findings</p>
                <ul className="space-y-1 list-disc pl-5">
                  {selected.findings.map((f) => <li key={f} className="text-sm text-ink-black">{f}</li>)}
                </ul>
              </div>

              <div className="flex flex-wrap gap-2">
                {risky ? (
                  <>
                    <button type="button" className="btn-cyan text-xs h-8 px-3">Block</button>
                    <button type="button" className="btn-ghost text-xs h-8 px-3">Notify who added it</button>
                  </>
                ) : (
                  <button type="button" className="btn-cyan text-xs h-8 px-3">Turn on</button>
                )}
              </div>
              <Details label="Technical details">{selected.details}</Details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
