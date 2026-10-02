"""The company graph (#20): Org → Department → Team → Member, and everything they own.

Builds the ``{departments, teams, people, items}`` shape the frontend's demo data
uses (frontend/src/demo/types.ts) from real tables, narrowed to one viewer.

Where each node comes from:

* departments, teams, people — the org tables from #18
* items — ``brain_items`` (projects, clients, documents, decisions, threads), plus
  tasks and meetings **projected live** from their own tables, so a task's status in
  the graph cannot drift from the task

Every read goes through repositories built with the viewer's ``Visibility``, so what
this service can see is already exactly what the viewer can see. The scope rules
(``peopleInScope``, ``itemsInScope``, ``canViewScope``) mirror
frontend/src/demo/visibility.ts line for line, so the demo and the API agree.
"""

import logging
import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.visibility import Visibility
from app.exceptions import NotFoundError, ValidationError
from app.knowledge.store import get_knowledge_store
from app.models.brain import BrainItem
from app.models.company import Company
from app.models.enums import BrainItemKind, BrainItemStatus, TaskStatus
from app.models.meeting import Meeting, TranscriptSegment
from app.models.task import Task
from app.models.user import User
from app.repositories.brain import BrainItemRepository, BrainLinkRepository
from app.repositories.employee import EmployeeRepository
from app.repositories.meeting_repository import MeetingRepository
from app.repositories.org import DepartmentRepository, TeamMembershipRepository, TeamRepository
from app.repositories.task import TaskRepository
from app.schemas.graph import (
    BrainItemCreate,
    BrainItemUpdate,
    GraphDepartment,
    GraphItem,
    GraphPerson,
    GraphRead,
    GraphTeam,
    ScopeLevel,
)
from app.services.base import TenantService

logger = logging.getLogger(__name__)

TASK_PREFIX = "task:"
MEETING_PREFIX = "meeting:"
#: HydraDB source_ref for a mirrored brain item. Maps a vector hit back to its node.
ITEM_SOURCE_PREFIX = "item:"
#: How the meeting pipeline cites a meeting on its tasks and facts.
MEETING_SOURCE_PREFIX = "Meeting: "

_TASK_STATUS = {
    TaskStatus.PENDING_APPROVAL: BrainItemStatus.PENDING_APPROVAL,
    TaskStatus.APPROVED: BrainItemStatus.ON_TRACK,
    TaskStatus.IN_PROGRESS: BrainItemStatus.ON_TRACK,
    TaskStatus.BLOCKED: BrainItemStatus.BLOCKED,
    TaskStatus.OVERDUE: BrainItemStatus.AT_RISK,
    TaskStatus.DONE: BrainItemStatus.DONE,
}

#: Graph reads are a whole-org projection; these caps keep one request bounded.
MAX_ITEMS = 1000
MAX_TASKS = 500
MAX_MEETINGS = 200


def initials_of(name: str) -> str:
    """Same rule as initialsOf() in frontend/src/demo/org.ts."""
    words = name.split()
    if len(words) <= 1:
        return name[:2].upper()
    return "".join(w[0] for w in words[:2]).upper()


def hue_for(department_id: uuid.UUID) -> int:
    """A stable default hue, so an un-coloured department still renders consistently."""
    return int(department_id.hex[:4], 16) % 360


@dataclass
class Snapshot:
    """Everything one viewer can see, before narrowing to a scope."""

    departments: dict[str, GraphDepartment] = field(default_factory=dict)
    teams: dict[str, GraphTeam] = field(default_factory=dict)
    people: dict[str, GraphPerson] = field(default_factory=dict)
    items: dict[str, GraphItem] = field(default_factory=dict)
    #: Meeting titles used by more than one meeting in the company — including ones
    #: this viewer cannot see. A fact cited only by such a title cannot be pinned to
    #: a meeting, so retrieval must not attribute it to the visible one.
    ambiguous_meeting_titles: frozenset[str] = frozenset()


