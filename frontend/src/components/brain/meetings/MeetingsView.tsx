'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check, CheckCircle2, Circle, Clock, Gavel, Loader2, Mic, Pencil, Plug, ShieldCheck, Sparkles, Square, X,
} from 'lucide-react';
import { ORG, firstName, getItem, getPerson } from '@/demo/org';
import { MEETING_DETAILS, type ActionItem, type MeetingDetail, type TranscriptLine } from '@/demo/meetings';
import { SAMPLE_VOICE_NOTE, extractActions } from '@/demo/extract';
import { itemsInScope } from '@/demo/visibility';
import type { BrainItem, Viewer } from '@/demo/types';
import { useBrainStore } from '@/stores/useBrainStore';
import { useMeetingNotesStore, type Review, type VoiceNote } from '@/stores/useMeetingNotesStore';
import { cn } from '@/lib/utils';
import { Avatar, AvatarStack, Card, SectionTitle } from '../atoms';
import { formatDate, sourceLabel } from '../meta';
import { useRecorder } from '../chat/voice';

/** One shape for both recorded meetings and voice notes, so the list and detail never branch on type. */
interface Entry {
  id: string;
  title: string;
  dateLabel: string;
  source: string;
  summary?: string;
  peopleIds: string[];
  guests: string[];
  decisions: string[];
  actions: ActionItem[];
  transcript: TranscriptLine[];
  durationMin?: number;
  departmentId?: string;
  isNote: boolean;
}

type Filter = 'all' | 'approval' | 'notes';

const OWNER_ID = ORG.ownerId;

function fromMeeting(item: BrainItem, d: MeetingDetail): Entry {
  return {
    id: item.id, title: item.title, dateLabel: `${formatDate(item.date)} · ${d.time}`, source: item.source ?? 'zoom',
    summary: item.summary, peopleIds: item.ownerIds, guests: d.guests ?? [], decisions: d.decisions, actions: d.actions,
    transcript: d.transcript, durationMin: d.durationMin, departmentId: item.departmentId, isNote: false,
  };
}

function fromNote(n: VoiceNote): Entry {
  return {
    id: n.id, title: n.title, dateLabel: n.when, source: 'voice_note', summary: n.summary, peopleIds: [n.ownerId], guests: [],
    decisions: [], actions: n.actions, transcript: n.transcript, departmentId: getPerson(n.ownerId)?.departmentId, isNote: true,
  };
}

type ActionStatus = ActionItem['status'] | Review['status'];

/** A human decision, if one was made, wins over the item's starting status. */
const statusOf = (a: ActionItem, reviews: Record<string, Review>): ActionStatus =>
  (reviews[a.id] as Review | undefined)?.status ?? a.status;

/**
 * Who may release a message to someone outside the company: the Owner, or the
 * Admin whose team the meeting belongs to. Members can see that it is waiting.
 */
function canApprove(viewer: Viewer, entry: Entry): boolean {
  if (viewer.role === 'owner') return true;
  if (viewer.role === 'admin') return getPerson(viewer.personId)?.departmentId === entry.departmentId;
  return false;
}

