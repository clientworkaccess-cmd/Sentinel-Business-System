"""Org hierarchy routes — departments, teams, and admin assignments.

Reads take a ``Viewer`` and return only what that viewer may see. Writes are
Owner-only: restructuring the org changes what everyone else can read.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.dependencies import CompanyId, DbSession, OwnerUser, Viewer
from app.models.org import Department, Team
from app.schemas.org import (
    AdminAssignmentsRead,
    AdminAssignmentsUpdate,
    DepartmentCreate,
    DepartmentRead,
    DepartmentUpdate,
    TeamCreate,
    TeamMembersUpdate,
    TeamRead,
    TeamUpdate,
)
from app.services.org_service import OrgService

router = APIRouter(prefix="/org", tags=["org"])


def get_org_service(db: DbSession, company_id: CompanyId, viewer: Viewer) -> OrgService:
    return OrgService(db, company_id, viewer)


OrgSvc = Annotated[OrgService, Depends(get_org_service)]


def _department(department: Department, service: OrgService) -> DepartmentRead:
    read = DepartmentRead.model_validate(department)
    read.team_ids = [t.id for t in service.list_teams(department_id=department.id)]
    return read


def _team(team: Team, service: OrgService) -> TeamRead:
    read = TeamRead.model_validate(team)
    read.member_ids = service.members_by_team([team.id]).get(team.id, [])
    return read


def _assignments(user_id: uuid.UUID, rows) -> AdminAssignmentsRead:
    return AdminAssignmentsRead(
        user_id=user_id,
        department_ids=[r.department_id for r in rows if r.department_id],
        team_ids=[r.team_id for r in rows if r.team_id],
    )


# --- departments -----------------------------------------------------------------


@router.get("/departments", response_model=list[DepartmentRead])
def list_departments(service: OrgSvc, _: Viewer) -> list[DepartmentRead]:
    """Departments in the caller's reach, with the teams inside them they may see."""
    return [_department(d, service) for d in service.list_departments()]


@router.post("/departments", response_model=DepartmentRead, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate, service: OrgSvc, _: OwnerUser, db: DbSession
) -> DepartmentRead:
    department = service.create_department(payload)
    db.commit()
    db.refresh(department)
    return _department(department, service)


@router.patch("/departments/{department_id}", response_model=DepartmentRead)
def update_department(
    department_id: uuid.UUID,
    payload: DepartmentUpdate,
    service: OrgSvc,
    _: OwnerUser,
    db: DbSession,
) -> DepartmentRead:
    department = service.update_department(department_id, payload)
    db.commit()
    db.refresh(department)
    return _department(department, service)


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: uuid.UUID, service: OrgSvc, _: OwnerUser, db: DbSession
) -> None:
    """Deletes its teams too. Employees homed here stay, with no department."""
    service.delete_department(department_id)
    db.commit()


# --- teams -----------------------------------------------------------------------


@router.get("/teams", response_model=list[TeamRead])
def list_teams(
    service: OrgSvc, _: Viewer, department_id: uuid.UUID | None = None
) -> list[TeamRead]:
    """Teams in the caller's reach, each with the members the caller may see."""
    teams = service.list_teams(department_id=department_id)
    members = service.members_by_team([t.id for t in teams])
    out = []
    for team in teams:
        read = TeamRead.model_validate(team)
        read.member_ids = members.get(team.id, [])
        out.append(read)
    return out


@router.post("/teams", response_model=TeamRead, status_code=status.HTTP_201_CREATED)
def create_team(payload: TeamCreate, service: OrgSvc, _: OwnerUser, db: DbSession) -> TeamRead:
    team = service.create_team(payload)
    db.commit()
    db.refresh(team)
    return _team(team, service)


@router.patch("/teams/{team_id}", response_model=TeamRead)
def update_team(
    team_id: uuid.UUID, payload: TeamUpdate, service: OrgSvc, _: OwnerUser, db: DbSession
) -> TeamRead:
    team = service.update_team(team_id, payload)
    db.commit()
    db.refresh(team)
    return _team(team, service)


@router.put("/teams/{team_id}/members", response_model=TeamRead)
def set_team_members(
    team_id: uuid.UUID,
    payload: TeamMembersUpdate,
    service: OrgSvc,
    _: OwnerUser,
    db: DbSession,
) -> TeamRead:
    """Replace the team's membership with exactly the ids sent."""
    team = service.set_team_members(team_id, payload.employee_ids)
    db.commit()
    db.refresh(team)
    return _team(team, service)


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(team_id: uuid.UUID, service: OrgSvc, _: OwnerUser, db: DbSession) -> None:
    service.delete_team(team_id)
    db.commit()


# --- admin assignments -------------------------------------------------------------


@router.get("/admins/{user_id}/assignments", response_model=AdminAssignmentsRead)
def get_admin_assignments(user_id: uuid.UUID, service: OrgSvc, _: OwnerUser) -> AdminAssignmentsRead:
    """The departments and teams this Admin manages."""
    return _assignments(user_id, service.get_admin_assignments(user_id))


@router.put("/admins/{user_id}/assignments", response_model=AdminAssignmentsRead)
def set_admin_assignments(
    user_id: uuid.UUID,
    payload: AdminAssignmentsUpdate,
    service: OrgSvc,
    _: OwnerUser,
    db: DbSession,
) -> AdminAssignmentsRead:
    """Replace what this Admin manages. Takes effect on their next request."""
    rows = service.set_admin_assignments(user_id, payload)
    db.commit()
    return _assignments(user_id, rows)
