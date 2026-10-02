'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ArrowUp, Network, Sparkles } from 'lucide-react';
import { ORG, getDepartment, getItem, getPerson, getTeam } from '@/demo/org';
import { SUGGESTED_PROMPTS } from '@/demo/prompts';
import { itemsInScope, peopleInScope, scopeLabel } from '@/demo/visibility';
import type { BrainItem, ItemStatus, Scope } from '@/demo/types';
import { useBrainStore } from '@/stores/useBrainStore';
import { Avatar, AvatarStack, Card, ItemRow, SectionTitle } from './atoms';
import { ItemDrawer } from './ItemDrawer';
import { KIND_META, hueColor, sourceLabel } from './meta';

/** How urgently a status asks for a human. Lower sorts first. */
const URGENCY: Partial<Record<ItemStatus, number>> = { pending_approval: 0, blocked: 1, at_risk: 2 };

const isOpenTask = (i: BrainItem) => i.kind === 'task' && i.status !== 'done';

export function Overview() {
  const { viewer, scope } = useBrainStore();
  const [openItem, setOpenItem] = useState<BrainItem | null>(null);

  const items = useMemo(() => itemsInScope(ORG, viewer, scope), [viewer, scope]);
  const people = useMemo(() => peopleInScope(ORG, scope), [scope]);

  const attention = useMemo(
    () =>
      items
        .filter((i) => i.status && URGENCY[i.status] !== undefined)
        .sort((a, b) => URGENCY[a.status!]! - URGENCY[b.status!]!)
        .slice(0, 6),
    [items],
  );
  const decisions = useMemo(
    () => items.filter((i) => i.kind === 'decision').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 4),
    [items],
  );

  return (
    <div className="space-y-8">
      <Greeting scope={scope} />
      <AskCard />
      <KpiRow items={items} peopleCount={people.length} isPersonal={scope.level === 'member'} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3 p-5 min-w-0">
          <SectionTitle
            title="Needs attention"
            hint={attention.length ? 'Blocked, at risk, or waiting on a human' : undefined}
          />
          {attention.length ? (
            <div className="-mx-3">
              {attention.map((i) => <ItemRow key={i.id} item={i} onClick={() => setOpenItem(i)} showSummary />)}
            </div>
          ) : (
            <p className="text-sm text-warm-gray py-6 text-center">Nothing is slipping here. Sentinel will flag it when something does.</p>
          )}
        </Card>

        <div className="lg:col-span-2 space-y-6 min-w-0">
          <Card className="p-5">
            <SectionTitle title="Recent decisions" />
            {decisions.length ? (
              <div className="-mx-3">
                {decisions.map((i) => <ItemRow key={i.id} item={i} onClick={() => setOpenItem(i)} />)}
              </div>
            ) : (
              <p className="text-sm text-warm-gray">No decisions recorded in this view yet.</p>
            )}
          </Card>
          <SourcesCard items={items} />
        </div>
      </div>

      <Children scope={scope} items={items} onOpenItem={setOpenItem} />

      <ItemDrawer item={openItem} onClose={() => setOpenItem(null)} onOpenItem={setOpenItem} />
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────────────────────── */

function Greeting({ scope }: { scope: Scope }) {
  const { viewer } = useBrainStore();
  const router = useRouter();
  const me = getPerson(viewer.personId);
  // Time-of-day is read after mount; the server cannot know the presenter's clock.
  const [greeting, setGreeting] = useState('Hello');
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  const looking = scope.level === 'member' && scope.id === viewer.personId ? 'your work' : scopeLabel(ORG, scope);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-ash-gray">Friday, 2 October</p>
        <h1 className="font-display text-[34px] sm:text-[40px] leading-[1.1] text-ink-black mt-1">
          {greeting}, {me?.name.split(' ')[0]}.
        </h1>
        <p className="text-sm text-warm-gray mt-2">
          Here is what Sentinel remembers about <span className="cyan-highlight">{looking}</span> today.
        </p>
      </div>
      <button onClick={() => router.push('/brain/graph')} className="btn-ghost text-sm inline-flex items-center gap-2">
        <Network className="w-4 h-4" /> Open the graph
      </button>
    </div>
  );
}

