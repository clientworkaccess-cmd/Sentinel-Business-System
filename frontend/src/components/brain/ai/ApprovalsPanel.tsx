'use client';

import React, { useState } from 'react';
import { Check, Clock, Paperclip, Pencil, Smartphone, X, Zap } from 'lucide-react';
import { AI_APPROVALS, AUTO_ALLOWED_TODAY, PROMPTS_SAVED_TODAY, getAi, type AiApproval } from '@/demo/ai';
import { getPerson } from '@/demo/org';
import { cn } from '@/lib/utils';
import { AiMark, Details, LangToggle, PanelHeader, PersonChip, RiskBadge, Stat, useLang } from './parts';

type Decision = 'approved' | 'rejected';

/** What connected AIs tried to send through Sentinel, and what waits for a person. */
export function ApprovalsPanel() {
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const [phone, setPhone] = useState(false);
  const pending = AI_APPROVALS.filter((a) => !decided[a.id]);

  return (
    <div className="space-y-6">
      <PanelHeader
        title="Approvals from your AI"
        hint="When an AI sends something through Sentinel, routine messages go straight out. Only what matches your rules waits for a person, with the reason from your company memory."
        action={
          <div className="flex items-center gap-2">
            <LangToggle />
            <button type="button" onClick={() => setPhone((p) => !p)} className={cn('btn-ghost text-xs h-8 px-3 inline-flex items-center gap-1.5', phone && 'border-cyan-edge/60 text-cyan-signal')}>
              <Smartphone className="w-3.5 h-3.5" /> Phone view
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Waiting for you" value={pending.length} />
        <Stat label="Went straight out today" value={PROMPTS_SAVED_TODAY} hint="Prompts saved" />
        <Stat label="Time limit" value="10 min" hint="Then the backup approver" />
        <Stat label="If nobody answers" value="Hold" hint="Client-facing messages" />
      </div>

      <div className={cn('grid gap-3', phone ? 'max-w-[380px] mx-auto' : 'grid-cols-1')}>
        {pending.length === 0 && <p className="stone-card p-6 text-sm text-warm-gray text-center">Nothing waiting. Your AIs are working within your rules.</p>}
        {pending.map((a) => (
          <ApprovalCard key={a.id} a={a} compact={phone} onDecide={(d) => setDecided((m) => ({ ...m, [a.id]: d }))} />
        ))}
      </div>

      {Object.keys(decided).length > 0 && (
        <div className="stone-card p-4 space-y-2">
          <h3 className="text-sm font-semibold text-ink-black">Decided just now</h3>
          {AI_APPROVALS.filter((a) => decided[a.id]).map((a) => (
            <p key={a.id} className="text-sm text-warm-gray">
              {decided[a.id] === 'approved' ? 'Sent' : 'Blocked'}: {a.subject}.{' '}
              {decided[a.id] === 'rejected' && `${getAi(a.ai).name} was told “not allowed” and why.`}
            </p>
          ))}
        </div>
      )}

      <div className="stone-card p-4 space-y-2.5">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-ink-black">Went straight out (no rule matched)</h3>
        </div>
        {AUTO_ALLOWED_TODAY.map((x) => (
          <div key={x.text} className="flex items-center gap-3">
            <AiMark id={x.ai} size="sm" />
            <p className="flex-1 min-w-0 text-sm text-ink-black">{x.text}</p>
            <span className="text-[11px] text-warm-gray shrink-0">{x.why}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApprovalCard({ a, compact, onDecide }: { a: AiApproval; compact: boolean; onDecide: (d: Decision) => void }) {
  const { lang } = useLang();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(a.body);
  const ai = getAi(a.ai);
  const escalated = a.waitingMin >= a.escalateAfterMin;
  const backup = getPerson(a.backupApproverId);

  return (
    <article className={cn('stone-card p-4 space-y-3', a.risk === 'act_now' && 'border-rose-200')}>
      <div className="flex items-start gap-3">
        <AiMark id={a.ai} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-black leading-snug">{lang === 'ur' ? a.sentenceUr : a.sentence}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-warm-gray">
            <span className="inline-flex items-center gap-1">via {ai.name} · for <PersonChip id={a.personId} /></span>
            <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> waiting {a.waitingMin} min</span>
            {escalated && <span className="px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">Sent to {backup?.shortName ?? backup?.name} after {a.escalateAfterMin} min</span>}
          </div>
        </div>
        <RiskBadge risk={a.risk} />
      </div>

      <div className="rounded-md border border-stone-border bg-stone-canvas/60 p-3 space-y-1.5">
        <p className="text-[11px] uppercase tracking-wider text-ash-gray">Why you&apos;re seeing this</p>
        <p className="text-sm text-ink-black">Your rule: {a.rule}.</p>
        <p className="text-sm text-ink-black"><span className="text-cyan-signal font-medium">From memory:</span> {a.memoryReason}</p>
      </div>

      {!compact && (
        <div className="text-sm space-y-1">
          <p className="text-warm-gray">To <span className="text-ink-black">{a.to}</span> · <span className="text-ink-black">{a.subject}</span></p>
          {a.attachment && <p className="inline-flex items-center gap-1 text-xs text-warm-gray"><Paperclip className="w-3 h-3" /> {a.attachment}</p>}
          {editing ? (
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="w-full p-2.5 rounded-inputs border border-stone-border bg-surface text-sm text-ink-black focus:outline-none focus:border-cyan-edge/70" />
          ) : (
            <p className="whitespace-pre-line text-ink-black/90 text-sm leading-relaxed">{body}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onDecide('rejected')} className="btn-cyan text-xs h-8 px-3 inline-flex items-center gap-1.5"><X className="w-3.5 h-3.5" /> Block</button>
        <button type="button" onClick={() => onDecide('approved')} className="btn-ghost text-xs h-8 px-3 inline-flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> {editing ? 'Send edited' : 'Allow once'}</button>
        {!compact && (
          <button type="button" onClick={() => setEditing((e) => !e)} className="btn-ghost text-xs h-8 px-3 inline-flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" /> {editing ? 'Done editing' : 'Edit first'}</button>
        )}
        <span className="text-[11px] text-ash-gray ml-auto">If nobody answers, Sentinel {a.onTimeout === 'hold' ? 'holds it and tells the sender' : 'sends it'}.</span>
      </div>
      {!compact && <Details>{`tool: draft_client_email · session via ${ai.name} MCP\nto: ${a.to}\nrule matched: "${a.rule}"`}</Details>}
    </article>
  );
}
