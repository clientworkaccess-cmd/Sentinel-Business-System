'use client';

import React from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Same input treatment as the connector dialog's API-key field. */
export const inputClass =
  'w-full h-10 px-3.5 rounded-inputs border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70 disabled:opacity-60';

export const textareaClass =
  'w-full px-3.5 py-2.5 rounded-inputs border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70 leading-relaxed';

export function Field({
  id,
  label,
  hint,
  error,
  aside,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-ink-black">{label}</label>
        {aside}
      </div>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="text-[11px] text-rose-700 mt-1.5 leading-relaxed">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-warm-gray mt-1.5 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

export function ErrorLine({ message, className }: { message: string; className?: string }) {
  return (
    <p role="alert" className={cn('text-xs text-rose-700 flex items-start gap-1.5', className)}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> <span>{message}</span>
    </p>
  );
}

export function SuccessLine({ message }: { message: string }) {
  return (
    <p role="status" className="text-xs text-emerald-700 flex items-center gap-1.5">
      <Check className="w-3.5 h-3.5" /> {message}
    </p>
  );
}

/** An on/off switch. The knob is painted with an inline white so dark mode's bg-white remap leaves it alone. */
export function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition',
        checked ? 'bg-cyan-signal border-transparent' : 'bg-stone-border border-stone-border',
      )}
    >
      <span
        className={cn('inline-block h-5 w-5 rounded-full shadow-sm transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')}
        style={{ backgroundColor: '#fff' }}
      />
    </button>
  );
}
