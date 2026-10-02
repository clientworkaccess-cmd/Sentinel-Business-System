/**
 * Builds the compound-of-brains model for one scope: the cluster boxes, the
 * nodes inside them and the links between nodes. Pure — no React, no d3 — so the
 * layout rules can be read (and changed) in one place.
 *
 * The non-overlap guarantee comes from here, not from the simulation: every
 * cluster is a fixed, non-intersecting rectangle, and the canvas clamps each
 * node inside its own rectangle. Forces only arrange nodes *within* a box.
 */
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { getDepartment, getItem, getPerson, getTeam } from '@/demo/org';
import { canViewScope, itemsInScope } from '@/demo/visibility';
import type { BrainItem, ItemKind, ItemStatus, Org, Person, Scope, Viewer } from '@/demo/types';

export const CANVAS = { w: 1600, h: 1000 };
const PAD = 36;
// The level switcher and legend float over the canvas; clusters stay clear of both.
const TOP = 84;
const BOTTOM = 92;
const GAP = 32;
const CORE_BAND = 150;

/** Kind colours, tuned for the dark graph canvas. */
export const KIND_COLORS: Record<ItemKind, string> = {
  project: '#a78bfa',
  client: '#fbbf24',
  meeting: '#38bdf8',
  document: '#a8a29e',
  task: '#34d399',
  decision: '#f472b6',
  thread: '#2dd4bf',
};

export const STATUS_RING: Partial<Record<ItemStatus, string>> = {
  at_risk: '#f59e0b',
  blocked: '#f43f5e',
  pending_approval: '#38bdf8',
};

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hue: number;
  title: string;
  subtitle: string;
  /** Where clicking the box takes you; null when it is not drillable. */
  drill: Scope | null;
  /** The core band (owner / department head) is drawn quieter than the clusters. */
  core?: boolean;
}

export interface GNode extends SimulationNodeDatum {
  id: string;
  type: 'person' | 'item';
  person?: Person;
  item?: BrainItem;
  box: Box;
  r: number;
  color: string;
  /** Always labelled, rather than only on hover. */
  label?: boolean;
  /** Context from outside the scope (member view) — drawn hollow. */
  ghost?: boolean;
  /** Pull target inside the box, when nodes should not all crowd the centre. */
  tx?: number;
  ty?: number;
}

export interface GLink extends SimulationLinkDatum<GNode> {
  id: string;
  source: string | GNode;
  target: string | GNode;
  /** Crosses between clusters — drawn dashed, never pulls nodes out of their box. */
  bridge?: boolean;
}

export interface GraphModel {
  boxes: Box[];
  nodes: GNode[];
  links: GLink[];
  /** Small items render as dots at the org level; labels would be noise there. */
  dense: boolean;
  /** Item-to-owner link length. Grows as the view zooms in, so each brain fills its box. */
  spread: number;
}

/* ── Geometry ──────────────────────────────────────────────────────────── */

interface Rect { x: number; y: number; w: number; h: number }

/** n equal cells in rows; a short last row is centred, so 5 reads as 3 over 2. */
function grid(n: number, area: Rect): Rect[] {
  const cols = n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  const cw = (area.w - GAP * (cols - 1)) / cols;
  const ch = (area.h - GAP * (rows - 1)) / rows;
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const offset = ((cols - inRow) * (cw + GAP)) / 2;
    return { x: area.x + offset + col * (cw + GAP), y: area.y + row * (ch + GAP), w: cw, h: ch };
  });
}

/** Deterministic jitter so the same scope always settles the same way. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function place(node: GNode, rand: () => number, spread = 0.7) {
  const b = node.box;
  const cx = node.tx ?? b.x + b.w / 2;
  const cy = node.ty ?? b.y + b.h / 2 + 12;
  node.x = cx + (rand() - 0.5) * b.w * spread * 0.5;
  node.y = cy + (rand() - 0.5) * b.h * spread * 0.5;
}

const hueOf = (p?: Person) => (p?.departmentId ? getDepartment(p.departmentId)?.hue ?? 205 : 205);
export const hsl = (hue: number, l = 58, a = 1) => `hsl(${hue} 72% ${l}% / ${a})`;

/* ── Model ─────────────────────────────────────────────────────────────── */

