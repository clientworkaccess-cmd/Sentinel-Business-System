'use client';

import React, { useState } from 'react';
import { Check, Hash, Loader2, Mail, MessageCircle, Pencil, RotateCcw, Smartphone, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isRetryable, type MessageChannel, type OutboundMessage } from '@/lib/approvalsApi';
import { cn } from '@/lib/utils';
import { InlineError, RejectForm } from './shared';

const CHANNELS: Record<MessageChannel, { label: string; icon: LucideIcon }> = {
  email: { label: 'Email', icon: Mail },
  whatsapp: { label: 'WhatsApp', icon: Smartphone },
  slack: { label: 'Slack', icon: Hash },
  slack_connect: { label: 'Slack Connect', icon: Hash },
  in_app: { label: 'In-app', icon: MessageCircle },
};

interface Props {
  message: OutboundMessage;
  error?: string;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onRetry: () => void;
  /** Resolves on success; throws on failure (the message is shown in the form). */
  onSave: (payload: { subject?: string | null; body?: string }) => Promise<void>;
}

export function MessageApprovalCard({ message: m, error, onApprove, onReject, onRetry, onSave }: Props) {
  const [mode, setMode] = useState<'view' | 'edit' | 'reject'>('view');
  const channel = CHANNELS[m.channel] ?? { label: m.channel, icon: MessageCircle };
  const Icon = channel.icon;
  const retryable = isRetryable(m);
  const external = m.audience === 'external';

  return (
    <div className="stone-card p-4 sm:p-5 space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-warm-gray">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-6 h-6 rounded-md border border-stone-border bg-white flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5 text-warm-gray" />
          </span>
          {channel.label}
        </span>
        <span
          className={cn(
            'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap',
            external ? 'bg-amber-50 border-amber-200 text-amber-700' : 'border-stone-border text-warm-gray',
          )}
        >
          {external ? 'External' : 'Internal'}
        </span>
        {retryable && (
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-rose-50 border-rose-200 text-rose-700 whitespace-nowrap">
            {m.status === 'failed' ? 'Failed to send' : 'Not delivered'}
          </span>
        )}
      </div>

      <p className="text-xs text-warm-gray min-w-0 break-words">
        To <span className="text-ink-black font-medium">{m.recipient_name || m.recipient_address}</span>
        {m.recipient_name && <span className="text-ash-gray"> · {m.recipient_address}</span>}
      </p>

      {mode === 'edit' ? (
        <EditForm message={m} onSave={onSave} onDone={() => setMode('view')} />
      ) : (
        <div className="rounded-lg border border-stone-border bg-white">
          {m.subject && (
            <p className="px-3 py-2 border-b border-stone-border text-sm font-medium text-ink-black break-words">{m.subject}</p>
          )}
          <pre className="p-3 text-sm leading-relaxed text-ink-black/90 whitespace-pre-wrap break-words font-sans">{m.body}</pre>
        </div>
      )}

      {retryable && m.delivery_error && <InlineError message={m.delivery_error} />}
      {error && <InlineError message={error} />}

      {mode === 'reject' ? (
        <RejectForm onConfirm={onReject} onCancel={() => setMode('view')} />
      ) : mode === 'view' && retryable ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onRetry} className="btn-cyan text-xs inline-flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      ) : mode === 'view' ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onApprove} className="btn-cyan text-xs inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Approve & send
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
      ) : null}
    </div>
  );
}

const fieldClass =
  'w-full px-3 rounded-lg border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70';

function EditForm({
  message, onSave, onDone,
}: {
  message: OutboundMessage;
  onSave: (payload: { subject?: string | null; body?: string }) => Promise<void>;
  onDone: () => void;
}) {
  const showSubject = message.channel === 'email' || message.subject !== null;
  const [subject, setSubject] = useState(message.subject ?? '');
  const [body, setBody] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      setFormError('A message cannot be empty.');
      return;
    }
    const payload: { subject?: string | null; body?: string } = {};
    if (body !== message.body) payload.body = body;
    if (showSubject && subject !== (message.subject ?? '')) payload.subject = subject.trim() ? subject : null;
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

  return (
    <form onSubmit={save} className="space-y-3">
      {showSubject && (
        <label className="block min-w-0">
          <span className="block text-[11px] text-warm-gray mb-1">Subject</span>
          <input value={subject} maxLength={500} onChange={(e) => setSubject(e.target.value)} className={cn(fieldClass, 'h-9')} />
        </label>
      )}
      <label className="block min-w-0">
        <span className="block text-[11px] text-warm-gray mb-1">Message</span>
        <textarea
          value={body}
          maxLength={20000}
          rows={8}
          onChange={(e) => setBody(e.target.value)}
          className={cn(fieldClass, 'py-2 leading-relaxed resize-y')}
        />
      </label>
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
