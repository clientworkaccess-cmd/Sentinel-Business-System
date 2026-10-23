'use client';

import React, { useState } from 'react';
import { ArrowRight, Plus, Sparkles } from 'lucide-react';
import { APPROVAL_POLICY, RULES, RULE_EXAMPLES, STARTER_PACKS, type Effect, type Rule } from '@/demo/ai';
import { getPerson } from '@/demo/org';
import { cn } from '@/lib/utils';
import { LangToggle, PanelHeader, PersonChip, useLang } from './parts';

const EFFECT_META: Record<Effect, { label: string; className: string }> = {
  allow: { label: 'Allow', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  ask: { label: 'Ask me', className: 'bg-sky-50 text-sky-700 border-sky-200' },
  never: { label: 'Never', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/** Plain-language rules (English or Roman Urdu) and the approval policy behind them. */
export function RulesPanel() {
  const { lang } = useLang();
  const [rules, setRules] = useState<Rule[]>(RULES);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<(typeof RULE_EXAMPLES)[number] | null>(null);

  const parse = (text: string) => {
    const hit = RULE_EXAMPLES.find((e) => e.input.toLowerCase() === text.trim().toLowerCase());
    setPreview(hit ?? { input: text, effect: 'ask', parsed: { who: 'Any AI', action: 'Send or read', target: text.trim() } });
  };

  const save = () => {
    if (!preview) return;
    setRules((r) => [
      { id: `new-${r.length}`, effect: preview.effect, en: preview.input, ur: preview.input, parsed: preview.parsed, triggeredThisWeek: 0, createdBy: 'You, just now', on: true },
      ...r,
    ]);
    setDraft('');
    setPreview(null);
  };

  return (
    <div className="space-y-6">
      <PanelHeader
        title="Rules, in your words"
        hint="Write what you want in English or Roman Urdu. Sentinel shows exactly how it understood the rule, and it applies to every connected AI."
        action={<LangToggle />}
      />

      <div className="stone-card p-4 space-y-3">
        <label htmlFor="new-rule" className="text-sm font-semibold text-ink-black flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-signal" /> Add a rule
        </label>
        <div className="flex gap-2">
          <input
            id="new-rule"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setPreview(null); }}
            onKeyDown={(e) => e.key === 'Enter' && draft.trim() && parse(draft)}
            placeholder="e.g. Koi AI client ko bina meri approval email na bheje"
            className="flex-1 min-w-0 h-10 px-3 rounded-inputs border border-stone-border bg-surface text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70"
          />
          <button type="button" disabled={!draft.trim()} onClick={() => parse(draft)} className="btn-cyan text-sm h-10 px-4 disabled:opacity-50">Understand</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RULE_EXAMPLES.map((e) => (
            <button key={e.input} type="button" onClick={() => { setDraft(e.input); parse(e.input); }} className="text-[11px] px-2.5 py-1 rounded-full border border-stone-border bg-surface text-warm-gray hover:text-ink-black">
              {e.input}
            </button>
          ))}
        </div>
        {preview && (
          <div className="rounded-md border border-cyan-edge/40 bg-sky-wash/30 p-3 space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-ash-gray">Sentinel understood</p>
            <ParsedRow effect={preview.effect} parsed={preview.parsed} />
            <div className="flex gap-2">
              <button type="button" onClick={save} className="btn-cyan text-xs h-8 px-3 inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Save rule</button>
              <button type="button" onClick={() => setPreview(null)} className="btn-ghost text-xs h-8 px-3">Change wording</button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 space-y-2">
          {rules.map((r) => (
            <div key={r.id} className={cn('stone-card p-3.5 flex items-start gap-3', !r.on && 'opacity-60')}>
              <span className={cn('shrink-0 mt-0.5 px-2 py-0.5 rounded-full border text-[11px] font-medium', EFFECT_META[r.effect].className)}>{EFFECT_META[r.effect].label}</span>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm text-ink-black">{lang === 'ur' ? r.ur : r.en}</p>
                <ParsedRow effect={r.effect} parsed={r.parsed} quiet />
                <p className="text-[11px] text-ash-gray">Used {r.triggeredThisWeek}× this week · {r.createdBy}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={r.on}
                aria-label={r.on ? 'Turn rule off' : 'Turn rule on'}
                onClick={() => setRules((all) => all.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))}
                className={cn('shrink-0 w-9 h-5 rounded-full transition relative', r.on ? 'bg-cyan-signal' : 'bg-stone-border')}
              >
                <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all', r.on ? 'left-[18px]' : 'left-0.5')} />
              </button>
            </div>
          ))}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="stone-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-ink-black">Approval policy</h3>
            <PolicyRow label="Send without asking">
              <div className="flex flex-wrap gap-2">{APPROVAL_POLICY.trustedSenderIds.map((id) => <PersonChip key={id} id={id} />)}</div>
              <p className="text-xs text-warm-gray mt-1">to existing clients, when no rule below matches</p>
            </PolicyRow>
            <PolicyRow label="Always ask for">
              <ul className="text-sm text-ink-black space-y-0.5">{APPROVAL_POLICY.alwaysAsk.map((x) => <li key={x}>• {x}</li>)}</ul>
            </PolicyRow>
            <PolicyRow label="Time limit">
              <p className="text-sm text-ink-black">{APPROVAL_POLICY.timeLimitMin} minutes, then {getPerson(APPROVAL_POLICY.backupApproverId)?.shortName} is asked</p>
            </PolicyRow>
            <PolicyRow label="If nobody answers">
              <p className="text-sm text-ink-black">Client-facing: {APPROVAL_POLICY.onTimeout.clientFacing.toLowerCase()}</p>
              <p className="text-sm text-ink-black">Internal: {APPROVAL_POLICY.onTimeout.internal.toLowerCase()}</p>
            </PolicyRow>
          </div>

          <div className="stone-card p-4 space-y-2.5">
            <h3 className="text-sm font-semibold text-ink-black">Starter packs</h3>
            {STARTER_PACKS.map((p) => (
              <div key={p.name} className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink-black">{p.name} <span className="text-warm-gray">· {p.rules} rules</span></p>
                  <p className="text-xs text-warm-gray">{p.note}</p>
                </div>
                <button type="button" className="btn-ghost text-[11px] h-7 px-2.5">Add</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ParsedRow({ effect, parsed, quiet }: { effect: Effect; parsed: Rule['parsed']; quiet?: boolean }) {
  return (
    <p className={cn('flex flex-wrap items-center gap-1.5', quiet ? 'text-[11px] text-warm-gray' : 'text-xs text-ink-black')}>
      <span className="font-medium">{EFFECT_META[effect].label}</span>
      <ArrowRight className="w-3 h-3" /> {parsed.who}
      <ArrowRight className="w-3 h-3" /> {parsed.action}
      <ArrowRight className="w-3 h-3" /> {parsed.target}
      {parsed.when && <><ArrowRight className="w-3 h-3" /> {parsed.when}</>}
    </p>
  );
}

function PolicyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pt-2 first:pt-0 border-t first:border-t-0 border-stone-border">
      <p className="text-[11px] uppercase tracking-wider text-ash-gray mb-1">{label}</p>
      {children}
    </div>
  );
}