export function buildGraph(org: Org, viewer: Viewer, scope: Scope): GraphModel {
  const rand = seeded(`${scope.level}:${scope.id}:${viewer.role}`);
  const items = itemsInScope(org, viewer, scope);
  switch (scope.level) {
    case 'org':
      return buildOrg(org, viewer, items, rand);
    case 'department':
      return buildDepartment(org, viewer, scope.id, items, rand);
    case 'team':
      return buildTeam(org, viewer, scope.id, items, rand);
    case 'member':
      return buildMember(org, viewer, scope.id, items, rand);
  }
}

function personNode(p: Person, box: Box, r: number, label = false): GNode {
  return { id: `p:${p.id}`, type: 'person', person: p, box, r, color: p.role === 'owner' ? '#3ba6f1' : hsl(hueOf(p)), label };
}

function itemNode(i: BrainItem, box: Box, r: number, color = KIND_COLORS[i.kind]): GNode {
  return { id: `i:${i.id}`, type: 'item', item: i, box, r, color };
}

/** Item → each owner present in the model. The first owner is the anchor; the rest are bridges. */
function ownerLinks(item: GNode, present: Map<string, GNode>): GLink[] {
  const out: GLink[] = [];
  for (const ownerId of item.item!.ownerIds) {
    const owner = present.get(ownerId);
    if (!owner) continue;
    out.push({ id: `${item.id}>${owner.id}`, source: item.id, target: owner.id, bridge: owner.box !== item.box });
  }
  return out;
}

function coreBox(id: string, title: string, subtitle: string, hue: number, drill: Scope | null): Box {
  const w = 520;
  return { id, x: (CANVAS.w - w) / 2, y: TOP, w, h: CORE_BAND - 24, hue, title, subtitle, drill, core: true };
}

const lowerArea = (): Rect => ({ x: PAD, y: TOP + CORE_BAND, w: CANVAS.w - PAD * 2, h: CANVAS.h - TOP - BOTTOM - CORE_BAND });

function finish(nodes: GNode[], links: GLink[], boxes: Box[], dense: boolean, spread: number, rand: () => number): GraphModel {
  // Drop links whose ends were filtered out, then seed positions.
  const ids = new Set(nodes.map((n) => n.id));
  const kept = links.filter((l) => ids.has(l.source as string) && ids.has(l.target as string));
  for (const n of nodes) if (n.x === undefined) place(n, rand);
  return { boxes, nodes, links: kept, dense, spread };
}

function buildOrg(org: Org, viewer: Viewer, items: BrainItem[], rand: () => number): GraphModel {
  const owner = getPerson(org.ownerId)!;
  const core = coreBox('core', owner.name, `${owner.title} · the company's own brain`, 205, { level: 'member', id: owner.id });
  const rects = grid(org.departments.length, lowerArea());
  const boxes: Box[] = [core];
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const people = new Map<string, GNode>();

  const ownerNode = personNode(owner, core, 16, true);
  ownerNode.fx = core.x + core.w / 2;
  ownerNode.fy = core.y + core.h / 2 + 12;
  nodes.push(ownerNode);
  people.set(owner.id, ownerNode);

  org.departments.forEach((d, i) => {
    const r = rects[i];
    const box: Box = {
      id: d.id, ...r, hue: d.hue, title: d.name,
      subtitle: `${org.people.filter((p) => p.departmentId === d.id).length} people · ${d.teamIds.length} teams`,
      drill: canViewScope(org, viewer, { level: 'department', id: d.id }) ? { level: 'department', id: d.id } : null,
    };
    boxes.push(box);

    const head = personNode(getPerson(d.headId)!, box, 11, true);
    head.tx = box.x + box.w / 2;
    head.ty = box.y + box.h / 2 + 10;
    nodes.push(head);
    people.set(d.headId, head);
    links.push({ id: `org>${d.id}`, source: ownerNode.id, target: head.id, bridge: true });

    // Teams sit at evenly spaced points around the head, so each team reads as its own sub-brain.
    d.teamIds.forEach((tid, ti) => {
      const team = getTeam(tid)!;
      const angle = (ti / d.teamIds.length) * Math.PI * 2 - Math.PI / 2;
      const tx = head.tx! + Math.cos(angle) * box.w * 0.3;
      const ty = head.ty! + Math.sin(angle) * box.h * 0.27;
      team.memberIds.forEach((mid, mi) => {
        const n = personNode(getPerson(mid)!, box, mi === 0 ? 7.5 : 6);
        n.color = hsl(d.hue, 50 + ti * 12);
        n.tx = tx;
        n.ty = ty;
        nodes.push(n);
        people.set(mid, n);
        links.push({ id: `${n.id}>${mi === 0 ? head.id : `p:${team.leadId}`}`, source: n.id, target: mi === 0 ? head.id : `p:${team.leadId}` });
      });
    });
  });

  const boxOfDept = new Map(boxes.map((b) => [b.id, b]));
  const headOfBox = new Map(org.departments.map((d) => [d.id, people.get(d.headId)!]));
  for (const it of items) {
    const owners = it.ownerIds.map((o) => people.get(o)).filter((n): n is GNode => !!n);
    const box = (it.ownerIds.length === 1 && it.ownerIds[0] === owner.id) ? core : boxOfDept.get(it.departmentId ?? '') ?? owners[0]?.box;
    if (!box) continue;
    // Anchor to an owner inside the same box; failing that, the box's own head.
    // Pulling towards an owner in another box would just pin the dot to the wall.
    const anchor = owners.find((o) => o.box === box) ?? (box.core ? ownerNode : headOfBox.get(box.id));
    const n = itemNode(it, box, 3, hsl(box.core ? 205 : box.hue, 74, 0.7));
    if (anchor) {
      n.tx = anchor.tx ?? anchor.fx ?? undefined;
      n.ty = anchor.ty ?? anchor.fy ?? undefined;
    }
    nodes.push(n);
    // Dense mode: only the anchor link, so the org view stays legible.
    if (anchor) links.push({ id: `${n.id}>${anchor.id}`, source: n.id, target: anchor.id, bridge: anchor.box !== box });
  }

  return finish(nodes, links, boxes, true, 30, rand);
}

