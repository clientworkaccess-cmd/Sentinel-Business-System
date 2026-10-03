"""Org hierarchy business logic — departments, teams, and who administers them.

Writes are Owner-only (enforced at the route). The rule every write here keeps: an
id arriving in a request body is resolved inside this tenant before it is stored,
so a department head, team lead, team member or admin can never point across a
company boundary.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.core.visibility import Visibility
from app.exceptions import NotFoundError, ValidationError
from app.models.enums import UserRole
from app.models.org import AdminAssignment, Department, Team
from app.repositories.org import (
    AdminAssignmentRepository,
    DepartmentRepository,
    TeamMembershipRepository,
    TeamRepository,
    existing_ids,
)
from app.repositories.user import UserRepository
from app.schemas.org import (
    AdminAssignmentsUpdate,
    DepartmentCreate,
    DepartmentUpdate,
    TeamCreate,
    TeamUpdate,
)
from app.services.base import TenantService


class OrgService(TenantService):
    def __init__(
        self, db: Session, company_id: uuid.UUID, visibility: Visibility | None = None
    ) -> None:
        super().__init__(db, company_id, visibility)
        self.departments = DepartmentRepository(db, company_id, visibility)
        self.teams = TeamRepository(db, company_id, visibility)
        self.memberships = TeamMembershipRepository(db, company_id, visibility)
        self.assignments = AdminAssignmentRepository(db, company_id)
        self.users = UserRepository(db, company_id)

    # --- reads ------------------------------------------------------------------

    def list_departments(self) -> Sequence[Department]:
        return self.departments.list_ordered()

    def get_department_or_404(self, department_id: uuid.UUID) -> Department:
        department = self.departments.get(department_id)
        if department is None:
            raise NotFoundError("Department not found.")
        return department

    def list_teams(self, *, department_id: uuid.UUID | None = None) -> Sequence[Team]:
        return self.teams.list_ordered(department_id=department_id)

    def get_team_or_404(self, team_id: uuid.UUID) -> Team:
        team = self.teams.get(team_id)
        if team is None:
            raise NotFoundError("Team not found.")
        return team

    def members_by_team(self, team_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[uuid.UUID]]:
        """Visible member ids per team, in one query."""
        grouped: dict[uuid.UUID, list[uuid.UUID]] = {t: [] for t in team_ids}
        for row in self.memberships.for_teams(team_ids):
            grouped.setdefault(row.team_id, []).append(row.employee_id)
        return grouped

    # --- departments --------------------------------------------------------------

    def create_department(self, payload: DepartmentCreate) -> Department:
        self.require_own_employee(payload.head_employee_id, field="department head")
        return self.departments.create(**payload.model_dump())

    def update_department(self, department_id: uuid.UUID, payload: DepartmentUpdate) -> Department:
        department = self.get_department_or_404(department_id)
        values = payload.model_dump(exclude_unset=True)
        if "head_employee_id" in values:
            self.require_own_employee(values["head_employee_id"], field="department head")
        for key, value in values.items():
            setattr(department, key, value)
        self.db.flush()
        return department

    def delete_department(self, department_id: uuid.UUID) -> None:
        """Teams cascade; employees homed here keep their row with no department."""
        self.get_department_or_404(department_id)
        self.departments.delete(department_id)

    # --- teams --------------------------------------------------------------------

    def create_team(self, payload: TeamCreate) -> Team:
        self.get_department_or_404(payload.department_id)
        self.require_own_employee(payload.lead_employee_id, field="team lead")
        return self.teams.create(**payload.model_dump())

    def update_team(self, team_id: uuid.UUID, payload: TeamUpdate) -> Team:
        team = self.get_team_or_404(team_id)
        values = payload.model_dump(exclude_unset=True)
        if "department_id" in values:
            if values["department_id"] is None:
                raise ValidationError("A team must belong to a department.")
            self.get_department_or_404(values["department_id"])
        if "lead_employee_id" in values:
            self.require_own_employee(values["lead_employee_id"], field="team lead")
        for key, value in values.items():
            setattr(team, key, value)
        self.db.flush()
        return team

    def delete_team(self, team_id: uuid.UUID) -> None:
        self.get_team_or_404(team_id)
        self.teams.delete(team_id)

    def set_team_members(self, team_id: uuid.UUID, employee_ids: list[uuid.UUID]) -> Team:
        team = self.get_team_or_404(team_id)
        found = existing_ids(self.employees, employee_ids)
        if missing := set(employee_ids) - found:
            raise ValidationError(f"{len(missing)} of those employees do not exist in this company.")
        self.memberships.replace_members(team.id, employee_ids)
        return team

    # --- admin assignments ----------------------------------------------------------

    def get_admin_assignments(self, user_id: uuid.UUID) -> Sequence[AdminAssignment]:
        self._require_admin(user_id)
        return self.assignments.for_user(user_id)

    def set_admin_assignments(
        self, user_id: uuid.UUID, payload: AdminAssignmentsUpdate
    ) -> Sequence[AdminAssignment]:
        """Replace what an Admin manages. The next request they make sees the change."""
        self._require_admin(user_id)
        if missing := set(payload.department_ids) - existing_ids(self.departments, payload.department_ids):
            raise ValidationError(f"{len(missing)} of those departments do not exist in this company.")
        if missing := set(payload.team_ids) - existing_ids(self.teams, payload.team_ids):
            raise ValidationError(f"{len(missing)} of those teams do not exist in this company.")
        return self.assignments.replace_for_user(
            user_id, department_ids=payload.department_ids, team_ids=payload.team_ids
        )

    def _require_admin(self, user_id: uuid.UUID) -> None:
        user = self.users.get(user_id)
        if user is None:
            raise NotFoundError("User not found.")
        if user.role is not UserRole.ADMIN:
            raise ValidationError("Only users with the admin role can be assigned teams.")

