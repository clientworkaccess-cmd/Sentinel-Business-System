# Graph API + Hybrid Retrieval Plan

Issue #20 (epic #4). Owner: claude-three-junior. Stacked on #19 (PR #30) and #18
(PR #29). The design was proposed on #20 before building.

## Context

The `/brain` demo renders a hard-coded org (`frontend/src/demo/org.ts`) in the shape
of `frontend/src/demo/types.ts`. This feature serves that same shape from real data,
narrowed to the caller's role. It also gives chat a retrieval path that combines
vector similarity with graph structure, under the same visibility.

## Decision: where each part lives

HydraDB can't hold the hierarchy cleanly. Its metadata filters are exact-match only
(no `IN`, so no "owned by anyone in my teams"), and filter fields must be declared
before ingestion with no guaranteed backfill. It's a fact store with an opaque
relations graph, not one with ownership edges we control. So:

| Part | Store |
|---|---|
| Org hierarchy (departments, teams, memberships, admin assignments) | Postgres (from #18) |
| Projects, clients, documents, decisions, threads | Postgres `brain_items` + `brain_item_owners` |
| Edges (`relatedIds`) | Postgres `brain_links`, undirected, smaller ref first |
| Tasks, meetings | Their own tables, **projected live** (never copied) |
| Vector similarity | HydraDB, unchanged. Each brain item is mirrored as a fact with `source_ref = "item:<id>"` |

This isn't a switch to Supabase/pgvector. The vector source sits behind one seam
(`HybridRetriever._recall`).

## Node ids

`<uuid>` for a brain item, `task:<uuid>` for a task, `meeting:<uuid>` for a meeting.
People, departments and teams use their uuids. Related ids are validated against the
tenant on write and stored in canonical form. A dangling edge is ignored on read.

## Visibility

- Every read builds a `Snapshot` through repositories carrying the caller's
  `Visibility`, so the snapshot already holds exactly what the caller may see.
- Brain items are visible through any owner in reach, or (for an Admin) by being
  filed under a department or team they manage.
- Tasks and meetings use their #18 rules.
- Owner ids are filtered to visible people, and related ids to visible items, so
  neither leaks.

## GET /api/v1/graph?level=org|department|team|member&id=

- Returns `{departments, teams, people, items}` in camelCase. Optional fields are
  omitted, not null.
- `headId`/`leadId` are `""` when unset, and `hue` falls back to a stable per-id value.
- `canViewScope`: an Owner can view any scope. An Admin can view the departments and
  teams they manage, and the people in reach. A Member can view only themselves.
  Anything else is 404, whether it doesn't exist or isn't theirs.
- `peopleInScope` / `itemsInScope` / structure narrowing mirror
  `frontend/src/demo/visibility.ts`. A department's items are those whose
  `departmentId` matches. A team's items match `teamId` or have an owner in the team.
- An item's department/team defaults to its first owner's, as in the demo data.
- Task status maps: pending_approval → pending_approval, approved/in_progress →
  on_track, blocked → blocked, overdue → at_risk, done → done. Rejected tasks are
  excluded.

## Hybrid retrieval (`GET /graph/search?q=`, chat `search_business`)

1. **Seed.** HydraDB recall, over-fetched ×3, merged with a keyword match over item
   titles and summaries, plus the items of any person named in the question.
2. **Trace.** Each fact's `source_ref` maps to nodes (`item:<id>` or
   `Meeting: <title>`). For non-Owners, an untraceable fact is dropped (fail closed).
   A title shared by two meetings in the company (even one out of reach) traces to
   nothing. Task↔meeting edges use `tasks.meeting_id`, falling back to the title only
   for legacy tasks whose title is unique company-wide (#29 review).
3. **Expand.** One hop through related ids. Neighbours inherit half the seed's score.
4. **Return.** Ranked items, their visible owners, and the traced facts.
   `vectorAvailable: false` when HydraDB is off or down.

Chat: Owners, Admins and Members all get `search_business`, with visibility resolved
when the agent is built and pinned in the tool's closure. Admins and Members keep
own-tasks-only task tools.

## Writes (Owner)

- `POST /graph/items` upserts on `source` + `external_ref`, so connectors can re-sync.
- `PATCH /graph/items/{id}` and `DELETE /graph/items/{id}`.
- Owners and related ids are validated against the tenant.
- Each write is mirrored to HydraDB after commit, best effort; delete forgets it.
- Connectors can construct `GraphService(db, company_id, None)` as a system actor.

## Verification

`python -m scripts.verify_graph` checks the response shape, every role's scopes and
404s, owner/related-id filtering, search visibility (HTTP and the chat tool), upsert,
and cross-tenant refusal. It runs without HydraDB.