function buildDepartment(org: Org, viewer: Viewer, deptId: string, items: BrainItem[], rand: () => number): GraphModel {
  const d = getDepartment(deptId)!;
  const head = getPerson(d.headId)!;
  const core = coreBox('core', head.name, `${head.title} · ${d.name}`, d.hue, canViewScope(org, viewer, { level: 'member', id: head.id }) ? { level: 'member', id: head.id } : null);
  const rects = grid(d.teamIds.length, lowerArea());
  const boxes: Box[] = [core];
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const people = new Map<string, GNode>();

  const headNode = personNode(head, core, 15, true);
  headNode.fx = core.x + core.w / 2;
  headNode.fy = core.y + core.h / 2 + 12;
  nodes.push(headNode);
  people.set(head.id, headNode);

  d.teamIds.forEach((tid, i) => {
    const t = getTeam(tid)!;
    const box: Box = {
      id: t.id, ...rects[i], hue: d.hue, title: t.name,
      subtitle: `Led by ${getPerson(t.leadId)?.name} · ${t.memberIds.length} people`,
      drill: { level: 'team', id: t.id },
    };
    boxes.push(box);
    t.memberIds.forEach((mid, mi) => {
      const n = personNode(getPerson(mid)!, box, mi === 0 ? 11 : 8.5, true);
      const angle = (mi / t.memberIds.length) * Math.PI * 2;
      n.tx = box.x + box.w / 2 + Math.cos(angle) * box.w * 0.24;
      n.ty = box.y + box.h / 2 + 14 + Math.sin(angle) * box.h * 0.24;
      nodes.push(n);
      people.set(mid, n);
      links.push(mi === 0
        ? { id: `${headNode.id}>${n.id}`, source: headNode.id, target: n.id, bridge: true }
        : { id: `${n.id}>p:${t.leadId}`, source: n.id, target: `p:${t.leadId}` });
    });
  });

  for (const it of items) {
    const anchor = it.ownerIds.map((o) => people.get(o)).find(Boolean);
    if (!anchor) continue;
    const n = itemNode(it, anchor.box, 4);
    n.tx = anchor.tx ?? anchor.fx ?? undefined;
    n.ty = anchor.ty ?? anchor.fy ?? undefined;
    nodes.push(n);
    links.push(...ownerLinks(n, people));
  }

  return finish(nodes, links, boxes, false, 48, rand);
}

