"""Org hierarchy data access: departments, teams, memberships, admin assignments."""

import uuid
from collections.abc import Collection, Sequence
from typing import TYPE_CHECKING

from sqlalchemy import ColumnElement, delete, select

from app.models.org import AdminAssignment, Department, Team, TeamMembership
from app.repositories.base import TenantScopedRepository

if TYPE_CHECKING:
    from app.core.visibility import Visibility


class DepartmentRepository(TenantScopedRepository[Department]):
    model = Department

    def _visible_clause(self, visibility: "Visibility") -> ColumnElement[bool]:
        return visibility.id_clause(Department.id, visibility.department_ids)

    def list_ordered(self) -> Sequence[Department]:
        return self.db.execute(self._scoped().order_by(Department.name)).scalars().all()


class TeamRepository(TenantScopedRepository[Team]):
    model = Team

    def _visible_clause(self, visibility: "Visibility") -> ColumnElement[bool]:
        return visibility.id_clause(Team.id, visibility.team_ids)

    def list_ordered(self, *, department_id: uuid.UUID | None = None) -> Sequence[Team]:
        stmt = self._scoped().order_by(Team.name)
        if department_id is not None:
            stmt = stmt.where(Team.department_id == department_id)
        return self.db.execute(stmt).scalars().all()


class TeamMembershipRepository(TenantScopedRepository[TeamMembership]):
    """Who is in which squad. Readable as labels wherever the team itself is."""

    model = TeamMembership

    def _visible_clause(self, visibility: "Visibility") -> ColumnElement[bool]:
        # A membership row names a person, so it needs both the team and the person
        # in reach — an Admin borrowing one engineer does not see the whole squad.
        return visibility.id_clause(TeamMembership.team_id, visibility.team_ids) & (
            visibility.employee_clause(TeamMembership.employee_id)
        )

    def for_teams(self, team_ids: Collection[uuid.UUID]) -> Sequence[TeamMembership]:
        if not team_ids:
            return []
        stmt = self._scoped().where(TeamMembership.team_id.in_(list(team_ids)))
        return self.db.execute(stmt).scalars().all()

    def replace_members(self, team_id: uuid.UUID, employee_ids: Collection[uuid.UUID]) -> None:
        """Set a team's membership to exactly ``employee_ids``. Ids are pre-validated."""
        self.db.execute(
            delete(TeamMembership).where(
                TeamMembership.company_id == self.company_id, TeamMembership.team_id == team_id
            )
        )
        for employee_id in dict.fromkeys(employee_ids):
            self.db.add(
                TeamMembership(company_id=self.company_id, team_id=team_id, employee_id=employee_id)
            )
        self.db.flush()


class AdminAssignmentRepository(TenantScopedRepository[AdminAssignment]):
    """Owner-managed. Never read through a non-Owner viewer, so no visibility rule."""

    model = AdminAssignment

    def for_user(self, user_id: uuid.UUID) -> Sequence[AdminAssignment]:
        stmt = self._scoped().where(AdminAssignment.user_id == user_id)
        return self.db.execute(stmt).scalars().all()

    def replace_for_user(
        self,
        user_id: uuid.UUID,
        *,
        department_ids: Collection[uuid.UUID],
        team_ids: Collection[uuid.UUID],
    ) -> Sequence[AdminAssignment]:
        self.clear_for_user(user_id)
        for department_id in dict.fromkeys(department_ids):
            self.db.add(
                AdminAssignment(company_id=self.company_id, user_id=user_id,
                                department_id=department_id)
            )
        for team_id in dict.fromkeys(team_ids):
            self.db.add(AdminAssignment(company_id=self.company_id, user_id=user_id, team_id=team_id))
        self.db.flush()
        return self.for_user(user_id)

    def clear_for_user(self, user_id: uuid.UUID) -> None:
        self.db.execute(
            delete(AdminAssignment).where(
                AdminAssignment.company_id == self.company_id, AdminAssignment.user_id == user_id
            )
        )
        self.db.flush()


def existing_ids(repo: TenantScopedRepository, ids: Collection[uuid.UUID]) -> set[uuid.UUID]:
    """Which of ``ids`` exist in the repository's tenant (and reach). One query."""
    if not ids:
        return set()
    model = repo.model
    stmt = select(model.id).where(*repo._filters(), model.id.in_(list(ids)))
    return set(repo.db.execute(stmt).scalars())