class GraphService(TenantService):
    def __init__(
        self, db: Session, company_id: uuid.UUID, visibility: Visibility | None
    ) -> None:
        """``visibility`` None is a system actor (a connector sync) and sees everything."""
        super().__init__(db, company_id, visibility)
        self.viewer = visibility
        self.items = BrainItemRepository(db, company_id, visibility)
        self.links = BrainLinkRepository(db, company_id)  # filtered by node, below

    # --- reads -------------------------------------------------------------------

    def graph(self, level: ScopeLevel, scope_id: str | None) -> GraphRead:
        """The graph for one scope. 404 if the scope doesn't exist or is out of reach."""
        snap = self.snapshot()
        scope_id = self._check_scope(snap, level, scope_id)

        people = self._people_in_scope(snap, level, scope_id)
        items = self._items_in_scope(snap, level, scope_id)
        departments, teams = self._structure_in_scope(snap, level, scope_id)
        return GraphRead(departments=departments, teams=teams, people=people, items=items)

    def snapshot(self) -> Snapshot:
        snap = Snapshot()
        cid, vis = self.company_id, self.viewer

        # Structure ------------------------------------------------------------------
        departments = DepartmentRepository(self.db, cid, vis).list_ordered()
        teams = TeamRepository(self.db, cid, vis).list_ordered()
        memberships = TeamMembershipRepository(self.db, cid, vis).for_teams([t.id for t in teams])
        members_by_team: dict[uuid.UUID, list[str]] = defaultdict(list)
        teams_by_person: dict[str, list[uuid.UUID]] = defaultdict(list)
        team_names = {t.id: t.name for t in teams}
        for m in memberships:
            members_by_team[m.team_id].append(str(m.employee_id))
            teams_by_person[str(m.employee_id)].append(m.team_id)

        for t in teams:
            snap.teams[str(t.id)] = GraphTeam(
                id=str(t.id), name=t.name, department_id=str(t.department_id),
                lead_id=str(t.lead_employee_id) if t.lead_employee_id else "",
                member_ids=members_by_team.get(t.id, []),
            )
        for d in departments:
            snap.departments[str(d.id)] = GraphDepartment(
                id=str(d.id), name=d.name, description=d.description,
                head_id=str(d.head_employee_id) if d.head_employee_id else "",
                hue=d.hue if d.hue is not None else hue_for(d.id),
                team_ids=[str(t.id) for t in teams if t.department_id == d.id],
            )

        # People ---------------------------------------------------------------------
        employees = EmployeeRepository(self.db, cid, vis).list(limit=5000)
        roles = dict(
            self.db.execute(
                select(User.employee_id, User.role).where(
                    User.company_id == cid, User.employee_id.in_([e.id for e in employees])
                )
            ).all()
        ) if employees else {}
        leads = {t.lead_employee_id for t in teams if t.lead_employee_id}
        for e in employees:
            pid = str(e.id)
            squads = sorted(teams_by_person.get(pid, []), key=lambda tid: team_names.get(tid, ""))
            role = roles.get(e.id)
            snap.people[pid] = GraphPerson(
                id=pid, name=e.name, title=e.role_title or "",
                role=role.value if role is not None else "member",
                department_id=str(e.department_id) if e.department_id else None,
                team_id=str(squads[0]) if squads else None,
                initials=initials_of(e.name), email=e.email,
                is_lead=True if e.id in leads else None,
            )

        # Items ----------------------------------------------------------------------
        related: dict[str, set[str]] = defaultdict(set)
        for link in self.links.all_links():
            related[link.source_ref].add(link.target_ref)
            related[link.target_ref].add(link.source_ref)

        for item in self.items.list_all(limit=MAX_ITEMS):
            snap.items[str(item.id)] = self._item_from_brain(item, snap)

        meetings = MeetingRepository(self.db, cid, vis).list_recent(limit=MAX_MEETINGS)
        visible_meetings = {m.id for m in meetings}
        snap.ambiguous_meeting_titles = self._ambiguous_meeting_titles()
        # Legacy tasks (no meeting_id) fall back to their title only when that title
        # names exactly one meeting in the whole company. See #29 review.
        unique_title_meeting = {
            m.title: f"{MEETING_PREFIX}{m.id}" for m in meetings
            if m.title not in snap.ambiguous_meeting_titles
        }

        tasks = TaskRepository(self.db, cid, vis).list_filtered(limit=MAX_TASKS)
        for t in tasks:
            if t.status is TaskStatus.REJECTED:
                continue
            node = f"{TASK_PREFIX}{t.id}"
            snap.items[node] = self._item_from_task(t, snap)
            meeting_node = None
            if t.meeting_id is not None:
                if t.meeting_id in visible_meetings:
                    meeting_node = f"{MEETING_PREFIX}{t.meeting_id}"
            elif t.source_ref and t.source_ref.startswith(MEETING_SOURCE_PREFIX):
                meeting_node = unique_title_meeting.get(t.source_ref[len(MEETING_SOURCE_PREFIX):])
            if meeting_node:
                related[node].add(meeting_node)
                related[meeting_node].add(node)

        speakers = self._speakers([m.id for m in meetings])
        for m in meetings:
            node = f"{MEETING_PREFIX}{m.id}"
            owners = set(speakers.get(m.id, set()))
            owners.update(
                snap.items[t].owner_ids[0] for t in related.get(node, set())
                if t in snap.items and snap.items[t].kind is BrainItemKind.TASK and snap.items[t].owner_ids
            )
            snap.items[node] = self._placed(GraphItem(
                id=node, kind=BrainItemKind.MEETING, title=m.title,
                owner_ids=self._visible_people(owners, snap),
                date=m.recorded_at.date().isoformat() if m.recorded_at else None,
                status=BrainItemStatus.DONE if m.status.value == "completed" else None,
            ), snap)

        # Edges only between nodes this viewer can see.
        for node_id, item in snap.items.items():
            neighbours = sorted(r for r in related.get(node_id, set()) if r in snap.items and r != node_id)
            item.related_ids = neighbours or None
        return snap

    def can_view_scope(self, level: ScopeLevel, scope_id: str | None) -> bool:
        """canViewScope() from visibility.ts, against managed (not merely visible) org units."""
        vis = self.viewer
        if vis is None or vis.sees_all:
            return True
        parsed = _uuid(scope_id)
        if level == "org" or parsed is None:
            return False
        if level == "department":
            return parsed in vis.managed_department_ids
        if level == "team":
            return parsed in vis.managed_team_ids
        return parsed in vis.employee_ids

    def _check_scope(self, snap: Snapshot, level: ScopeLevel, scope_id: str | None) -> str:
        if level == "org":
            if scope_id not in (None, "", str(self.company_id)):
                raise NotFoundError("Scope not found.")
            if not self.can_view_scope(level, scope_id):
                raise NotFoundError("Scope not found.")
            return str(self.company_id)
        exists = {"department": snap.departments, "team": snap.teams, "member": snap.people}[level]
        if not scope_id or scope_id not in exists or not self.can_view_scope(level, scope_id):
            # One answer for "doesn't exist" and "not yours": ids cannot be probed.
            raise NotFoundError("Scope not found.")
        return scope_id

    @staticmethod
    def _people_in_scope(snap: Snapshot, level: ScopeLevel, scope_id: str) -> list[GraphPerson]:
        people = list(snap.people.values())
        if level == "department":
            return [p for p in people if p.department_id == scope_id]
        if level == "team":
            members = set(snap.teams[scope_id].member_ids)
            return [p for p in people if p.id in members]
        if level == "member":
            return [p for p in people if p.id == scope_id]
        return people

    @staticmethod
    def _items_in_scope(snap: Snapshot, level: ScopeLevel, scope_id: str) -> list[GraphItem]:
        items = list(snap.items.values())
        if level == "department":
            return [i for i in items if i.department_id == scope_id]
        if level == "team":
            members = set(snap.teams[scope_id].member_ids)
            return [i for i in items if i.team_id == scope_id or members.intersection(i.owner_ids)]
        if level == "member":
            return [i for i in items if scope_id in i.owner_ids]
        return items

    @staticmethod
    def _structure_in_scope(
        snap: Snapshot, level: ScopeLevel, scope_id: str
    ) -> tuple[list[GraphDepartment], list[GraphTeam]]:
        if level == "org":
            return list(snap.departments.values()), list(snap.teams.values())
        if level == "department":
            teams = [t for t in snap.teams.values() if t.department_id == scope_id]
            return [snap.departments[scope_id]], teams
        if level == "team":
            team = snap.teams[scope_id]
            dept = snap.departments.get(team.department_id)
            return ([dept] if dept else []), [team]
        person = snap.people[scope_id]
        teams = [t for t in snap.teams.values() if scope_id in t.member_ids]
        dept = snap.departments.get(person.department_id or "")
        return ([dept] if dept else []), teams

    # --- projection helpers -------------------------------------------------------

    def _visible_people(self, ids: Iterable, snap: Snapshot) -> list[str]:
        """Owner ids the viewer may see. Others are omitted, not exposed as bare ids."""
        return sorted({str(i) for i in ids if str(i) in snap.people})

    def _placed(self, item: GraphItem, snap: Snapshot) -> GraphItem:
        """Default an item's department/team to its first owner's, as the demo data does."""
        if item.owner_ids and (item.department_id is None or item.team_id is None):
            owner = snap.people.get(item.owner_ids[0])
            if owner:
                item.department_id = item.department_id or owner.department_id
                item.team_id = item.team_id or owner.team_id
        return item

    def _item_from_brain(self, item: BrainItem, snap: Snapshot) -> GraphItem:
        return self._placed(GraphItem(
            id=str(item.id), kind=item.kind, title=item.title, summary=item.summary,
            owner_ids=self._visible_people(item.owner_ids, snap),
            department_id=str(item.department_id) if item.department_id else None,
            team_id=str(item.team_id) if item.team_id else None,
            source=item.source, status=item.status,
            date=item.occurred_on.isoformat() if item.occurred_on else None,
            external=True if item.external else None,
        ), snap)

    def _item_from_task(self, task: Task, snap: Snapshot) -> GraphItem:
        when = task.deadline or task.created_at
        source = "meeting" if task.source_ref and task.source_ref.startswith(MEETING_SOURCE_PREFIX) else None
        return self._placed(GraphItem(
            id=f"{TASK_PREFIX}{task.id}", kind=BrainItemKind.TASK, title=task.title,
            owner_ids=self._visible_people([task.owner_employee_id] if task.owner_employee_id else [], snap),
            summary=(task.description or None) and task.description[:500],
            status=_TASK_STATUS.get(task.status), source=source or task.created_by_agent,
            date=when.date().isoformat() if when else None,
        ), snap)

    def _ambiguous_meeting_titles(self) -> frozenset[str]:
        """Titles shared by 2+ meetings in the company. Deliberately unscoped: the
        meeting that makes a title ambiguous may be one the viewer cannot see."""
        rows = self.db.execute(
            select(Meeting.title)
            .where(Meeting.company_id == self.company_id)
            .group_by(Meeting.title)
            .having(func.count() > 1)
        ).scalars()
        return frozenset(rows)

    def _speakers(self, meeting_ids: list[uuid.UUID]) -> dict[uuid.UUID, set[uuid.UUID]]:
        if not meeting_ids:
            return {}
        rows = self.db.execute(
            select(TranscriptSegment.meeting_id, TranscriptSegment.speaker_employee_id).where(
                TranscriptSegment.company_id == self.company_id,
                TranscriptSegment.meeting_id.in_(meeting_ids),
                TranscriptSegment.speaker_employee_id.is_not(None),
            ).distinct()
        ).all()
        grouped: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
        for meeting_id, speaker in rows:
            grouped[meeting_id].add(speaker)
        return grouped

    # --- writes (Owner; enforced at the route) -----------------------------------------

    def get_item_or_404(self, item_id: uuid.UUID) -> BrainItem:
        item = self.items.get(item_id)
        if item is None:
            raise NotFoundError("Item not found.")
        return item

    def create_item(self, payload: BrainItemCreate) -> BrainItem:
        values = payload.model_dump(exclude={"owner_ids", "related_ids"})
        values["kind"] = BrainItemKind(payload.kind)
        self._check_placement(payload.department_id, payload.team_id)
        if payload.source and payload.external_ref:
            existing = self.items.find_by_external_ref(payload.source, payload.external_ref)
            if existing is not None:
                # A connector re-syncing the same object updates it — Rule 3.
                return self.update_item(existing.id, BrainItemUpdate(
                    **payload.model_dump(include=set(BrainItemUpdate.model_fields))))
        item = self.items.create(**values)
        self._set_owners(item, payload.owner_ids)
        self._set_related(item, payload.related_ids)
        return item

    def update_item(self, item_id: uuid.UUID, payload: BrainItemUpdate) -> BrainItem:
        item = self.get_item_or_404(item_id)
        values = payload.model_dump(exclude_unset=True, exclude={"owner_ids", "related_ids"})
        self._check_placement(values.get("department_id"), values.get("team_id"))
        for key, value in values.items():
            if key == "external" and value is None:
                continue
            setattr(item, key, value)
        if payload.owner_ids is not None:
            self._set_owners(item, payload.owner_ids)
        if payload.related_ids is not None:
            self._set_related(item, payload.related_ids)
        self.db.flush()
        return item

    def delete_item(self, item_id: uuid.UUID) -> None:
        item = self.get_item_or_404(item_id)
        self.links.replace_links(str(item.id), [])
        self.items.delete(item.id)

    def _check_placement(self, department_id: uuid.UUID | None, team_id: uuid.UUID | None) -> None:
        if department_id and DepartmentRepository(self.db, self.company_id).get(department_id) is None:
            raise ValidationError("That department does not exist in this company.")
        if team_id and TeamRepository(self.db, self.company_id).get(team_id) is None:
            raise ValidationError("That team does not exist in this company.")

    def _set_owners(self, item: BrainItem, owner_ids: list[uuid.UUID]) -> None:
        found = {e.id for e in EmployeeRepository(self.db, self.company_id).get_many(owner_ids)}
        if missing := set(owner_ids) - found:
            raise ValidationError(f"{len(missing)} of those owners do not exist in this company.")
        self.items.set_owners(item, owner_ids)

    def _set_related(self, item: BrainItem, related_ids: list[str]) -> None:
        """Every related id must name a node in this company, or nothing is written."""
        brain_ids, task_ids, meeting_ids = set(), set(), set()
        canonical: list[str] = []
        for ref in related_ids:
            if ref.startswith(TASK_PREFIX) and (u := _uuid(ref[len(TASK_PREFIX):])):
                task_ids.add(u)
                canonical.append(f"{TASK_PREFIX}{u}")
            elif ref.startswith(MEETING_PREFIX) and (u := _uuid(ref[len(MEETING_PREFIX):])):
                meeting_ids.add(u)
                canonical.append(f"{MEETING_PREFIX}{u}")
            elif u := _uuid(ref):
                brain_ids.add(u)
                canonical.append(str(u))
            else:
                raise ValidationError(f"{ref!r} is not a node id.")
        known = (
            len({i.id for i in (BrainItemRepository(self.db, self.company_id).get(b) for b in brain_ids) if i})
            + len({t.id for t in (TaskRepository(self.db, self.company_id).get(t) for t in task_ids) if t})
            + len({m.id for m in (MeetingRepository(self.db, self.company_id).get(m) for m in meeting_ids) if m})
        )
        if known != len(brain_ids) + len(task_ids) + len(meeting_ids):
            raise ValidationError("Some related ids do not exist in this company.")
        # Stored in canonical form, so the snapshot's string match always finds them.
        self.links.replace_links(str(item.id), canonical)

    # --- vector memory ------------------------------------------------------------------

    def mirror_to_memory(self, item: BrainItem, company: Company) -> bool:
        """Copy an item into HydraDB so vector recall can find it. Best effort.

        Run after the item is committed. A failure here only means the item is found
        by keyword and graph expansion instead of by similarity.
        """
        store = get_knowledge_store()
        if store is None or not company.hydra_tenant_id:
            return False
        text = f"{item.kind.value.capitalize()}: {item.title}." + (f" {item.summary}" if item.summary else "")
        result = store.ingest_fact(
            database=company.hydra_tenant_id,
            statement=text,
            source_quote=(item.summary or item.title)[:400],
            speaker=item.source or "Sentinel graph",
            subject=item.kind.value,
            fact_type="context",
            source_ref=f"{ITEM_SOURCE_PREFIX}{item.id}",
            source_type=item.source or "graph",
            occurred_at=item.occurred_on,
        )
        if not result.ok:
            logger.warning("Could not mirror brain item %s into knowledge memory", item.id)
        return result.ok

    def forget_in_memory(self, item_id: uuid.UUID, company: Company) -> None:
        store = get_knowledge_store()
        if store is None or not company.hydra_tenant_id:
            return
        try:
            store.forget_source(database=company.hydra_tenant_id, source_ref=f"{ITEM_SOURCE_PREFIX}{item_id}")
        except Exception as exc:  # noqa: BLE001 - a stale vector is dropped on read anyway
            logger.warning("Could not remove brain item %s from knowledge memory: %s", item_id, exc)


def _uuid(value: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None
