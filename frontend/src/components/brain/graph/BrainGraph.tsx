'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { BrainItem, Scope } from '@/demo/types';
import { CANVAS, KIND_COLORS, STATUS_RING, hsl, type Box, type GLink, type GNode, type GraphModel } from './model';

interface ViewBox { x: number; y: number; w: number; h: number }
const FULL: ViewBox = { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };
const ZOOM_MS = 520;
const BG = '#0f0d0c';

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const endpoints = (l: GLink) => [l.source as GNode, l.target as GNode] as const;

/** Keep every node inside its own cluster. This, not the forces, is what makes overlap impossible. */
function contain(nodes: GNode[]) {
  for (const n of nodes) {
    if (n.fx != null) continue;
    const b = n.box;
    const pad = n.r + 8;
    const top = b.y + 44 + n.r; // clear of the box title
    if (n.x! < b.x + pad) { n.x = b.x + pad; n.vx = 0; }
    if (n.x! > b.x + b.w - pad) { n.x = b.x + b.w - pad; n.vx = 0; }
    if (n.y! < top) { n.y = top; n.vy = 0; }
    if (n.y! > b.y + b.h - pad) { n.y = b.y + b.h - pad; n.vy = 0; }
  }
}

export function BrainGraph({
  model,
  scopeKey,
  onDrill,
  onOpenItem,
  onOpenPerson,
}: {
  model: GraphModel;
  /** Changes whenever the scope does; restarts the entry animation. */
  scopeKey: string;
  onDrill: (scope: Scope) => void;
  onOpenItem: (item: BrainItem) => void;
  onOpenPerson: (personId: string) => void;
}) {
  const [, setFrame] = useState(0);
  const [view, setView] = useState<ViewBox>(FULL);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverBox, setHoverBox] = useState<string | null>(null);
  const zooming = useRef(false);

  // Simulation: pre-settle synchronously so the first paint is already a layout,
  // then let it finish live for a second so the graph visibly breathes into place.
  useEffect(() => {
    const { nodes, links, dense, spread } = model;
    const sim = forceSimulation<GNode>(nodes)
      .force(
        'link',
        forceLink<GNode, GLink>(links)
          .id((n) => n.id)
          .distance((l) => (l.bridge ? 200 : (l.target as GNode).type === 'person' && (l.source as GNode).type === 'person' ? 70 : spread))
          // Bridges are drawn but never pull: a cross-cluster link must not drag a node out of its box.
          .strength((l) => (l.bridge || l.spoke ? 0 : dense ? 0.5 : 0.35)),
      )
      .force('charge', forceManyBody<GNode>().strength(dense ? -22 : -60).distanceMax(dense ? 110 : 260))
      // Labelled nodes get room for their label, not just their dot: labels are wide.
      .force('collide', forceCollide<GNode>((n) => (dense ? n.r + 2.2 : n.label ? Math.max(n.r + 22, labelHalfWidth(n)) : n.r + 4)).iterations(2))
      .force('x', forceX<GNode>((n) => n.tx ?? n.box.x + n.box.w / 2).strength((n) => (n.tx != null ? 0.09 : 0.03)))
      .force('y', forceY<GNode>((n) => n.ty ?? n.box.y + n.box.h / 2).strength((n) => (n.tx != null ? 0.09 : 0.03)))
      .alphaDecay(0.035)
      .stop();

    for (let i = 0; i < 90; i++) {
      sim.tick();
      contain(nodes);
    }
    setFrame((f) => f + 1);

    let raf = 0;
    sim.on('tick', () => {
      contain(nodes);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFrame((f) => f + 1));
    });
    sim.alpha(0.35).restart();
    return () => {
      sim.stop();
      cancelAnimationFrame(raf);
    };
  }, [model]);

  // A new scope always starts fully zoomed out.
  useEffect(() => {
    setView(FULL);
    setHover(null);
    zooming.current = false;
  }, [scopeKey]);

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of model.links) {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [model]);

  const lit = hover ? new Set([hover, ...(neighbours.get(hover) ?? [])]) : null;

  /** Fly the camera into a cluster, then hand over to the next level. */
  const drillInto = useCallback(
    (box: Box) => {
      if (!box.drill || zooming.current) return;
      zooming.current = true;
      const aspect = CANVAS.w / CANVAS.h;
      let w = box.w * 1.08;
      let h = w / aspect;
      if (h < box.h * 1.08) { h = box.h * 1.08; w = h * aspect; }
      const target = { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
      const start = performance.now();
      const from = view;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        onDrill(box.drill!);
      };
      const step = (now: number) => {
        if (done) return;
        const t = Math.min(1, (now - start) / ZOOM_MS);
        const e = ease(t);
        setView({ x: lerp(from.x, target.x, e), y: lerp(from.y, target.y, e), w: lerp(from.w, target.w, e), h: lerp(from.h, target.h, e) });
        if (t < 1) requestAnimationFrame(step);
        else finish();
      };
      requestAnimationFrame(step);
      // rAF pauses in background tabs and stalls under load; a click must never go dead.
      setTimeout(finish, ZOOM_MS + 150);
    },
    [view, onDrill],
  );

  const hovered = hover ? model.nodes.find((n) => n.id === hover) : undefined;

  return (
    <svg
      key={scopeKey}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      // No CSS entry animation here: the per-tick re-render restarts it, leaving the
      // graph stuck invisible. The simulation settling is the entry animation.
      className="w-full h-full select-none"
      role="img"
      aria-label="Knowledge graph"
      onMouseLeave={() => { setHover(null); setHoverBox(null); }}
    >
      <defs>
        <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="rgba(255,255,255,0.05)" />
        </pattern>
        <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x={-CANVAS.w} y={-CANVAS.h} width={CANVAS.w * 3} height={CANVAS.h * 3} fill={BG} />
      <rect x={-CANVAS.w} y={-CANVAS.h} width={CANVAS.w * 3} height={CANVAS.h * 3} fill="url(#dots)" />

      {/* Clusters */}
      {model.boxes.map((b) => {
        const active = hoverBox === b.id && !!b.drill;
        return (
          <g
            key={b.id}
            onMouseEnter={() => setHoverBox(b.id)}
            onMouseLeave={() => setHoverBox((h) => (h === b.id ? null : h))}
            onClick={() => drillInto(b)}
            style={{ cursor: b.drill ? 'zoom-in' : 'default' }}
          >
            <rect
              x={b.x} y={b.y} width={b.w} height={b.h} rx={22}
              fill={hsl(b.hue, 55, b.core ? 0.04 : active ? 0.11 : 0.065)}
              stroke={hsl(b.hue, 62, active ? 0.75 : b.core ? 0.22 : 0.38)}
              strokeWidth={active ? 2 : 1.2}
              strokeDasharray={b.core ? '6 6' : undefined}
              style={{ transition: 'fill 200ms, stroke 200ms' }}
            />
            <text x={b.x + 22} y={b.y + 32} fill="#f5f5f4" fontSize={b.core ? 16 : 19} fontWeight={500} className="font-display">
              {b.title}
            </text>
            <text x={b.x + 22} y={b.y + 52} fill="rgba(245,245,244,0.5)" fontSize={12.5}>
              {b.subtitle}
            </text>
            {b.drill && (
              <text x={b.x + b.w - 22} y={b.y + 32} textAnchor="end" fill={hsl(b.hue, 70, active ? 0.95 : 0.45)} fontSize={12.5} style={{ transition: 'fill 200ms' }}>
                {active ? 'Zoom in →' : '→'}
              </text>
            )}
          </g>
        );
      })}

      {/* Links */}
      <g>
        {model.links.map((l) => {
          const [s, t] = endpoints(l);
          if (s.x == null || t.x == null) return null;
          const on = lit ? lit.has(s.id) && lit.has(t.id) : false;
          const opacity = lit ? (on ? 0.85 : 0.04) : l.bridge ? 0.18 : l.spoke ? 0.12 : model.dense ? 0.14 : 0.26;
          // Bridges curve, so links between clusters read as arcs over the gap rather than lines through boxes.
          const d = l.bridge
            ? `M${s.x},${s.y} Q${(s.x + t.x!) / 2},${Math.min(s.y!, t.y!) - 40} ${t.x},${t.y}`
            : `M${s.x},${s.y} L${t.x},${t.y}`;
          return (
            <path
              key={l.id}
              d={d}
              fill="none"
              stroke={on ? '#7cc4f7' : '#e7e5e4'}
              strokeOpacity={opacity}
              strokeWidth={on ? 1.6 : l.bridge ? 1 : 0.8}
              strokeDasharray={l.bridge ? '4 5' : undefined}
              pointerEvents="none"
            />
          );
        })}
      </g>

      {/* Nodes */}
      <g>
        {model.nodes.map((n) => {
          if (n.x == null) return null;
          const dim = lit && !lit.has(n.id);
          const ring = n.item?.status ? STATUS_RING[n.item.status] : undefined;
          const isPerson = n.type === 'person';
          return (
            <g
              key={n.id}
              transform={`translate(${n.x},${n.y})`}
              opacity={dim ? 0.12 : 1}
              style={{ transition: 'opacity 160ms', cursor: model.dense && !isPerson ? 'default' : 'pointer' }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
              onClick={(e) => {
                e.stopPropagation();
                if (n.item && !model.dense) onOpenItem(n.item);
                else if (n.person) onOpenPerson(n.person.id);
                else drillInto(n.box);
              }}
            >
              {ring && !model.dense && (
                <circle r={n.r + 5} fill="none" stroke={ring} strokeWidth={1.6} className="graph-pulse" />
              )}
              <circle
                r={n.r}
                fill={n.ghost ? BG : n.color}
                stroke={n.ghost ? n.color : isPerson ? 'rgba(255,255,255,0.85)' : 'none'}
                strokeWidth={n.ghost ? 1.6 : isPerson ? (n.r > 10 ? 2 : 1) : 0}
                filter={isPerson && n.r >= 15 ? 'url(#glow)' : undefined}
              />
              {isPerson && n.r >= 11 && (
                <text textAnchor="middle" dy="0.35em" fontSize={n.r * 0.72} fontWeight={600} fill="#fff" pointerEvents="none">
                  {n.person!.initials}
                </text>
              )}
              {(n.label || hover === n.id) && !(model.dense && !isPerson) && (
                <text
                  y={n.r + 15}
                  textAnchor="middle"
                  fontSize={isPerson ? 13 : 11.5}
                  fontWeight={isPerson ? 500 : 400}
                  fill={n.ghost ? 'rgba(245,245,244,0.55)' : 'rgba(245,245,244,0.92)'}
                  stroke={BG}
                  strokeWidth={4}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {truncate(isPerson ? n.person!.name : n.item!.title, isPerson ? 24 : 30)}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {hovered && <Tooltip node={hovered} dense={model.dense} />}
    </svg>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Rough half-width of a node's label in canvas units (about 6.4 units per character at 11.5–13px). */
function labelHalfWidth(n: GNode): number {
  const text = n.person ? truncate(n.person.name, 24) : n.item ? truncate(n.item.title, 30) : '';
  return text.length * 3.2;
}

/** In-canvas tooltip, so it scales with the zoom and never clips at the panel edge. */
function Tooltip({ node, dense }: { node: GNode; dense: boolean }) {
  const lines: string[] = node.person
    ? [node.person.name, node.person.title]
    : [node.item!.title, `${node.item!.kind[0].toUpperCase()}${node.item!.kind.slice(1)}${node.item!.status ? ` · ${node.item!.status.replace('_', ' ')}` : ''}`];
  if (!dense && node.item) lines.push('Click to open');
  if (node.person) lines.push('Click to open their brain');
  const w = Math.max(...lines.map((l) => l.length)) * 7 + 28;
  const h = lines.length * 18 + 14;
  const flip = node.x! + w + 24 > CANVAS.w;
  const x = flip ? node.x! - w - node.r - 12 : node.x! + node.r + 12;
  const y = node.y! - h / 2;
  const accent = node.item ? KIND_COLORS[node.item.kind] : node.color;
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <rect width={w} height={h} rx={10} fill="rgba(28,25,23,0.96)" stroke="rgba(255,255,255,0.12)" />
      <rect x={0} y={10} width={3} height={h - 20} rx={1.5} fill={accent} />
      {lines.map((l, i) => (
        <text key={i} x={14} y={22 + i * 18} fontSize={i === 0 ? 13 : 11.5} fontWeight={i === 0 ? 500 : 400} fill={i === 0 ? '#fafaf9' : 'rgba(250,250,249,0.55)'}>
          {l}
        </text>
      ))}
    </g>
  );
}
