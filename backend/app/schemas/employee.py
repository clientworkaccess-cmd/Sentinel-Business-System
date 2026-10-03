"""Employee API contracts."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.enums import UserRole


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    role_title: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    slack_user_id: str | None = Field(default=None, max_length=64)
    manager_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Name cannot be blank.")
        return cleaned


class EmployeeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    role_title: str | None = Field(default=None, max_length=200)
    email: EmailStr | None = None
    slack_user_id: str | None = Field(default=None, max_length=64)
    manager_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None


class EmployeeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    role_title: str | None
    slack_user_id: str | None
    manager_id: uuid.UUID | None
    department_id: uuid.UUID | None = None
    #: Whether this person has a dashboard login. Carried on the summary too, so the
    #: roster can render credential state without a per-row detail fetch.
    has_login: bool = False

    @property
    def is_slack_mapped(self) -> bool:
        return self.slack_user_id is not None


class EmployeeDetail(EmployeeSummary):
    email: EmailStr | None
    created_at: datetime
    updated_at: datetime
    manager: EmployeeSummary | None = None
    #: Direct reports, so the dashboard can render the org chart one level at a time.
    reports: list[EmployeeSummary] = []


class EmployeeListResponse(BaseModel):
    items: list[EmployeeSummary]
    total: int


#: Roles an Owner can grant to an employee login. Owner is not one of them: the
#: Owner is the account that created the company, and a second one is a decision
#: for a dedicated flow, not a dropdown.
GRANTABLE_ROLES = (UserRole.MEMBER, UserRole.ADMIN)


class EmployeeLoginCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = None
    role: UserRole = UserRole.MEMBER

    @field_validator("role")
    @classmethod
    def grantable(cls, value: UserRole) -> UserRole:
        if value not in GRANTABLE_ROLES:
            raise ValueError("Role must be member or admin.")
        return value


class EmployeeLoginUpdate(BaseModel):
    password: str | None = Field(default=None, min_length=8, max_length=128)
    full_name: str | None = None
    is_active: bool | None = None
    #: Changing it ends the person's current sessions (the token's role claim no
    #: longer matches). Demoting an Admin drops their team assignments too.
    role: UserRole | None = None

    @field_validator("role")
    @classmethod
    def grantable(cls, value: UserRole | None) -> UserRole | None:
        if value is not None and value not in GRANTABLE_ROLES:
            raise ValueError("Role must be member or admin.")
        return value


class EmployeeLoginRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    full_name: str | None = None
    is_active: bool
    role: UserRole
    employee_id: uuid.UUID