export function MeetingsView() {
  const { viewer, scope } = useBrainStore();
  const { notes, reviews } = useMeetingNotesStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo(() => {
    const meetings = itemsInScope(ORG, viewer, scope)
      .filter((i) => i.kind === 'meeting' && MEETING_DETAILS[i.id])
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .map((i) => fromMeeting(i, MEETING_DETAILS[i.id]));
    // Your own voice notes; the Owner sees everyone's.
    const mine = notes.filter((n) => n.ownerId === viewer.personId || viewer.role === 'owner').map(fromNote);
    return [...mine, ...meetings];
  }, [viewer, scope, notes]);

  const pending = (e: Entry) => e.actions.filter((a) => statusOf(a, reviews) === 'pending_approval').length;
  const shown = entries.filter((e) => (filter === 'approval' ? pending(e) > 0 : filter === 'notes' ? e.isNote : true));
  const selected = entries.find((e) => e.id === selectedId) ?? shown[0] ?? null;

  // A role switch can hide the open meeting; fall back to the first visible one.
  useEffect(() => {
    if (selectedId && !entries.some((e) => e.id === selectedId)) setSelectedId(null);
  }, [entries, selectedId]);

  const totalPending = entries.reduce((n, e) => n + pending(e), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] leading-tight text-ink-black">Meetings & notes</h1>
          <p className="text-sm text-warm-gray mt-1">
            Every call and voice note becomes decisions and action items. Anything going to a client waits for a human.
          </p>
        </div>
        <Link
          href="/brain/connectors?category=meetings"
          className="btn-ghost text-sm inline-flex items-center gap-2"
        >
          <Plug className="w-4 h-4" /> Connect a note-taker
        </Link>
      </div>

      <VoiceNoteRecorder viewer={viewer} onCreated={(id) => { setFilter('all'); setSelectedId(id); }} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6 items-start">
        <div className="min-w-0 space-y-3">
          <div role="tablist" aria-label="Filter meetings" className="flex gap-1.5 flex-wrap">
            {([
              ['all', `All · ${entries.length}`],
              ['approval', `Needs approval · ${totalPending}`],
              ['notes', `Voice notes · ${entries.filter((e) => e.isNote).length}`],
            ] as [Filter, string][]).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  'px-3 h-8 rounded-full text-xs font-medium border transition',
                  filter === key ? 'bg-inverse text-white border-transparent' : 'border-stone-border text-warm-gray hover:text-ink-black bg-white',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <Card className="p-1.5">
            {shown.length === 0 ? (
              <p className="text-sm text-warm-gray p-6 text-center">
                {filter === 'notes' ? 'No voice notes yet. Record one above.' : 'Nothing is waiting for approval.'}
              </p>
            ) : (
              shown.map((e) => {
                const p = pending(e);
                const active = selected?.id === e.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => setSelectedId(e.id)}
                    className={cn(
                      'w-full text-left rounded-lg px-3 py-3 transition flex gap-3',
                      active ? 'bg-sky-wash/50' : 'hover:bg-stone-border/40',
                    )}
                  >
                    <SourceTile source={e.source} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-ink-black truncate">{e.title}</span>
                      <span className="block text-xs text-warm-gray mt-0.5">
                        {e.dateLabel}
                        {e.durationMin ? ` · ${e.durationMin} min` : ''}
                      </span>
                      <span className="flex flex-wrap gap-1.5 mt-2">
                        {e.decisions.length > 0 && <Chip>{e.decisions.length} decisions</Chip>}
                        <Chip>{e.actions.length} actions</Chip>
                        {p > 0 && <Chip tone="sky">{p} needs approval</Chip>}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </Card>
        </div>

        <div className="min-w-0">{selected ? <MeetingDetailCard entry={selected} viewer={viewer} /> : null}</div>
      </div>
    </div>
  );
}

/* ── Detail ────────────────────────────────────────────────────────────── */

function MeetingDetailCard({ entry, viewer }: { entry: Entry; viewer: Viewer }) {
  const router = useRouter();
  const approver = canApprove(viewer, entry);

  return (
    <Card className="p-5 sm:p-6 space-y-7">
      <header>
        <div className="flex items-center gap-2 text-xs text-warm-gray">
          <SourceTile source={entry.source} small />
          {entry.isNote ? 'Voice note' : `Recorded by ${sourceLabel(entry.source)}`} · {entry.dateLabel}
          {entry.durationMin ? ` · ${entry.durationMin} min` : ''}
        </div>
        <h2 className="font-display text-[26px] leading-tight text-ink-black mt-2">{entry.title}</h2>
        {entry.summary && <p className="text-sm text-ink-black/85 leading-relaxed mt-2">{entry.summary}</p>}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <AvatarStack ids={entry.peopleIds} max={6} size="sm" />
          {entry.guests.map((g) => (
            <span key={g} className="text-[11px] px-2 py-0.5 rounded-full border border-stone-border text-warm-gray">
              {g}
            </span>
          ))}
          <span className="flex-1" />
          <button
            onClick={() => router.push(`/brain/chat?q=${encodeURIComponent(`What was decided in "${entry.title}" and who owes what?`)}`)}
            className="text-xs inline-flex items-center gap-1.5 text-cyan-edge hover:underline"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask Sentinel about this
          </button>
        </div>
      </header>

      {entry.decisions.length > 0 && (
        <section>
          <SectionTitle title="Decisions" />
          <ul className="space-y-2">
            {entry.decisions.map((d) => (
              <li key={d} className="flex gap-2.5 text-sm text-ink-black/90">
                <Gavel className="w-4 h-4 text-cyan-signal shrink-0 mt-0.5" /> {d}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle title="Action items" hint={entry.actions.some((a) => a.externalTo) ? 'Client-facing items wait for approval before anything is sent' : undefined} />
        {entry.actions.length === 0 ? (
          <p className="text-sm text-warm-gray">No commitments were heard in this one.</p>
        ) : (
          <div className="space-y-2">
            {entry.actions.map((a) => <ActionRow key={a.id} action={a} canApprove={approver} />)}
          </div>
        )}
      </section>

      {entry.transcript.length > 0 && (
        <section>
          <SectionTitle title="Transcript" hint={entry.isNote ? undefined : 'Excerpt'} />
          <div className="space-y-3">
            {entry.transcript.map((line, i) => {
              const person = getPerson(line.speaker);
              return (
                <div key={i} className="flex gap-3">
                  {person ? <Avatar person={person} size="sm" /> : (
                    <span className="w-7 h-7 rounded-full border border-stone-border text-[10px] text-warm-gray flex items-center justify-center shrink-0">
                      {line.speaker.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-warm-gray">
                      <span className="font-medium text-ink-black">{person?.name ?? line.speaker}</span>
                      {line.at && <span className="ml-2 tabular-nums">{line.at}</span>}
                    </p>
                    <p className="text-sm text-ink-black/90 leading-relaxed">{line.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </Card>
  );
}

function ActionRow({ action, canApprove: approver }: { action: ActionItem; canApprove: boolean }) {
  const { viewer } = useBrainStore();
  const { reviews, review } = useMeetingNotesStore();
  const decision = reviews[action.id] as Review | undefined;
  const status: ActionStatus = decision?.status ?? action.status;
  const owner = getPerson(action.ownerId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(decision?.draft ?? action.draft ?? '');
  const [open, setOpen] = useState(status === 'pending_approval');
  const linked = action.itemId ? getItem(action.itemId) : undefined;

  const decide = (s: Review['status']) => {
    review(action.id, { status: s, draft, by: viewer.personId });
    setEditing(false);
  };

  return (
    <div className={cn('rounded-cards border', status === 'pending_approval' ? 'border-sky-200 bg-sky-50/40' : 'border-stone-border')}>
      <button onClick={() => action.draft && setOpen((o) => !o)} className="w-full text-left flex items-start gap-3 px-3.5 py-3">
        <StatusIcon status={status} />
        <span className="flex-1 min-w-0">
          <span className={cn('block text-sm text-ink-black', status === 'rejected' && 'line-through text-warm-gray')}>{action.text}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-warm-gray">
            <span className="inline-flex items-center gap-1.5"><Avatar person={owner} size="xs" /> {owner?.name}</span>
            {action.due && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDate(action.due)}</span>}
            {action.externalTo && <span>→ {action.externalTo}</span>}
            {linked && <span className="text-ash-gray">· tracked as “{linked.title}”</span>}
          </span>
        </span>
        <StatusPillFor status={status} by={decision?.by} />
      </button>

      {action.draft && open && (
        <div className="px-3.5 pb-3.5">
          <div className="rounded-lg border border-stone-border bg-white">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-border text-[11px] text-warm-gray">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-700" />
              Drafted by Sentinel. Nothing is sent to {action.externalTo} until a person approves it.
            </div>
            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="w-full p-3 text-sm leading-relaxed text-ink-black bg-transparent outline-none resize-y"
              />
            ) : (
              <pre className="p-3 text-sm leading-relaxed text-ink-black/90 whitespace-pre-wrap font-sans">{draft}</pre>
            )}
          </div>

          {status === 'pending_approval' && (
            approver ? (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button onClick={() => decide('approved')} className="btn-cyan text-xs inline-flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Approve & send
                </button>
                <button onClick={() => setEditing((e) => !e)} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                  <Pencil className="w-3.5 h-3.5" /> {editing ? 'Done editing' : 'Edit'}
                </button>
                <button onClick={() => decide('rejected')} className="text-xs px-3 py-2 rounded-full text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-warm-gray">
                Waiting for {firstName(getPerson(OWNER_ID))} or the team admin to approve. You can see it, but only they can send it.
              </p>
            )
          )}
          {status === 'approved' && (
            <p className="mt-3 text-xs text-emerald-700">Approved by {firstName(getPerson(decision?.by ?? ''))}. Queued to send (demo: nothing actually leaves).</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Voice notes ───────────────────────────────────────────────────────── */

function VoiceNoteRecorder({ viewer, onCreated }: { viewer: Viewer; onCreated: (id: string) => void }) {
  const recorder = useRecorder();
  const addNote = useMeetingNotesStore((s) => s.addNote);
  const [notice, setNotice] = useState<string | null>(null);

  const create = (text: string) => {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const id = `note-${now.getTime()}`;
    const actions = extractActions(text, viewer.personId, id);
    addNote({
      id,
      ownerId: viewer.personId,
      title: `Voice note · ${hhmm}`,
      when: `Today · ${hhmm}`,
      summary: text.split(/(?<=[.!?])\s+/)[0],
      transcript: [{ speaker: viewer.personId, at: '00:00', text }],
      actions,
    });
    setNotice(null);
    onCreated(id);
  };

  const start = async () => {
    setNotice(null);
    if (!(await recorder.start())) setNotice('Microphone is blocked or unavailable.');
  };

  const stop = async () => {
    const text = await recorder.stop();
    if (text.trim()) create(text);
    else setNotice("I didn't catch anything.");
  };

  return (
    <Card className="p-4 flex flex-wrap items-center gap-3">
      <span className="w-10 h-10 rounded-full bg-sky-wash/60 text-cyan-edge flex items-center justify-center shrink-0">
        <Mic className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-medium text-ink-black">Voice note</p>
        <p className="text-xs text-warm-gray">
          {recorder.state === 'recording'
            ? 'Listening… say what you promised, to whom, and by when.'
            : recorder.state === 'transcribing'
              ? 'Transcribing and pulling out action items…'
              : notice ?? 'Talk for a minute after a call. Sentinel transcribes it and pulls out the follow-ups.'}
        </p>
      </div>

      {recorder.state === 'recording' && (
        <div className="flex items-center gap-[3px] h-8" aria-hidden="true">
          {recorder.levels.slice(0, 18).map((l, i) => (
            <span key={i} className="w-[3px] rounded-full bg-cyan-signal" style={{ height: `${Math.round(l * 100)}%` }} />
          ))}
          <span className="ml-2 text-xs tabular-nums text-warm-gray">
            {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}
          </span>
        </div>
      )}

      {recorder.state === 'idle' && (
        <>
          {notice && (
            <button onClick={() => create(SAMPLE_VOICE_NOTE)} className="btn-ghost text-xs">
              Use a sample note instead
            </button>
          )}
          <button onClick={start} className="btn-cyan text-sm inline-flex items-center gap-2">
            <Mic className="w-4 h-4" /> Record
          </button>
        </>
      )}
      {recorder.state === 'recording' && (
        <>
          <button onClick={recorder.cancel} className="btn-ghost text-xs">Cancel</button>
          <button onClick={stop} className="btn-cyan text-sm inline-flex items-center gap-2">
            <Square className="w-3.5 h-3.5 fill-current" /> Stop
          </button>
        </>
      )}
      {recorder.state === 'transcribing' && <Loader2 className="w-5 h-5 animate-spin text-cyan-signal" />}
    </Card>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────── */

const SOURCE_TONES: Record<string, string> = {
  zoom: 'bg-[#2d8cff]', google_meet: 'bg-[#00897b]', fireflies: 'bg-[#7c3aed]', otter: 'bg-[#0f62fe]',
  fathom: 'bg-[#111827]', granola: 'bg-[#65a30d]', voice_note: 'bg-cyan-signal',
};

function SourceTile({ source, small }: { source: string; small?: boolean }) {
  return (
    <span
      title={sourceLabel(source)}
      className={cn(
        'rounded-md text-white font-semibold flex items-center justify-center shrink-0',
        small ? 'w-5 h-5 text-[9px]' : 'w-9 h-9 text-[11px]',
        SOURCE_TONES[source] ?? 'bg-warm-gray',
      )}
    >
      {source === 'voice_note' ? <Mic className={small ? 'w-3 h-3' : 'w-4 h-4'} /> : sourceLabel(source).slice(0, 2)}
    </span>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'sky' }) {
  return (
    <span className={cn('text-[11px] px-2 py-0.5 rounded-full border', tone === 'sky' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'border-stone-border text-warm-gray')}>
      {children}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'done' || status === 'approved') return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />;
  if (status === 'pending_approval') return <ShieldCheck className="w-4 h-4 text-sky-700 shrink-0 mt-0.5" />;
  if (status === 'rejected') return <X className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />;
  return <Circle className="w-4 h-4 text-ash-gray shrink-0 mt-0.5" />;
}

function StatusPillFor({ status, by }: { status: string; by?: string }) {
  const map: Record<string, [string, string]> = {
    open: ['Open', 'border-stone-border text-warm-gray'],
    done: ['Done', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    pending_approval: ['Needs approval', 'bg-sky-50 text-sky-700 border-sky-200'],
    approved: [`Approved${by ? ` · ${firstName(getPerson(by))}` : ''}`, 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    rejected: ['Rejected', 'bg-rose-50 text-rose-700 border-rose-200'],
  };
  const [label, cls] = map[status] ?? map.open;
  return <span className={cn('text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0', cls)}>{label}</span>;
}
