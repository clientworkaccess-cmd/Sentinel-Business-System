"""Who can see what — resolved once per request, applied by the repositories.

    Owner  — everything in the company
    Admin  — the people in the departments and teams assigned to them, plus self
    Member — only themselves

This mirrors ``frontend/src/demo/visibility.ts`` so the demo and the production API
cannot disagree about the rules.

The rule this module exists for: a route never filters by role itself. It takes a
``Viewer`` (app/dependencies.py), and the repositories it reads through narrow every
query to ``Visibility``. A repository that has no rule for its model returns
nothing to a non-Owner — the failure mode of a forgotten rule is an empty list,
never a leak.
"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy import ColumnElement, false, select, true
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.enums import UserRole
from app.models.org import AdminAssignment, Department, Team, TeamMembership
from app.models.user import User


@dataclass(frozen=True)
class Visibility:
    """The resolved reach of one authenticated user. Immutable for the request."""

    role: UserRole
    user_id: uuid.UUID
    company_id: uuid.UUID
    employee_id: uuid.UUID | None
    #: Owner. Every check short-circuits to True; no id sets are loaded.
    sees_all: bool = False
    #: People whose tasks, meetings and records this viewer may read.
    employee_ids: frozenset[uuid.UUID] = field(default_factory=frozenset)
    #: Departments and teams whose *structure* (name, membership) the viewer may
    #: read. A Member sees their own department and squads as labels — reading the
    #: people inside them is still governed by ``employee_ids``.
    department_ids: frozenset[uuid.UUID] = field(default_factory=frozenset)
    team_ids: frozenset[uuid.UUID] = field(default_factory=frozenset)
    #: What an Admin manages. Empty for Owners (who manage everything) and Members.
    managed_department_ids: frozenset[uuid.UUID] = field(default_factory=frozenset)
    managed_team_ids: frozenset[uuid.UUID] = field(default_factory=frozenset)

    # --- checks ---------------------------------------------------------------------

    def can_see_employee(self, employee_id: uuid.UUID | None) -> bool:
        return self.sees_all or (employee_id is not None and employee_id in self.employee_ids)

    def can_see_department(self, department_id: uuid.UUID | None) -> bool:
        return self.sees_all or (department_id is not None and department_id in self.department_ids)

    def can_see_team(self, team_id: uuid.UUID | None) -> bool:
        return self.sees_all or (team_id is not None and team_id in self.team_ids)

    # --- SQL --------------------------------------------------------------------------

    def employee_clause(self, column: ColumnElement) -> ColumnElement[bool]:
        """``column IN (visible employees)`` — for any column holding an employee id."""
        if self.sees_all:
            return true()
        if not self.employee_ids:
            return false()
        return column.in_(self.employee_ids)

    def id_clause(self, column: ColumnElement, ids: frozenset[uuid.UUID]) -> ColumnElement[bool]:
        if self.sees_all:
            return true()
        if not ids:
            return false()
        return column.in_(ids)


def resolve_visibility(db: Session, user: User) -> Visibility:
    """Compute a user's reach from the org tables. A handful of indexed queries."""
    base = {"role": user.role, "user_id": user.id, "company_id": user.company_id,
            "employee_id": user.employee_id}

    if user.role is UserRole.OWNER:
        return Visibility(**base, sees_all=True)

    self_ids = frozenset({user.employee_id}) if user.employee_id else frozenset()
    own_depts, own_teams = _own_structure(db, user)

    if user.role is UserRole.MEMBER:
        return Visibility(**base, employee_ids=self_ids, department_ids=own_depts,
                          team_ids=own_teams)

    if user.role is UserRole.ADMIN:
        managed_depts, managed_teams = _managed(db, user)
        team_departments = frozenset(
            db.execute(
                select(Team.department_id).where(
                    Team.company_id == user.company_id, Team.id.in_(managed_teams)
                )
            ).scalars()
        ) if managed_teams else frozenset()
        return Visibility(
            **base,
            employee_ids=self_ids | _people_in(db, user.company_id, managed_depts, managed_teams),
            department_ids=own_depts | managed_depts | team_departments,
            team_ids=own_teams | managed_teams,
            managed_department_ids=managed_depts,
            managed_team_ids=managed_teams,
        )

    # An unknown role sees nothing rather than falling through to something.
    return Visibility(**base)


def _own_structure(db: Session, user: User) -> tuple[frozenset[uuid.UUID], frozenset[uuid.UUID]]:
    """The department and squads a user belongs to, as labels."""
    if user.employee_id is None:
        return frozenset(), frozenset()
    home = db.execute(
        select(Employee.department_id).where(
            Employee.company_id == user.company_id, Employee.id == user.employee_id
        )
    ).scalar_one_or_none()
    rows = db.execute(
        select(TeamMembership.team_id, Team.department_id)
        .join(Team, Team.id == TeamMembership.team_id)
        .where(TeamMembership.company_id == user.company_id,
               TeamMembership.employee_id == user.employee_id)
    ).all()
    teams = frozenset(r.team_id for r in rows)
    depts = frozenset(r.department_id for r in rows) | ({home} if home else set())
    return frozenset(depts), teams


def _managed(db: Session, user: User) -> tuple[frozenset[uuid.UUID], frozenset[uuid.UUID]]:
    """Departments and teams assigned to an Admin. A department implies its teams."""
    rows = db.execute(
        select(AdminAssignment.department_id, AdminAssignment.team_id).where(
            AdminAssignment.company_id == user.company_id, AdminAssignment.user_id == user.id
        )
    ).all()
    departments = frozenset(r.department_id for r in rows if r.department_id)
    teams = set(r.team_id for r in rows if r.team_id)
    if departments:
        teams.update(
            db.execute(
                select(Team.id).where(
                    Team.company_id == user.company_id, Team.department_id.in_(departments)
                )
            ).scalars()
        )
    return departments, frozenset(teams)


def _people_in(
    db: Session,
    company_id: uuid.UUID,
    departments: frozenset[uuid.UUID],
    teams: frozenset[uuid.UUID],
) -> frozenset[uuid.UUID]:
    """Everyone homed in those departments, in those teams, or heading/leading them."""
    people: set[uuid.UUID] = set()
    if departments:
        people.update(
            db.execute(
                select(Employee.id).where(
                    Employee.company_id == company_id, Employee.department_id.in_(departments)
                )
            ).scalars()
        )
        people.update(
            h for h in db.execute(
                select(Department.head_employee_id).where(
                    Department.company_id == company_id, Department.id.in_(departments)
                )
            ).scalars() if h
        )
    if teams:
        people.update(
            db.execute(
                select(TeamMembership.employee_id).where(
                    TeamMembership.company_id == company_id, TeamMembership.team_id.in_(teams)
                )
            ).scalars()
        )
        people.update(
            lead for lead in db.execute(
                select(Team.lead_employee_id).where(
                    Team.company_id == company_id, Team.id.in_(teams)
                )
            ).scalars() if lead
        )
    return frozenset(people)
