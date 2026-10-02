'use client';

import React from 'react';
import { getDepartment, getPerson } from '@/demo/org';
import type { BrainItem, ItemStatus, Person } from '@/demo/types';
import { cn } from '@/lib/utils';
import { KIND_META, OWNER_COLOR, STATUS_META, formatDate, hueColor, sourceLabel } from './meta';

export function personColor(p?: Person): string {
  if (!p || p.role === 'owner') return OWNER_COLOR;
  const dept = p.departmentId ? getDepartment(p.departmentId) : undefined;
  return dept ? hueColor(dept.hue) : OWNER_COLOR;
}

const AVATAR_SIZES = { xs: 'w-5 h-5 text-[9px]', sm: 'w-7 h-7 text-[11px]', md: 'w-9 h-9 text-xs', lg: 'w-11 h-11 text-sm' };

export const Avatar: React.FC<{ person?: Person; size?: keyof typeof AVATAR_SIZES; ring?: boolean; className?: string }> = ({
  person, size = 'sm', ring, className,
}) => (
  <span
    title={person ? `${person.name} · ${person.title}` : undefined}
    className={cn(
      'inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0 select-none',
      AVATAR_SIZES[size],
      ring && 'ring-2 ring-stone-canvas',
      className,
    )}
    style={{ backgroundColor: personColor(person) }}
  >
    {person?.initials ?? '?'}
  </span>
);

export const AvatarStack: React.FC<{ ids: string[]; max?: number; size?: keyof typeof AVATAR_SIZES }> = ({ ids, max = 4, size = 'xs' }) => {
  const shown = ids.slice(0, max);
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((id) => (
        <Avatar key={id} person={getPerson(id)} size={size} ring />
      ))}
      {ids.length > max && (
        <span className="pl-2.5 text-[11px] text-warm-gray">+{ids.length - max}</span>
      )}
    </span>
  );
};

export const StatusPill: React.FC<{ status?: ItemStatus; className?: string }> = ({ status, className }) => {
  if (!status) return null;
  const meta = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap', meta.className, className)}>
      {meta.label}
    </span>
  );
};

/** One line of business memory: icon, title, source/date, people, status. */
export const ItemRow: React.FC<{ item: BrainItem; onClick?: () => void; showSummary?: boolean }> = ({ item, onClick, showSummary }) => {
  const { icon: Icon, label } = KIND_META[item.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-stone-border/40 transition"
    >
      <span className="mt-0.5 w-7 h-7 rounded-md border border-stone-border bg-white flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-warm-gray group-hover:text-cyan-signal transition" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-ink-black truncate min-w-0">{item.title}</span>
          {item.external && (
            <span className="text-[10px] uppercase tracking-wide text-ash-gray border border-stone-border rounded px-1 shrink-0">
              External
            </span>
          )}
        </span>
        <span className="block text-xs text-warm-gray mt-0.5">
          {label} · {sourceLabel(item.source)}
          {item.date && ` · ${formatDate(item.date)}`}
        </span>
        {showSummary && item.summary && (
          <span className="block text-xs text-warm-gray mt-1 leading-relaxed line-clamp-2">{item.summary}</span>
        )}
      </span>
      <span className="flex flex-col items-end gap-1.5 shrink-0">
        <StatusPill status={item.status} />
        <AvatarStack ids={item.ownerIds} max={3} />
      </span>
    </button>
  );
};

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cn('stone-card', className)}>{children}</div>
);

export const SectionTitle: React.FC<{ title: string; hint?: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div className="flex items-end justify-between gap-4 mb-3">
    <div>
      <h2 className="font-display text-[17px] text-ink-black">{title}</h2>
      {hint && <p className="text-xs text-warm-gray mt-0.5">{hint}</p>}
    </div>
    {action}
  </div>
);
