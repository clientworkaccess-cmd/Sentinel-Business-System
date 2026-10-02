'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Sparkles, X } from 'lucide-react';
import { getDepartment, getItem, getPerson, getTeam } from '@/demo/org';
import type { BrainItem } from '@/demo/types';
import { Avatar, ItemRow, StatusPill } from './atoms';
import { KIND_META, formatDate, hueColor, sourceLabel } from './meta';

/**
 * Side panel for one piece of business memory. Shared by the overview and the
 * graph, so an item reads the same wherever it is opened.
 */
export function ItemDrawer({ item, onClose, onOpenItem }: { item: BrainItem | null; onClose: () => void; onOpenItem: (item: BrainItem) => void }) {
  const router = useRouter();

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const { icon: Icon, label } = KIND_META[item.kind];
  const dept = item.departmentId ? getDepartment(item.departmentId) : undefined;
  const team = item.teamId ? getTeam(item.teamId) : undefined;
  const related = (item.relatedIds ?? []).map(getItem).filter((i): i is BrainItem => !!i);
  const ask = () => router.push(`/brain/chat?q=${encodeURIComponent(`Tell me everything about "${item.title}"`)}`);

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-ink-black/20 backdrop-blur-[1px] animate-in fade-in duration-150" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label={item.title}
        className="fixed right-0 top-0 z-[61] h-screen w-full max-w-md bg-stone-canvas border-l border-stone-border shadow-preview flex flex-col animate-in slide-in-from-right duration-200"
      >
        <div className="px-6 pt-5 pb-4 border-b border-stone-border">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-xs text-warm-gray">
              <Icon className="w-3.5 h-3.5" /> {label} · {sourceLabel(item.source)}
              {item.date && ` · ${formatDate(item.date)}`}
            </span>
            <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-full text-warm-gray hover:text-ink-black hover:bg-stone-border/40" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <h3 className="font-display text-2xl text-ink-black mt-2 leading-tight">{item.title}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <StatusPill status={item.status} />
            {dept && (
              <span className="inline-flex items-center gap-1.5 text-xs text-warm-gray">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hueColor(dept.hue) }} />
                {dept.name}{team && ` · ${team.name}`}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {item.summary && <p className="text-sm text-ink-black/90 leading-relaxed">{item.summary}</p>}

          {item.external && item.status === 'pending_approval' && (
            <div className="flex gap-3 rounded-cards border border-sky-200 bg-sky-50 p-3">
              <ShieldCheck className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />
              <p className="text-xs text-sky-700 leading-relaxed">
                This goes to someone outside the company, so Sentinel has drafted it and is holding it for a human to approve.
              </p>
            </div>
          )}

          <section>
            <h4 className="text-[11px] uppercase tracking-wider text-ash-gray mb-2">People</h4>
            <ul className="space-y-2">
              {item.ownerIds.map((id) => {
                const p = getPerson(id);
                return (
                  <li key={id} className="flex items-center gap-3">
                    <Avatar person={p} />
                    <span className="text-sm text-ink-black">{p?.name}</span>
                    <span className="text-xs text-warm-gray truncate">{p?.title}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          {related.length > 0 && (
            <section>
              <h4 className="text-[11px] uppercase tracking-wider text-ash-gray mb-1">Connected memory</h4>
              <div className="-mx-3">
                {related.map((r) => (
                  <ItemRow key={r.id} item={r} onClick={() => onOpenItem(r)} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="p-4 border-t border-stone-border">
          <button onClick={ask} className="btn-cyan w-full flex items-center justify-center gap-2 text-sm">
            <Sparkles className="w-4 h-4" /> Ask Sentinel about this
          </button>
        </div>
      </aside>
    </>
  );
}
