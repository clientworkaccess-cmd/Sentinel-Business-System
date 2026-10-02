/**
 * The demo data contract.
 *
 * Every /brain page, the /api/brain/chat route (#16) and — later — the production
 * graph API (#20) speak this shape. Add optional fields freely; renaming or
 * removing one breaks other agents' work, so do that only through an issue.
 */

/*
 * Three levels, one per role (Alyan, PR #23): Business (Owner) → Team (Admin) →
 * Individual (Member). In the data an Admin's team is a `Department`; the finer
 * `Team` records are squads, shown only as a label on a person, never as a level
 * the UI navigates to.
 */
export type Role = 'owner' | 'admin' | 'member';
export type ScopeLevel = 'org' | 'department' | 'team' | 'member';

export interface Person {
  id: string;
  name: string;
  title: string;
  role: Role;
  departmentId?: string;
  teamId?: string;
  initials: string;
  /** Leads run a team day to day but are still Members for visibility. */
  isLead?: boolean;
  email?: string;
  /** What the UI calls them in greetings, when it isn't the first word of `name`. */
  shortName?: string;
}

export interface Department {
  id: string;
  name: string;
  headId: string;
  teamIds: string[];
  /** Hue in degrees. The graph and every department chip derive their colour from it. */
  hue: number;
  description?: string;
}

export interface Team {
  id: string;
  name: string;
  departmentId: string;
  leadId: string;
  memberIds: string[];
}

export type ItemKind = 'project' | 'client' | 'meeting' | 'document' | 'task' | 'decision' | 'thread';

export type ItemStatus = 'on_track' | 'at_risk' | 'blocked' | 'done' | 'pending_approval';

export interface BrainItem {
  id: string;
  kind: ItemKind;
  title: string;
  ownerIds: string[];
  teamId?: string;
  departmentId?: string;
  /** Connector id the item was learned from, e.g. 'gmail', 'slack', 'fireflies'. */
  source?: string;
  /** ISO date (YYYY-MM-DD). */
  date?: string;
  summary?: string;
  status?: ItemStatus;
  /** Other items this one is about — a meeting's client, a task's project. */
  relatedIds?: string[];
  /** True when the item involves someone outside the company (drives the approval gate). */
  external?: boolean;
}

export interface Org {
  id: string;
  name: string;
  tagline: string;
  city: string;
  ownerId: string;
  departments: Department[];
  teams: Team[];
  people: Person[];
  items: BrainItem[];
}

export interface Scope {
  level: ScopeLevel;
  /** org id, department id, team id or person id depending on `level`. */
  id: string;
}

export interface Viewer {
  role: Role;
  personId: string;
}
