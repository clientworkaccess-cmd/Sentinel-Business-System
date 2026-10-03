'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { OWNER_COLOR } from '../meta';

/* ── Optimistic queue ──────────────────────────────────────────────────── */

/**
 * A list the user works through. A decision removes the row at once; if the server
 * refuses, the row goes back where it was with the error attached to it.
 */
export function useQueue<T extends { id: string }>() {
  const [items, setItems] = useState<T[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ref = useRef<T[] | null>(null);
  useEffect(() => {
    ref.current = items;
  }, [items]);

  const setError = useCallback((id: string, message: string | null) => {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }, []);

  const remove = useCallback((ids: string[]) => {
    const drop = new Set(ids);
    setItems((prev) => (prev ? prev.filter((x) => !drop.has(x.id)) : prev));
  }, []);

  /** Put rows back at their old positions (positions taken before removal). */
  const restore = useCallback((rows: { item: T; index: number }[]) => {
    setItems((prev) => {
      const next = [...(prev ?? [])];
      for (const { item, index } of [...rows].sort((a, b) => a.index - b.index)) {
        if (next.some((x) => x.id === item.id)) continue;
        next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, item);
      }
      return next;
    });
  }, []);

  const replace = useCallback((item: T) => {
    setItems((prev) => (prev ? prev.map((x) => (x.id === item.id ? item : x)) : prev));
  }, []);

  const positions = useCallback(
    (ids: string[]) => ids.map((id) => ({ id, index: (ref.current ?? []).findIndex((x) => x.id === id) })),
    [],
  );

  /**
   * Remove optimistically, run the call, restore on failure. `keep` may return a row
   * to put back after a success (e.g. a message that was approved but failed to send).
   */
  const decide = useCallback(
    async <R,>(item: T, run: () => Promise<R>, fallback: string, keep?: (result: R) => T | null): Promise<boolean> => {
      const [{ index }] = positions([item.id]);
      setError(item.id, null);
      remove([item.id]);
      try {
        const result = await run();
        const back = keep?.(result);
        if (back) restore([{ item: back, index }]);
        return true;
      } catch (err) {
        restore([{ item, index }]);
        setError(item.id, apiErrorMessage(err, fallback));
        return false;
      }
    },
    [positions, remove, restore, setError],
  );

  return { items, setItems, errors, setError, remove, restore, replace, positions, decide };
}

/* ── Small pieces ──────────────────────────────────────────────────────── */

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** Initials avatar for a real employee (the demo `Avatar` needs a demo Person). */
export function NameAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      title={name}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 select-none w-5 h-5 text-[9px]',
        className,
      )}
      style={{ backgroundColor: OWNER_COLOR }}
    >
      {initialsOf(name)}
    </span>
  );
}

export function formatDeadline(iso: string | null): string {
  if (!iso) return 'No deadline';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'No deadline';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** ISO datetime → local YYYY-MM-DD for <input type="date">. */
export function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-MM-DD → end of that local day, as a timezone-aware ISO string. */
export function fromDateInput(value: string): string {
  return new Date(`${value}T23:59:00`).toISOString();
}

export function InlineError({ message, className }: { message: string; className?: string }) {
  return (
    <p role="alert" className={cn('text-xs text-rose-700 flex items-start gap-1.5', className)}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}

export function EmptyState() {
  return (
    <div className="stone-card p-10 text-center">
      <p className="text-sm text-warm-gray">Nothing waiting for approval.</p>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="stone-card p-4 sm:p-5 animate-pulse space-y-3">
          <div className="h-4 w-2/3 rounded bg-stone-border/70" />
          <div className="h-3 w-1/3 rounded bg-stone-border/50" />
          <div className="flex gap-2 pt-1">
            <div className="h-8 w-24 rounded-full bg-stone-border/50" />
            <div className="h-8 w-16 rounded-full bg-stone-border/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Inline "why are you rejecting" step shared by both card types. */
export function RejectForm({
  busy, onConfirm, onCancel,
}: { busy?: boolean; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex flex-col sm:flex-row gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(reason);
      }}
    >
      <label className="flex-1 min-w-0">
        <span className="sr-only">Reason</span>
        <input
          autoFocus
          value={reason}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full h-9 px-3 rounded-full border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70"
        />
      </label>
      <div className="flex gap-2 shrink-0">
        <button
          type="submit"
          disabled={busy}
          className="text-xs px-4 py-2 rounded-full border border-rose-200 bg-rose-50 text-rose-700 inline-flex items-center gap-1.5 disabled:opacity-60"
        >
          Reject
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
