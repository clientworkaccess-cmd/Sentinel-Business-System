/**
 * Who can see what. One implementation, used by every /brain page *and* the
 * chat route (#16), so the graph and the chat can never disagree about it.
 *
 *   Owner  — everything
 *   Admin  — their team, plus anything one of their people is part of
 *   Member — only items they own
 */
import { getDepartment, getPerson, getTeam } from './org';
import type { BrainItem, Org, Person, Role, Scope, Viewer } from './types';

export function visibleItems(org: Org, role: Role, viewerId: string): BrainItem[] {
  if (role === 'owner') return org.items;
  if (role === 'admin') {
    // Their team's items, plus anything their people are part of elsewhere — an
    // admin should see the client call their engineers sat in, wherever it's filed.
    const deptId = getPerson(viewerId)?.departmentId;
    return org.items.filter(
      (i) => i.departmentId === deptId || i.ownerIds.some((o) => o === viewerId || getPerson(o)?.departmentId === deptId),
    );
  }
  return org.items.filter((i) => i.ownerIds.includes(viewerId));
}

export function visiblePeople(org: Org, role: Role, viewerId: string): Person[] {
  if (role === 'owner') return org.people;
  const me = getPerson(viewerId);
  if (role === 'admin') return org.people.filter((p) => p.departmentId === me?.departmentId);
  return me ? [me] : [];
}

/** Where a viewer lands, and the highest level they may zoom out to. */
export function homeScope(org: Org, viewer: Viewer): Scope {
  if (viewer.role === 'owner') return { level: 'org', id: org.id };
  if (viewer.role === 'admin') {
    return { level: 'department', id: getPerson(viewer.personId)?.departmentId ?? org.id };
  }
  return { level: 'member', id: viewer.personId };
}

export function canViewScope(org: Org, viewer: Viewer, scope: Scope): boolean {
  if (viewer.role === 'owner') return true;
  const me = getPerson(viewer.personId);
  if (!me) return false;
  if (viewer.role === 'member') return scope.level === 'member' && scope.id === me.id;
  // Admin: anything inside their department.
  switch (scope.level) {
    case 'org':
      return false;
    case 'department':
      return scope.id === me.departmentId;
    case 'team':
      return getTeam(scope.id)?.departmentId === me.departmentId;
    case 'member':
      return getPerson(scope.id)?.departmentId === me.departmentId;
  }
}

/** Org → Department → Team → Member path for the breadcrumb, root first. */
export function scopePath(org: Org, scope: Scope): Scope[] {
  const root: Scope = { level: 'org', id: org.id };
  switch (scope.level) {
    case 'org':
      return [root];
    case 'department':
      return [root, scope];
    case 'team': {
      const team = getTeam(scope.id);
      return team ? [root, { level: 'department', id: team.departmentId }, scope] : [root];
    }
    case 'member': {
      // Business → Team → Person. The squad (`teamId`) is a label on the person,
      // not a navigation level — the product shows three levels, one per role.
      const p = getPerson(scope.id);
      const path: Scope[] = [root];
      if (p?.departmentId) path.push({ level: 'department', id: p.departmentId });
      path.push(scope);
      return path;
    }
  }
}

export function scopeLabel(org: Org, scope: Scope): string {
  switch (scope.level) {
    case 'org':
      return org.name;
    case 'department':
      return getDepartment(scope.id)?.name ?? scope.id;
    case 'team':
      return getTeam(scope.id)?.name ?? scope.id;
    case 'member':
      return getPerson(scope.id)?.name ?? scope.id;
  }
}

/** The people a scope covers — the org, a department (incl. its head), a team, or one person. */
export function peopleInScope(org: Org, scope: Scope): Person[] {
  switch (scope.level) {
    case 'org':
      return org.people;
    case 'department':
      return org.people.filter((p) => p.departmentId === scope.id);
    case 'team':
      return org.people.filter((p) => p.teamId === scope.id);
    case 'member':
      return org.people.filter((p) => p.id === scope.id);
  }
}

/** Items inside a scope, already narrowed to what the viewer may see. */
export function itemsInScope(org: Org, viewer: Viewer, scope: Scope): BrainItem[] {
  const visible = visibleItems(org, viewer.role, viewer.personId);
  switch (scope.level) {
    case 'org':
      return visible;
    case 'department':
      // A team's view includes work its people are part of, wherever it's filed.
      return visible.filter(
        (i) => i.departmentId === scope.id || i.ownerIds.some((o) => getPerson(o)?.departmentId === scope.id),
      );
    case 'team': {
      const members = new Set(getTeam(scope.id)?.memberIds ?? []);
      return visible.filter((i) => i.teamId === scope.id || i.ownerIds.some((o) => members.has(o)));
    }
    case 'member':
      return visible.filter((i) => i.ownerIds.includes(scope.id));
  }
}