function AskCard() {
  const { viewer } = useBrainStore();
  const router = useRouter();
  const [q, setQ] = useState('');
  const go = (text: string) => text.trim() && router.push(`/brain/chat?q=${encodeURIComponent(text.trim())}`);

  return (
    <div className="relative overflow-hidden rounded-feature border border-stone-border bg-white shadow-card">
      {/* Soft brand wash, so the one place you type feels like the centre of the page. */}
      <div
        className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(59,166,241,0.28), transparent 70%)' }}
        aria-hidden="true"
      />
      <form
        className="relative p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <label htmlFor="ask" className="flex items-center gap-2 text-sm font-medium text-ink-black">
          <Sparkles className="w-4 h-4 text-cyan-signal" /> Ask your business
        </label>
        <div className="mt-3 flex items-center gap-2 rounded-full border border-stone-border bg-stone-canvas pl-5 pr-1.5 h-12 focus-within:border-cyan-edge/70 transition">
          <input
            id="ask"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. What did we promise Kestrel Health?"
            className="flex-1 bg-transparent outline-none text-[15px] text-ink-black placeholder:text-ash-gray"
          />
          <button type="submit" aria-label="Ask" className="w-9 h-9 rounded-full bg-cyan-signal hover:bg-cyan-edge text-white flex items-center justify-center transition">
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS[viewer.role].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              className="px-3 py-1.5 rounded-full border border-stone-border text-xs text-warm-gray hover:text-ink-black hover:border-stone-muted transition"
            >
              {p}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

/* ── KPIs ───────────────────────────────────────────────────────────────── */

function KpiRow({ items, peopleCount, isPersonal }: { items: BrainItem[]; peopleCount: number; isPersonal: boolean }) {
  const openTasks = items.filter(isOpenTask).length;
  const approvals = items.filter((i) => i.status === 'pending_approval').length;
  const blocked = items.filter((i) => i.status === 'blocked' || i.status === 'at_risk').length;
  // Clients this view's work touches, not just client records it owns — otherwise
  // Engineering, which builds every client app, would show zero clients.
  const clientIds = new Set(items.filter((i) => i.kind === 'client').map((i) => i.id));
  for (const i of items) for (const r of i.relatedIds ?? []) if (getItem(r)?.kind === 'client') clientIds.add(r);
  const clients = [...clientIds].map(getItem).filter((c): c is BrainItem => !!c);
  const meetings = items.filter((i) => i.kind === 'meeting').length;

  const tiles = isPersonal
    ? [
        { label: 'Open commitments', value: openTasks, note: 'Tasks you own' },
        { label: 'Meetings remembered', value: meetings, note: 'Last 2 weeks' },
        { label: 'Blocked or at risk', value: blocked, note: blocked ? 'Sentinel is watching these' : 'All clear', alert: blocked > 0 },
        { label: 'Memories', value: items.length, note: 'Across your connected apps' },
      ]
    : [
        { label: 'People', value: peopleCount, note: 'In this view' },
        { label: 'Clients', value: clients.length, note: `${clients.filter((c) => c.status === 'at_risk').length} at risk`, alert: clients.some((c) => c.status === 'at_risk') },
        { label: 'Open commitments', value: openTasks, note: `${blocked} blocked or at risk`, alert: blocked > 0 },
        { label: 'Awaiting approval', value: approvals, note: 'External messages held', accent: approvals > 0 },
      ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <Card key={t.label} className="p-4">
          <p className="text-xs text-warm-gray">{t.label}</p>
          <p className="font-display text-[32px] leading-none mt-2 text-ink-black tabular-nums">{t.value}</p>
          <p className={`text-xs mt-2 ${'accent' in t && t.accent ? 'text-cyan-edge' : 'alert' in t && t.alert ? 'text-amber-700' : 'text-ash-gray'}`}>
            {t.note}
          </p>
        </Card>
      ))}
    </div>
  );
}

