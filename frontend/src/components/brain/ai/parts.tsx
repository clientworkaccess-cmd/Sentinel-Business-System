'use client';

import React, { createContext, useContext, useState } from 'react';
import { ChevronDown, HardDrive } from 'lucide-react';
import { getPerson } from '@/demo/org';
import { RESULT_META, RISK_META, getAi, type AiId, type Result, type Risk } from '@/demo/ai';
import { cn } from '@/lib/utils';
import { Avatar } from '../atoms';

/* ── Language (EN / Roman Urdu) for cards and rules ─────────────────────── */

type Lang = 'en' | 'ur';
const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div role="radiogroup" aria-label="Language" className="inline-flex items-center p-0.5 rounded-full border border-stone-border bg-surface">
      {(['en', 'ur'] as Lang[]).map((l) => (
        <button
          key={l}
          role="radio"
          aria-checked={lang === l}
          onClick={() => setLang(l)}
          className={cn('px-2.5 h-7 rounded-full text-[11px] font-medium transition', lang === l ? 'bg-inverse text-white' : 'text-warm-gray hover:text-ink-black')}
        >
          {l === 'en' ? 'English' : 'Roman Urdu'}
        </button>
      ))}
    </div>
  );
}

/* ── Badges ─────────────────────────────────────────────────────────────── */

/** Severity in words first; the standard scale sits in the tooltip for experts. */
export function RiskBadge({ risk, className }: { risk: Risk; className?: string }) {
  const m = RISK_META[risk];
  return (
    <span title={`Severity: ${m.standard}`} className={cn('inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap', m.className, className)}>
      {m.label}
    </span>
  );
}

export function ResultBadge({ result }: { result: Result }) {
  const m = RESULT_META[result];
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap', m.className)}>{m.label}</span>;
}

export function LocalBadge({ text = 'Runs on this laptop. Nothing uploaded.' }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-medium">
      <HardDrive className="w-3 h-3" /> {text}
    </span>
  );
}

/** A monogram tile for an AI or app (no third-party logos are bundled). */
export function Mark({ name, color, size = 'md', letters: given }: { name: string; color: string; size?: 'sm' | 'md' | 'lg'; letters?: string }) {
  const s = size === 'sm' ? 'w-7 h-7 text-[11px] rounded-md' : size === 'lg' ? 'w-12 h-12 text-base rounded-xl' : 'w-9 h-9 text-xs rounded-lg';
  const letters = given ?? name.replace(/[^A-Za-z ]/g, '').split(' ').map((w) => w[0]).join('').slice(0, 2);
  return (
    <span className={cn('shrink-0 inline-flex items-center justify-center font-semibold text-white', s)} style={{ backgroundColor: color }} aria-hidden="true">
      {letters}
    </span>
  );
}

export function AiMark({ id, size = 'md' }: { id: AiId; size?: 'sm' | 'md' | 'lg' }) {
  const ai = getAi(id);
  return <Mark name={ai.name} color={ai.color} size={size} letters={ai.mark} />;
}

export function PersonChip({ id }: { id: string }) {
  const p = getPerson(id);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <Avatar person={p} size="xs" />
      <span className="text-xs text-ink-black truncate">{p?.shortName ?? p?.name ?? id}</span>
    </span>
  );
}

/** Technical detail lives here, out of the way of non-experts. */
export function Details({ children, label = 'Details' }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-[11px] text-warm-gray hover:text-ink-black">
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} /> {label}
      </button>
      {open && <pre className="mt-1.5 p-2.5 rounded-md bg-stone-canvas border border-stone-border text-[11px] leading-relaxed text-warm-gray whitespace-pre-wrap font-mono">{children}</pre>}
    </div>
  );
}

export function PanelHeader({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-xl text-ink-black">{title}</h2>
        <p className="text-sm text-warm-gray mt-0.5 max-w-2xl">{hint}</p>
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="stone-card px-4 py-3 min-w-0">
      <p className="text-[11px] uppercase tracking-wider text-ash-gray">{label}</p>
      <p className="font-display text-2xl text-ink-black mt-0.5 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-warm-gray mt-0.5">{hint}</p>}
    </div>
  );
}
