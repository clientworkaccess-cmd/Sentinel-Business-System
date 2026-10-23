'use client';

import React, { useState } from 'react';
import { AI_APPROVALS, AUTO_SENT_TODAY, APPROVAL_SETTINGS, getAi, type AiApproval } from '@/demo/ai';
import { getPerson } from '@/demo/org';
import { AiMark, LangToggle, PanelHeader, RiskBadge, Stat, useLang } from './parts';

type Decision = 'approved' | 'rejected';

/** Messages a connected AI wants to send through Sentinel that matched a rule. */
export function ApprovalsPanel() {
  const [decided, setDecided] = useState<Record<string, Decision>>({});
  const pending = AI_APPROVALS.filter((a) => !decided[a.id]);
  const done = AI_APPROVALS.filter((a) => decided[a.id]);

  return (
    <div className="space-y-6">
      <PanelHeader title="Approvals" hint="Messages your AI wants to send that match one of your rules." action={<LangToggle />} />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Waiting" value={pending.length} />
        <Stat label="Sent without approval today" value={AUTO_SENT_TODAY} />
        <Stat label="Escalates after" value={`${APPROVAL_SETTINGS.escalateAfterMin} min`} />
      </div>

      <div className="space-y-3">
        {pending.length === 0 && <p className="stone-card p-6 text-sm text-warm-gray text-center">Nothing waiting.</p>}
        {pending.map((a) => (
          <ApprovalCard key={a.id} a={a} onDecide={(d) => setDecided((m) => ({ ...m, [a.id]: d }))} />
        ))}
      </div>

      {done.length > 0 && (
        <div className="stone-card p-4 space-y-1">
          <h3 className="text-sm font-semibold text-ink-black">Decided</h3>
          {done.map((a) => (
            <p key={a.id} className="text-sm text-warm-gray">{decided[a.id] === 'approved' ? 'Sent' : 'Rejected'}: {a.subject}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ a, onDecide }: { a: AiApproval; onDecide: (d: Decision) => void }) {
  const { lang } = useLang();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(a.body);
  const ai = getAi(a.ai);
  const person = getPerson(a.personId);
  const escalatedTo = a.escalatedToId ? getPerson(a.escalatedToId) : undefined;

  return (
    <article className="stone-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AiMark id={a.ai} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-black leading-snug">{lang === 'ur' ? a.sentenceUr : a.sentence}</p>
          <p className="mt-0.5 text-xs text-warm-gray">
            {person?.shortName ?? person?.name} via {ai.name} · {a.waitingMin} min ago
            {escalatedTo && ` · Escalated to ${escalatedTo.shortName ?? escalatedTo.name}`}
          </p>
        </div>
        <RiskBadge risk={a.risk} />
      </div>

      <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-warm-gray">Rule</dt>
        <dd className="text-ink-black">{a.rule}</dd>
        <dt className="text-warm-gray">Context</dt>
        <dd className="text-ink-black">{a.context}</dd>
        <dt className="text-warm-gray">To</dt>
        <dd className="text-ink-black">{a.to}{a.attachment && <span className="text-warm-gray"> · {a.attachment}</span>}</dd>
      </dl>

      <div className="rounded-md border border-stone-border bg-stone-canvas/60 p-3">
        <p className="text-sm font-medium text-ink-black mb-1">{a.subject}</p>
        {editing ? (
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="w-full p-2.5 rounded-inputs border border-stone-border bg-surface text-sm text-ink-black focus:outline-none focus:border-cyan-edge/70" />
        ) : (
          <p className="whitespace-pre-line text-sm text-ink-black/90 leading-relaxed">{body}</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onDecide('approved')} className="btn-cyan text-xs h-8 px-3">{editing ? 'Send edited' : 'Approve'}</button>
        <button type="button" onClick={() => setEditing((e) => !e)} className="btn-ghost text-xs h-8 px-3">{editing ? 'Done' : 'Edit'}</button>
        <button type="button" onClick={() => onDecide('rejected')} className="btn-ghost text-xs h-8 px-3">Reject</button>
      </div>
    </article>
  );
}
