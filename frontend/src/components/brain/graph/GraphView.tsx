'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { ORG, getDepartment, getPerson } from '@/demo/org';
import { canViewScope, itemsInScope, peopleInScope, scopePath } from '@/demo/visibility';
import type { BrainItem, ItemKind, Scope, ScopeLevel } from '@/demo/types';
import { useBrainStore } from '@/stores/useBrainStore';
import { cn } from '@/lib/utils';
import { ItemDrawer } from '../ItemDrawer';
import { KIND_META } from '../meta';
import { BrainGraph } from './BrainGraph';
import { KIND_COLORS, STATUS_RING, buildGraph } from './model';

/** Three levels, one per role: the Owner's business, an Admin's team, a Member's own brain. */
const LEVELS: { level: ScopeLevel; label: string }[] = [
  { level: 'org', label: 'Business' },
  { level: 'department', label: 'Team' },
  { level: 'member', label: 'Individual' },
];

/** Where the level switcher goes: stay on the current branch where possible. */
function targetFor(level: ScopeLevel, current: Scope, viewerId: string): Scope {
  const path = scopePath(ORG, current);
  const at = (l: ScopeLevel) => path.find((s) => s.level === l);
  const me = getPerson(viewerId);
  switch (level) {
    case 'department':
      return at('department') ?? { level: 'department', id: me?.departmentId ?? ORG.departments[0].id };
    case 'member': {
      const m = at('member');
      if (m) return m;
      // From a team, step into its admin; from the business view, into yourself.
      const deptId = at('department')?.id;
      return { level: 'member', id: deptId ? getDepartment(deptId)!.headId : viewerId };
    }
    default:
      return { level: 'org', id: ORG.id };
  }
}

export function GraphView() {
  const { viewer, scope, setScope } = useBrainStore();
  const [openItem, setOpenItem] = useState<BrainItem | null>(null);
  // d3 needs real layout and the presenter's screen; nothing useful renders on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const scopeKey = `${viewer.role}:${scope.level}:${scope.id}`;
  const model = useMemo(() => buildGraph(ORG, viewer, scope), [viewer, scope]);
  const people = peopleInScope(ORG, scope).length;
  const memories = useMemo(() => itemsInScope(ORG, viewer, scope).length, [viewer, scope]);

  const openPerson = useCallback(
    (id: string) => setScope({ level: 'member', id }),
    [setScope],
  );

  const kindsShown = useMemo(
    () => [...new Set(model.nodes.filter((n) => n.item).map((n) => n.item!.kind))] as ItemKind[],
    [model],
  );

  return (
    <div className="relative w-full h-full rounded-feature overflow-hidden border border-stone-border bg-[#0f0d0c] shadow-preview">
      {mounted && (
        <BrainGraph
          key={scopeKey}
          model={model}
          scopeKey={scopeKey}
          onDrill={setScope}
          onOpenItem={setOpenItem}
          onOpenPerson={openPerson}
        />
      )}

      {/* Level switcher */}
      <div className="absolute top-4 left-4 flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Graph level" className="flex p-1 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-md">
          {LEVELS.map(({ level, label }) => {
            const target = targetFor(level, scope, viewer.personId);
            const allowed = canViewScope(ORG, viewer, target);
            const active = scope.level === level;
            return (
              <button
                key={level}
                role="radio"
                aria-checked={active}
                disabled={!allowed}
                onClick={() => setScope(target)}
                title={allowed ? undefined : 'Outside what this role can see'}
                className={cn(
                  'px-3.5 h-8 rounded-full text-xs font-medium transition',
                  active ? 'bg-white text-[#0c0a09]' : allowed ? 'text-white/70 hover:text-white' : 'text-white/25 cursor-not-allowed',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <span className="text-xs text-white/50 tabular-nums">
          {people} {people === 1 ? 'person' : 'people'} · {memories} memories
        </span>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 right-3 max-w-[70%] flex flex-wrap justify-end items-center gap-x-3 gap-y-1.5 px-3.5 py-2 rounded-2xl bg-white/[0.06] border border-white/10 backdrop-blur-md text-[11px] text-white/70">
        {model.dense ? (
          <>
            <LegendDot color="#3ba6f1" ring label="Person" />
            <LegendDot color="rgba(245,245,244,0.6)" small label="Memory (project, meeting, doc…)" />
          </>
        ) : (
          kindsShown.map((k) => <LegendDot key={k} color={KIND_COLORS[k]} label={KIND_META[k].plural} />)
        )}
        {!model.dense && (
          <>
            <span className="w-px h-3 bg-white/15" />
            <LegendDot color={STATUS_RING.blocked!} hollow label="Blocked" />
            <LegendDot color={STATUS_RING.at_risk!} hollow label="At risk" />
            <LegendDot color={STATUS_RING.pending_approval!} hollow label="Needs approval" />
          </>
        )}
      </div>

      <div className="absolute bottom-4 left-4 hidden md:flex items-center gap-2 text-[11px] text-white/45">
        <MousePointerClick className="w-3.5 h-3.5" />
        {scope.level === 'member' ? 'Click a memory to open it · hover to trace connections' : scope.level === 'org' ? 'Click a team to zoom in · hover to trace connections' : 'Click a person to open their brain · hover to trace connections'}
      </div>

      <ItemDrawer item={openItem} onClose={() => setOpenItem(null)} onOpenItem={setOpenItem} />
    </div>
  );
}

function LegendDot({ color, label, hollow, ring, small }: { color: string; label: string; hollow?: boolean; ring?: boolean; small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={cn('rounded-full', small ? 'w-1.5 h-1.5' : 'w-2.5 h-2.5')}
        style={hollow ? { border: `1.5px solid ${color}` } : { backgroundColor: color, boxShadow: ring ? '0 0 0 1.5px rgba(255,255,255,0.8)' : undefined }}
      />
      {label}
    </span>
  );
}
