'use client';

import React, { useState } from 'react';
import { Check, KeyRound, Loader2 } from 'lucide-react';
import { FEATURE_MODELS, MODEL_PROVIDERS, PRICE_TABLE, USAGE } from '@/demo/ai';
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
  const [testing, setTesting] = useState<string | null>(null);
  const [ok, setOk] = useState<Record<string, boolean>>({ qwen: true });
  const provider = MODEL_PROVIDERS.find((p) => p.id === active)!;

  const test = () => {
    setTesting(active);
    setTimeout(() => { setTesting(null); setOk((o) => ({ ...o, [active]: true })); }, 900);
  };

  return (
    <section className="space-y-4">
      <PanelHeader
        title="Your AI model"
        hint="Sentinel runs on Qwen through Alibaba Cloud by default. You can bring your own key for Claude, GPT, Gemini or any OpenAI-compatible model. Keys stay on the server."
      />
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
            <p className="text-[11px] text-warm-gray mt-1.5 leading-snug">{p.maker}</p>
            <p className={cn('text-[11px] mt-1', ok[p.id] ? 'text-emerald-700' : 'text-ash-gray')}>{p.default ? 'Default · connected' : ok[p.id] ? 'Connected' : 'Not set up'}</p>
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
              placeholder={`Paste your ${provider.name} key`}
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
          {testing === active ? <Loader2 className="w-4 h-4 animate-spin" /> : ok[active] ? <Check className="w-4 h-4" /> : null}
          {testing === active ? 'Testing…' : ok[active] ? 'Connection works' : 'Test connection'}
        </button>
      </div>

      <div className="stone-card p-4">
        <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-2">Which model does what</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
      <PanelHeader title="Usage and cost" hint={`${USAGE.month} so far, across chat, extraction, transcription, voice and every connected AI.`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Spent this month" value={`$${USAGE.cost.toFixed(2)}`} hint={`${pct}% of the $${USAGE.budget} budget`} />
        <Stat label="Tokens" value={`${(USAGE.tokens / 1_000_000).toFixed(1)}M`} />
        <Stat label="Meetings transcribed" value={`${USAGE.transcriptionHours} h`} />
        <Stat label="Spoken replies" value={`${Math.round(USAGE.voiceChars / 1000)}k chars`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 stone-card p-4">
          <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-3">Cost per day (USD)</p>
          <div className="h-40 flex items-end gap-1.5" role="img" aria-label="Daily cost chart">
            {USAGE.daily.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group">
                <span className="text-[10px] text-warm-gray opacity-0 group-hover:opacity-100 transition">${d.toFixed(1)}</span>
                <div className="w-full rounded-t bg-cyan-signal/80 group-hover:bg-cyan-signal" style={{ height: `${(d / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-3 h-2 rounded-full bg-stone-border overflow-hidden">
            <div className={cn('h-full rounded-full', pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <p className="text-xs text-warm-gray mt-1.5">Budget alert at 80%. You&apos;re at {pct}%.</p>
        </div>

        <div className="stone-card p-4 space-y-3">
          <p className="text-[11px] uppercase tracking-wider text-ash-gray">By feature</p>
          {USAGE.byFeature.map((f) => (
            <div key={f.label}>
              <div className="flex justify-between text-sm"><span className="text-ink-black">{f.label}</span><span className="text-warm-gray tabular-nums">${f.cost.toFixed(2)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-stone-border"><div className="h-full rounded-full bg-cyan-signal" style={{ width: `${(f.cost / featureMax) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="stone-card p-4 space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-ash-gray">Top people</p>
          {USAGE.byPerson.map((p) => (
            <div key={p.personId} className="flex items-center justify-between"><PersonChip id={p.personId} /><span className="text-sm text-warm-gray tabular-nums">${p.cost.toFixed(2)}</span></div>
          ))}
        </div>
        <div className="stone-card p-4">
          <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-2">Prices (USD per million tokens)</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] text-ash-gray"><th className="py-1 font-medium">Model</th><th className="py-1 font-medium text-right">In</th><th className="py-1 font-medium text-right">Out</th></tr></thead>
            <tbody>
              {PRICE_TABLE.map((p) => (
                <tr key={p.model} className="border-t border-stone-border">
                  <td className="py-1.5 text-ink-black"><code className="text-xs">{p.model}</code></td>
                  <td className="py-1.5 text-right tabular-nums text-warm-gray">{p.unit ? `$${p.input.toFixed(3)}/h` : `$${p.input.toFixed(2)}`}</td>
                  <td className="py-1.5 text-right tabular-nums text-warm-gray">{p.unit ? '–' : `$${p.output.toFixed(2)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
