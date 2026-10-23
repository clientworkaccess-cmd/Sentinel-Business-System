'use client';

import React, { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { FEATURE_MODELS, MODEL_PROVIDERS, USAGE } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { Mark, PanelHeader, PersonChip, Stat } from './parts';

/** Bring your own model (Qwen by default on Alibaba Cloud) and what it all costs. */
export function ModelUsagePanel() {
  return (
    <div className="space-y-8">
      <ModelSection />
      <UsageSection />
    </div>
  );
}

function ModelSection() {
  const [active, setActive] = useState('qwen');
  const [testing, setTesting] = useState(false);
  const [ok, setOk] = useState<Record<string, boolean>>({ qwen: true });
  const provider = MODEL_PROVIDERS.find((p) => p.id === active)!;

  const test = () => {
    setTesting(true);
    setTimeout(() => { setTesting(false); setOk((o) => ({ ...o, [active]: true })); }, 900);
  };

  return (
    <section className="space-y-4">
      <PanelHeader title="AI model" hint="Sentinel uses Qwen on Alibaba Cloud by default. You can use your own key instead." />
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {MODEL_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p.id)}
            className={cn('stone-card p-3 text-left transition', active === p.id ? 'border-cyan-edge/60' : 'hover:border-stone-border')}
          >
            <div className="flex items-center gap-2">
              <Mark name={p.name} color={p.color} size="sm" letters={p.mark} />
              <p className="text-sm font-semibold text-ink-black">{p.name}</p>
            </div>
            <p className={cn('text-[11px] mt-1.5', ok[p.id] ? 'text-emerald-700' : 'text-ash-gray')}>{p.default ? 'Default' : ok[p.id] ? 'Connected' : 'Not set up'}</p>
          </button>
        ))}
      </div>

      <div className="stone-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <label className="block">
          <span className="text-xs text-warm-gray">API key</span>
          <span className="mt-1 flex items-center gap-2 h-10 px-3 rounded-inputs border border-stone-border bg-surface">
            <KeyRound className="w-3.5 h-3.5 text-ash-gray" />
            <input
              type="password"
              defaultValue={provider.id === 'qwen' ? 'sk-qwen-demo-key-hidden' : ''}
              placeholder={`${provider.name} API key`}
              className="flex-1 min-w-0 bg-transparent text-sm text-ink-black placeholder:text-ash-gray focus:outline-none"
            />
          </span>
        </label>
        <label className="block">
          <span className="text-xs text-warm-gray">Model</span>
          <select className="mt-1 w-full h-10 px-3 rounded-inputs border border-stone-border bg-surface text-sm text-ink-black">
            {provider.models.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <button type="button" onClick={test} className="btn-cyan text-sm h-10 inline-flex items-center justify-center gap-2">
          {testing && <Loader2 className="w-4 h-4 animate-spin" />}
          {testing ? 'Testing…' : ok[active] ? 'Connected' : 'Test connection'}
        </button>
      </div>

      <div className="stone-card p-4">
        <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-2">Model per feature</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {FEATURE_MODELS.map((f) => (
            <div key={f.feature} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-ink-black">{f.feature}</span>
              <code className="text-xs text-warm-gray">{f.model}</code>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function UsageSection() {
  const max = Math.max(...USAGE.daily);
  const pct = Math.round((USAGE.cost / USAGE.budget) * 100);
  const featureMax = Math.max(...USAGE.byFeature.map((f) => f.cost));
  return (
    <section className="space-y-4">
      <PanelHeader title={`Usage in ${USAGE.month}`} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Spent" value={`$${USAGE.cost.toFixed(2)}`} hint={`of $${USAGE.budget} budget`} />
        <Stat label="Tokens" value={`${(USAGE.tokens / 1_000_000).toFixed(1)}M`} />
        <Stat label="Transcribed" value={`${USAGE.transcriptionHours} h`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 stone-card p-4">
          <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-3">Cost per day (USD)</p>
          <div className="h-40 flex items-end gap-1.5" role="img" aria-label="Daily cost chart">
            {USAGE.daily.map((d, i) => (
              <div key={i} title={`$${d.toFixed(2)}`} className="flex-1 h-full flex items-end">
                <div className="w-full rounded-t bg-cyan-signal/70 hover:bg-cyan-signal" style={{ height: `${(d / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-stone-border overflow-hidden">
            <div className={cn('h-full rounded-full', pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <p className="text-xs text-warm-gray mt-1.5">{pct}% of budget used</p>
        </div>

        <div className="space-y-4">
          <div className="stone-card p-4 space-y-2.5">
            <p className="text-[11px] uppercase tracking-wider text-ash-gray">By feature</p>
            {USAGE.byFeature.map((f) => (
              <div key={f.label}>
                <div className="flex justify-between text-sm"><span className="text-ink-black">{f.label}</span><span className="text-warm-gray tabular-nums">${f.cost.toFixed(2)}</span></div>
                <div className="mt-1 h-1 rounded-full bg-stone-border"><div className="h-full rounded-full bg-cyan-signal/80" style={{ width: `${(f.cost / featureMax) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="stone-card p-4 space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-ash-gray">By person</p>
            {USAGE.byPerson.map((p) => (
              <div key={p.personId} className="flex items-center justify-between"><PersonChip id={p.personId} /><span className="text-sm text-warm-gray tabular-nums">${p.cost.toFixed(2)}</span></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