function SourcesCard({ items }: { items: BrainItem[] }) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.source) m.set(i.source, (m.get(i.source) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [items]);
  const max = counts[0]?.[1] ?? 1;

  return (
    <Card className="p-5">
      <SectionTitle title="Where this memory came from" />
      <ul className="space-y-2.5">
        {counts.map(([source, n]) => (
          <li key={source} className="flex items-center gap-3 text-sm">
            <span className="w-28 text-warm-gray truncate">{sourceLabel(source)}</span>
            <span className="flex-1 h-1.5 rounded-full bg-stone-border/60 overflow-hidden">
              <span className="block h-full rounded-full bg-cyan-signal/80" style={{ width: `${(n / max) * 100}%` }} />
            </span>
            <span className="w-6 text-right tabular-nums text-ink-black">{n}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Drill-down ─────────────────────────────────────────────────────────── */

function Children({ scope, items, onOpenItem }: { scope: Scope; items: BrainItem[]; onOpenItem: (i: BrainItem) => void }) {
  const { setScope } = useBrainStore();

  if (scope.level === 'member') {
    const kinds = (['task', 'meeting', 'thread', 'document', 'project', 'client', 'decision'] as const)
      .map((k) => ({ kind: k, list: items.filter((i) => i.kind === k) }))
      .filter((g) => g.list.length);
    return (
      <section>
        <SectionTitle title="Personal brain" hint="Everything Sentinel has connected to this person" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {kinds.map(({ kind, list }) => (
            <Card key={kind} className="p-4">
              <p className="text-xs uppercase tracking-wider text-ash-gray mb-1 px-1">{KIND_META[kind].plural}</p>
              <div className="-mx-2">
                {list.map((i) => <ItemRow key={i.id} item={i} onClick={() => onOpenItem(i)} />)}
              </div>
            </Card>
          ))}
        </div>
      </section>
    );
  }

  type Child = { scope: Scope; name: string; sub: string; hue: number; leadId: string; peopleIds: string[] };
  let children: Child[] = [];
  let title = '';

  if (scope.level === 'org') {
    title = 'Departments';
    children = ORG.departments.map((d) => ({
      scope: { level: 'department', id: d.id },
      name: d.name,
      sub: d.description ?? '',
      hue: d.hue,
      leadId: d.headId,
      peopleIds: ORG.people.filter((p) => p.departmentId === d.id).map((p) => p.id),
    }));
  } else if (scope.level === 'department') {
    title = 'Teams';
    const d = getDepartment(scope.id);
    children = (d?.teamIds ?? []).map((tid) => {
      const t = getTeam(tid)!;
      return { scope: { level: 'team', id: t.id }, name: t.name, sub: `Led by ${getPerson(t.leadId)?.name}`, hue: d!.hue, leadId: t.leadId, peopleIds: t.memberIds };
    });
  } else {
    title = 'People';
    const t = getTeam(scope.id);
    const hue = t ? getDepartment(t.departmentId)?.hue ?? 205 : 205;
    children = (t?.memberIds ?? []).map((id) => {
      const p = getPerson(id)!;
      return { scope: { level: 'member', id }, name: p.name, sub: p.title, hue, leadId: id, peopleIds: [id] };
    });
  }

  return (
    <section>
      <SectionTitle title={title} hint="Click to zoom in" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {children.map((c) => {
          const ids = new Set(c.peopleIds);
          const childItems = items.filter((i) => i.ownerIds.some((o) => ids.has(o)));
          const risky = childItems.filter((i) => i.status === 'at_risk' || i.status === 'blocked').length;
          return (
            <button
              key={c.scope.id}
              onClick={() => setScope(c.scope)}
              className="group text-left stone-card p-5 hover:shadow-preview hover:-translate-y-0.5 transition duration-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hueColor(c.hue), boxShadow: `0 0 0 4px ${hueColor(c.hue, 0.15)}` }} />
                  <span className="font-medium text-ink-black truncate">{c.name}</span>
                </div>
                <ArrowRight className="w-4 h-4 text-ash-gray group-hover:text-cyan-signal group-hover:translate-x-0.5 transition shrink-0" />
              </div>
              <p className="text-xs text-warm-gray mt-1.5 line-clamp-2 min-h-[2rem]">{c.sub}</p>
              <div className="flex items-center justify-between mt-4">
                {c.peopleIds.length > 1 ? <AvatarStack ids={c.peopleIds} max={5} size="sm" /> : <Avatar person={getPerson(c.leadId)} />}
                <span className="text-xs text-warm-gray tabular-nums">
                  {childItems.length} memories
                  {risky > 0 && <span className="text-amber-700"> · {risky} at risk</span>}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
