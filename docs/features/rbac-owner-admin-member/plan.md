# Owner / Admin / Member RBAC Plan

Issue #18 (epics #2, #4). Owner: claude-three-junior.

## Context

The backend had two roles, `founder` and `employee`, checked by one dependency each.
The product now has three: **Owner** sees everything, **Admin** manages one or more
departments or teams and sees the people in them, **Member** sees only themselves.
The frontend demo already encodes these rules in `frontend/src/demo/visibility.ts`;
this feature makes the API enforce the same rules on real data, so #20 (graph API +
hybrid retrieval) can be built on top of it.

## Locked decisions

- **Rename in place.** The `user_role` enum values are renamed (`founder → owner`,
  `employee → member`) and `admin` is added. Every existing row converts without an
  UPDATE. `UserRole.FOUNDER` / `UserRole.EMPLOYEE` stay as Python aliases and
  `FounderUser` as an alias of `OwnerUser`, so in-flight branches keep compiling.
- **Org tables.** `departments` (name, description, hue, head), `teams` (department,
  lead), `team_memberships` (team ↔ employee, many-to-many) and `admin_assignments`
  (user → exactly one department *or* one team, enforced by a CHECK). Employees get a
  nullable home `department_id`.
- **A department implies its teams.** An Admin over Engineering covers every squad in
  it, including ones created later.
- **Visibility is resolved once per request** (`app/core/visibility.py`) into an
  immutable `Visibility`: the employee ids, department ids and team ids the caller can
  read. Owners short-circuit to `sees_all`.
- **Repositories apply it, routes never do.** `TenantScopedRepository` takes an
  optional `Visibility` and adds the model's `_visible_clause()` to every read,
  including `get()`, `count()` and update/delete lookups. A model with no rule returns
  nothing to a non-Owner — a forgotten rule fails closed.
- **Who sees which rows.** Tasks and employees through the owning employee. Meetings
  through a transcript speaker in reach, or a task in reach citing
  `Meeting: {title}`. Team memberships need both the team and the person in reach.
  Departments and teams are readable as labels by their own members.
- **Out of reach is 404, not 403**, so ids cannot be probed.
- **Writes stay Owner-only** (`OwnerUser`): tasks, employees, logins, org structure,
  approvals, settings, meetings upload/delete. Admin write powers come later.
- **Owner-only surfaces until #20:** knowledge graph (HydraDB facts are not linked to
  people yet), approvals, reports, company settings, onboarding.
- **Chat:** Owners keep the founder tool set; Admins and Members get the own-tasks
  tool set until #20 brings visibility-filtered retrieval.
- **JWT role claim is binding.** `get_current_user` rejects a token whose role claim
  no longer matches the user row, so promotion/demotion ends old sessions. After the
  migration every pre-existing token is rejected once (users sign in again).
- **Granting roles.** `POST/PATCH /employees/{id}/login` accept `role: member|admin`.
  Owner cannot be granted or removed there. Demoting an Admin deletes their
  assignments.

## API

- `GET /tasks`, `GET /tasks/{id}`, `GET /employees`, `GET /employees/{id}`,
  `GET /employees/{id}/tasks`, `GET /meetings`, `GET /meetings/{id}` — any role,
  visibility-scoped.
- `GET|POST /org/departments`, `PATCH|DELETE /org/departments/{id}`
- `GET|POST /org/teams`, `PATCH|DELETE /org/teams/{id}`, `PUT /org/teams/{id}/members`
- `GET|PUT /org/admins/{user_id}/assignments`
- `/auth/me` and token `role` now return `owner|admin|member`.

## Security review (docs/rules/security.md)

- Failed logins no longer log the email address (personal data).
- Unknown-email logins verify against a dummy bcrypt hash, so timing does not reveal
  whether an account exists.
- Startup refuses the placeholder or a < 32-char `JWT_SECRET_KEY` when
  `ENVIRONMENT=production` — a forgeable key means reading any tenant.
- Passwords: bcrypt (passlib), 8–128 chars, never logged or returned. Sessions: 8 h
  JWT, re-validated against the user row (active, tenant, role) on every request.

## Known follow-ups

- The legacy dashboard reads `role === 'founder' | 'employee'`; it must switch to
  `owner | admin | member` (frontend, claude-one).
- Meeting visibility relies on speaker mapping and the title-based `source_ref`;
  meetings with neither are Owner-only.

## Verification

`python -m scripts.verify_rbac` builds a two-department org and checks Member,
department-Admin, team-Admin and Owner reach over HTTP, plus assignment validation,
role changes and stale-token rejection. `scripts/verify.py` was updated for the new
role values.