function buildTeam(org: Org, viewer: Viewer, teamId: string, items: BrainItem[], rand: () => number): GraphModel {
  const t = getTeam(teamId)!;
  const hue = getDepartment(t.departmentId)?.hue ?? 205;
  const rects = grid(t.memberIds.length, { x: PAD, y: TOP, w: CANVAS.w - PAD * 2, h: CANVAS.h - TOP - BOTTOM });
  const boxes: Box[] = [];
  const nodes: GNode[] = [];
  const links: GLink[] = [];
  const people = new Map<string, GNode>();

  t.memberIds.forEach((mid, i) => {
    const p = getPerson(mid)!;
    const box: Box = {
      id: mid, ...rects[i], hue, title: p.name, subtitle: p.title,
      drill: canViewScope(org, viewer, { level: 'member', id: mid }) ? { level: 'member', id: mid } : null,
    };
    boxes.push(box);
    const n = personNode(p, box, 15, true);
    n.fx = box.x + box.w / 2;
    n.fy = box.y + box.h / 2 + 14;
    nodes.push(n);
    people.set(mid, n);
  });

  for (const it of items) {
    const anchor = it.ownerIds.map((o) => people.get(o)).find(Boolean);
    if (!anchor) continue;
    const n = itemNode(it, anchor.box, it.kind === 'client' || it.kind === 'project' ? 8 : 6.5);
    nodes.push(n);
    links.push(...ownerLinks(n, people));
  }

  return finish(nodes, links, boxes, false, 95, rand);
}

function buildMember(org: Org, viewer: Viewer, personId: string, items: BrainItem[], rand: () => number): GraphModel {
  const p = getPerson(personId)!;
  const hue = p.role === 'owner' ? 205 : hueOf(p);
  const box: Box = {
    id: personId, x: PAD, y: TOP, w: CANVAS.w - PAD * 2, h: CANVAS.h - TOP - BOTTOM, hue,
    title: `${p.name}'s brain`, subtitle: `${p.title} · ${items.length} memories`, drill: null,
  };
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2 + 10;
  const nodes: GNode[] = [];
  const links: GLink[] = [];

  const me = personNode(p, box, 26, true);
  me.fx = cx;
  me.fy = cy;
  nodes.push(me);

  // Each kind gets its own sector, so the brain reads as regions, not a hairball.
  const kinds = [...new Set(items.map((i) => i.kind))];
  const owned = new Set(items.map((i) => i.id));
  const ghosts = new Map<string, GNode>();

  items.forEach((it) => {
    const k = kinds.indexOf(it.kind);
    const angle = (k / kinds.length) * Math.PI * 2 - Math.PI / 2;
    const n = itemNode(it, box, it.kind === 'client' || it.kind === 'project' ? 11 : 9);
    n.label = true;
    n.tx = cx + Math.cos(angle) * box.w * 0.22;
    n.ty = cy + Math.sin(angle) * box.h * 0.27;
    nodes.push(n);
    links.push({ id: `${n.id}>${me.id}`, source: n.id, target: me.id });

    // Connected memory and co-owners from outside this brain sit on the rim, hollow.
    const ring = (id: string, make: () => GNode) => {
      if (!ghosts.has(id)) {
        const g = make();
        g.ghost = true;
        g.tx = cx + Math.cos(angle) * box.w * 0.42;
        g.ty = cy + Math.sin(angle) * box.h * 0.42;
        ghosts.set(id, g);
      }
      return ghosts.get(id)!;
    };
    for (const rid of it.relatedIds ?? []) {
      if (owned.has(rid)) {
        links.push({ id: `i:${it.id}>i:${rid}`, source: n.id, target: `i:${rid}` });
        continue;
      }
      const rel = getItem(rid);
      if (!rel) continue;
      const g = ring(`i:${rid}`, () => itemNode(rel, box, 7.5));
      g.label = true;
      links.push({ id: `${n.id}>${g.id}`, source: n.id, target: g.id, bridge: true });
    }
    for (const oid of it.ownerIds) {
      if (oid === personId) continue;
      const other = getPerson(oid);
      if (!other) continue;
      const g = ring(`p:${oid}`, () => personNode(other, box, 8));
      links.push({ id: `${n.id}>${g.id}`, source: n.id, target: g.id, bridge: true });
    }
  });

  nodes.push(...ghosts.values());
  // Dedupe — two items can both point at the same related item.
  const seen = new Set<string>();
  const unique = links.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
  return finish(nodes, unique, [box], false, 150, rand);
}
