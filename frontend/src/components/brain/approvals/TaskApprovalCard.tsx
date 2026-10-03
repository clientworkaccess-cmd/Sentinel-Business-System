'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, Clock, Loader2, Pencil, Quote, X } from 'lucide-react';
import type { ApprovalDetail, ApprovalEditPayload, ApprovalEmployee, ApprovalSummary } from '@/lib/approvalsApi';
import { cn } from '@/lib/utils';
import { InlineError, NameAvatar, RejectForm, formatDeadline, fromDateInput, toDateInput } from './shared';

export type DetailState = { status: 'loading' } | { status: 'ready'; detail: ApprovalDetail } | { status: 'error'; message: string };

interface Props {
  approval: ApprovalSummary;
  detail?: DetailState;
  employees: ApprovalEmployee[] | null;
  error?: string;
  onNeedDetail: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  /** Resolves on success; throws the error message on failure. */
  onSave: (payload: ApprovalEditPayload) => Promise<void>;
}

export function TaskApprovalCard({ approval, detail, employees, error, onNeedDetail, onApprove, onReject, onSave }: Props) {
  const { task } = approval;
  const [mode, setMode] = useState<'view' | 'edit' | 'reject'>('view');
  const [sourceOpen, setSourceOpen] = useState(false);

  const ready = detail?.status === 'ready' ? detail.detail : null;
  const confidence = ready?.task.confidence ?? null;

  const toggleSource = () => {
    if (!sourceOpen && !detail) onNeedDetail();
    setSourceOpen((o) => !o);
  };

  return (
    <div className="stone-card p-4 sm:p-5 space-y-3 min-w-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-black break-words">{task.title}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-1.5 text-xs text-warm-gray">
            {task.owner_name ? (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <NameAvatar name={task.owner_name} />
                <span className="truncate">{task.owner_name}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full border border-dashed border-stone-border shrink-0" />
                Unassigned
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formatDeadline(task.deadline)}
            </span>
            {task.days_late ? <span className="text-rose-700">{task.days_late}d late</span> : null}
            <ConfidencePill detail={detail} confidence={confidence} />
          </div>
        </div>
        {approval.state === 'edited' && (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700 whitespace-nowrap shrink-0">
            Edited
          </span>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={toggleSource}
          aria-expanded={sourceOpen}
          className="text-xs text-warm-gray hover:text-ink-black inline-flex items-center gap-1"
        >
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', sourceOpen && 'rotate-180')} />
          {sourceOpen ? 'Hide source' : 'Show source'}
        </button>
        {sourceOpen && (
          <div className="mt-2">
            {!detail || detail.status === 'loading' ? (
              <p className="text-xs text-warm-gray inline-flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading source…
              </p>
            ) : detail.status === 'error' ? (
              <InlineError message={detail.message} />
            ) : detail.detail.task.source_quote ? (
              <figure className="rounded-lg border border-stone-border bg-white px-3 py-2.5">
                <blockquote className="flex gap-2 text-sm text-ink-black/90 leading-relaxed">
                  <Quote className="w-3.5 h-3.5 text-cyan-signal shrink-0 mt-1" />
                  <span className="min-w-0 break-words whitespace-pre-wrap">{detail.detail.task.source_quote}</span>
                </blockquote>
                {detail.detail.task.source_ref && (
                  <figcaption className="text-[11px] text-ash-gray mt-1.5 break-all">{detail.detail.task.source_ref}</figcaption>
                )}
              </figure>
            ) : (
              <p className="text-xs text-warm-gray">No source quote was recorded for this task.</p>
            )}
          </div>
        )}
      </div>

      {error && <InlineError message={error} />}

      {mode === 'edit' ? (
        <EditForm approval={approval} employees={employees} onSave={onSave} onDone={() => setMode('view')} />
      ) : mode === 'reject' ? (
        <RejectForm onConfirm={onReject} onCancel={() => setMode('view')} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onApprove} className="btn-cyan text-xs inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Approve
          </button>
          <button type="button" onClick={() => setMode('edit')} className="btn-ghost text-xs inline-flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setMode('reject')}
            className="text-xs px-3 py-2 rounded-full text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5"
          >
            <X className="w-3.5 h-3.5" /> Reject
          </button>
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ detail, confidence }: { detail?: DetailState; confidence: number | null }) {
  if (!detail || detail.status === 'error') return null;
  if (detail.status === 'loading') {
    return <span className="inline-block h-4 w-20 rounded-full bg-stone-border/60 animate-pulse" aria-label="Loading confidence" />;
  }
  if (confidence === null) return null;
  const pct = Math.round(confidence * 100);
  const tone =
    confidence >= 0.8
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : confidence >= 0.5
        ? 'bg-amber-50 border-amber-200 text-amber-700'
        : 'bg-rose-50 border-rose-200 text-rose-700';
  return (
    <span className={cn('text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap tabular-nums', tone)}>
      {pct}% confidence
    </span>
  );
}

const fieldClass =
  'w-full h-9 px-3 rounded-lg border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70';

function EditForm({
  approval, employees, onSave, onDone,
}: {
  approval: ApprovalSummary;
  employees: ApprovalEmployee[] | null;
  onSave: (payload: ApprovalEditPayload) => Promise<void>;
  onDone: () => void;
}) {
  const { task } = approval;
  const [title, setTitle] = useState(task.title);
  const [ownerId, setOwnerId] = useState(task.owner_employee_id ?? '');
  const initialDate = toDateInput(task.deadline);
  const [date, setDate] = useState(initialDate);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: ApprovalEditPayload = {};
    const t = title.trim();
    if (!t) {
      setFormError('Title cannot be blank.');
      return;
    }
    if (t !== task.title) payload.title = t;
    if (ownerId && ownerId !== (task.owner_employee_id ?? '')) payload.owner_employee_id = ownerId;
    if (date && date !== initialDate) payload.deadline = fromDateInput(date);
    if (Object.keys(payload).length === 0) {
      onDone();
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSave(payload);
      onDone();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the changes.');
    } finally {
      setSaving(false);
    }
  };

  // The current owner may not be in the list (e.g. the roster failed to load).
  const options = employees ?? [];
  const ownerMissing = !!task.owner_employee_id && !options.some((o) => o.id === task.owner_employee_id);

  return (
    <form onSubmit={save} className="rounded-lg border border-stone-border p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2 min-w-0">
          <span className="block text-[11px] text-warm-gray mb-1">Title</span>
          <input value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} className={fieldClass} />
        </label>
        <label className="block min-w-0">
          <span className="block text-[11px] text-warm-gray mb-1">Owner</span>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={fieldClass}>
            {/* The backend cannot unassign through edit, so "Unassigned" is only shown while it is the current value. */}
            {!task.owner_employee_id && <option value="">Unassigned</option>}
            {ownerMissing && <option value={task.owner_employee_id ?? ''}>{task.owner_name ?? 'Current owner'}</option>}
            {options.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.role_title ? `${emp.name} · ${emp.role_title}` : emp.name}
              </option>
            ))}
          </select>
          {employees === null && <span className="block text-[11px] text-ash-gray mt-1">Loading people…</span>}
        </label>
        <label className="block min-w-0">
          <span className="block text-[11px] text-warm-gray mb-1">Deadline</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass} />
        </label>
      </div>
      {formError && <InlineError message={formError} />}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className="btn-cyan text-xs inline-flex items-center gap-1.5 disabled:opacity-60">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
        </button>
        <button type="button" onClick={onDone} disabled={saving} className="btn-ghost text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
