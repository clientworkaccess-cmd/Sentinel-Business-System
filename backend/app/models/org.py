"""The org hierarchy: Department → Team → Member, and who administers what.

These tables answer one question for the visibility layer: which employees may an
Admin see? Everything an Admin can read hangs off the employees inside the
departments and teams assigned to them in ``admin_assignments``.

An employee's *home* department is ``employees.department_id``; their squads are
``team_memberships``. Both count, so a department head with no squad and a squad
member borrowed from another department are each visible to the right Admin.
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.employee import Employee


class Department(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("company_id", "name", name="uq_departments_company_name"),)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Hue in degrees, 0–359. The graph colours a department's cluster from it, so it
    #: is stored rather than derived — a rename must not repaint the org.
    hue: Mapped[int | None] = mapped_column(Integer, nullable=True)
    head_employee_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )

    teams: Mapped[list["Team"]] = relationship(
        back_populates="department", cascade="all, delete-orphan", order_by="Team.name"
    )
    head: Mapped["Employee | None"] = relationship(foreign_keys=[head_employee_id])

    def __repr__(self) -> str:
        return f"<Department {self.name!r}>"


class Team(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("department_id", "name", name="uq_teams_department_name"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    department_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("departments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lead_employee_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )

    department: Mapped["Department"] = relationship(back_populates="teams")
    memberships: Mapped[list["TeamMembership"]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Team {self.name!r}>"


class TeamMembership(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "team_memberships"
    __table_args__ = (
        UniqueConstraint("team_id", "employee_id", name="uq_team_memberships_team_employee"),
    )

    team_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    team: Mapped["Team"] = relationship(back_populates="memberships")

    def __repr__(self) -> str:
        return f"<TeamMembership team={self.team_id} employee={self.employee_id}>"


class AdminAssignment(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    """One department *or* one team an Admin manages. Never both on one row.

    Assigning a department implies every team inside it, so an Admin over
    Engineering does not need a row per squad — and a squad added later is covered
    without anyone remembering to grant it.
    """

    __tablename__ = "admin_assignments"
    __table_args__ = (
        CheckConstraint(
            "(department_id IS NULL) <> (team_id IS NULL)",
            name="ck_admin_assignments_exactly_one_target",
        ),
        UniqueConstraint("user_id", "department_id", name="uq_admin_assignments_user_department"),
        UniqueConstraint("user_id", "team_id", name="uq_admin_assignments_user_team"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("departments.id", ondelete="CASCADE"), nullable=True
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="CASCADE"), nullable=True
    )

    def __repr__(self) -> str:
        target = f"department={self.department_id}" if self.department_id else f"team={self.team_id}"
        return f"<AdminAssignment user={self.user_id} {target}>"
