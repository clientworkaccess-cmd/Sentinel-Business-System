"""Org hierarchy API contracts: departments, teams, admin assignments."""

import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _clean_name(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Name cannot be blank.")
    return cleaned


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    hue: int | None = Field(default=None, ge=0, le=359)
    head_employee_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return _clean_name(value)


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    hue: int | None = Field(default=None, ge=0, le=359)
    head_employee_id: uuid.UUID | None = None


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    department_id: uuid.UUID
    lead_employee_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return _clean_name(value)


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    department_id: uuid.UUID | None = None
    lead_employee_id: uuid.UUID | None = None


class TeamMembersUpdate(BaseModel):
    """The complete membership. Anyone not listed is removed from the team."""

    employee_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)


class TeamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    department_id: uuid.UUID
    lead_employee_id: uuid.UUID | None = None
    #: Only the members the caller may see — an Admin borrowing one engineer from
    #: another squad sees that engineer, not the rest of the squad.
    member_ids: list[uuid.UUID] = []


class DepartmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None = None
    hue: int | None = None
    head_employee_id: uuid.UUID | None = None
    team_ids: list[uuid.UUID] = []


class AdminAssignmentsUpdate(BaseModel):
    """Everything this Admin manages, replacing what they had."""

    department_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    team_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)


class AdminAssignmentsRead(BaseModel):
    user_id: uuid.UUID
    department_ids: list[uuid.UUID]
    team_ids: list[uuid.UUID]
