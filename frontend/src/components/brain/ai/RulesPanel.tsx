'use client';

import React, { useState } from 'react';
import { APPROVAL_SETTINGS, RULES, RULE_EXAMPLES, type Effect, type Rule, type RuleScope, type Tone } from '@/demo/ai';
import { getPerson } from '@/demo/org';
import { cn } from '@/lib/utils';
import { Chip, LangToggle, PanelHeader, useLang } from './parts';

const EFFECT_META: Record<Effect, { label: string; tone: Tone }> = {
  allow: { label: 'Allow', tone: 'green' },
  ask: { label: 'Ask first', tone: 'amber' },
  never: { label: 'Block', tone: 'red' },
};

/** Plain-language rules (English or Roman Urdu), checked on every request an AI sends through Sentinel. */
export function RulesPanel() {
  const { lang } = useLang();
  const [rules, setRules] = useState<Rule[]>(RULES);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<(typeof RULE_EXAMPLES)[number] | null>(null);

  const parse = (text: string) => {
    const hit = RULE_EXAMPLES.find((e) => e.input.toLowerCase() === text.trim().toLowerCase());
    setPreview(hit ?? { input: text, effect: 'ask', scope: { people: 'Everyone', ai: 'Any AI', action: 'Send or read', target: text.trim() } });
  };

  const save = () => {
    if (!preview) return;
    setRules((r) => [{ id: `new-${r.length}`, effect: preview.effect, en: preview.input, ur: preview.input, scope: preview.scope, usedThisWeek: 0, on: true }, ...r]);
    setDraft('');
    setPreview(null);
  };

  const approver = getPerson(APPROVAL_SETTINGS.approverId);

  return (
    <div className="space-y-6">
      <PanelHeader title="Rules" hint="Write a rule in English or Roman Urdu. It applies to every AI connected to Sentinel." action={<LangToggle />} />

      <div className="stone-card p-4 space-y-3">
        <label htmlFor="new-rule" className="text-sm font-semibold text-ink-black">Add a rule</label>
        <div className="flex gap-2">
          <input
            id="new-rule"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setPreview(null); }}
            onKeyDown={(e) => e.key === 'Enter' && draft.trim() && parse(draft)}
            placeholder="e.g. Koi AI client ko bina meri approval email na bheje"
            className="flex-1 min-w-0 h-10 px-3 rounded-inputs border border-stone-border bg-surface text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70"
          />
          <button type="button" disabled={!draft.trim()} onClick={() => parse(draft)} className="btn-cyan text-sm h-10 px-4 disabled:opacity-50">Check</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RULE_EXAMPLES.map((e) => (
            <button key={e.input} type="button" onClick={() => { setDraft(e.input); parse(e.input); }} className="text-[11px] px-2.5 py-1 rounded-md border border-stone-border bg-surface text-warm-gray hover:text-ink-black">
              {e.input}
            </button>
          ))}
        </div>
        {preview && (
          <div className="rounded-md border border-stone-border bg-stone-canvas/60 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Chip tone={EFFECT_META[preview.effect].tone}>{EFFECT_META[preview.effect].label}</Chip>
              <span className="text-xs text-warm-gray">Sentinel read it as:</span>
            </div>
            <ScopeGrid scope={preview.scope} />
            <div className="flex gap-2">
              <button type="button" onClick={save} className="btn-cyan text-xs h-8 px-3">Save rule</button>
              <button type="button" onClick={() => setPreview(null)} className="btn-ghost text-xs h-8 px-3">Edit</button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          {rules.map((r) => (
            <div key={r.id} className={cn('stone-card p-3.5 flex items-start gap-3', !r.on && 'opacity-60')}>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-start gap-2">
                  <Chip tone={EFFECT_META[r.effect].tone} className="shrink-0">{EFFECT_META[r.effect].label}</Chip>
                  <p className="text-sm text-ink-black pt-0.5">{lang === 'ur' ? r.ur : r.en}</p>
                </div>
                <p className="text-[11px] text-warm-gray">
                  {r.scope.people} · {r.scope.ai} · used {r.usedThisWeek} {r.usedThisWeek === 1 ? 'time' : 'times'} this week
                </p>
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

        <div className="stone-card p-4 space-y-3 h-fit">
          <h3 className="text-sm font-semibold text-ink-black">Approval settings</h3>
          <Setting label="Approver">{approver?.shortName ?? approver?.name} (Owner)</Setting>
          <Setting label="No reply in">{APPROVAL_SETTINGS.escalateAfterMin} min, then escalate</Setting>
          <Setting label="Still no reply">{APPROVAL_SETTINGS.noReply}</Setting>
        </div>
      </div>
    </div>
  );
}

function ScopeGrid({ scope }: { scope: RuleScope }) {
  const rows: [string, string][] = [['Who', scope.people], ['AI', scope.ai], ['Action', scope.action], ['What', scope.target]];
  return (
    <dl className="grid grid-cols-[56px_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-warm-gray">{k}</dt>
          <dd className="text-ink-black">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pt-2 first-of-type:pt-0 border-t border-stone-border first-of-type:border-t-0">
      <p className="text-[11px] uppercase tracking-wider text-ash-gray">{label}</p>
      <p className="text-sm text-ink-black mt-0.5">{children}</p>
    </div>
  );
}
