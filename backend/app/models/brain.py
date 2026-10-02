"""The company brain's own nodes and edges (#20).

Projects, clients, documents, decisions and threads live here. Tasks and meetings
do **not**: they already have tables, and the graph API projects them live (see
app/services/graph_service.py), so a task's status in the graph can never disagree
with the task.

Node ids are strings, so one link table can join any two nodes:

    <uuid>           a BrainItem
    task:<uuid>      a Task
    meeting:<uuid>   a Meeting

Each BrainItem is also mirrored into HydraDB as a fact with
``source_ref = "item:<uuid>"``, which is how a vector hit finds its way back here.
"""

import uuid
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import BrainItemKind, BrainItemStatus, pg_enum


class BrainItem(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "brain_items"
    __table_args__ = (
        # A connector re-syncing the same object updates it rather than duplicating.
        UniqueConstraint("company_id", "source", "external_ref", name="uq_brain_items_source_ref"),
    )

    kind: Mapped[BrainItemKind] = mapped_column(pg_enum(BrainItemKind, "brain_item_kind"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[BrainItemStatus | None] = mapped_column(
        pg_enum(BrainItemStatus, "brain_item_status"), nullable=True
    )
    #: Connector the item was learned from, e.g. "gmail", "slack", "fireflies".
    source: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: The connector's own id for the object. With ``source``, the upsert key.
    external_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    occurred_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: Involves someone outside the company — the flag the approval gate (#19) keys on.
    external: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    department_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True
    )

    owners: Mapped[list["BrainItemOwner"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def owner_ids(self) -> list[uuid.UUID]:
        return [o.employee_id for o in self.owners]

    def __repr__(self) -> str:
        return f"<BrainItem {self.kind.value} {self.title!r}>"


class BrainItemOwner(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    """Who an item belongs to. Visibility flows through here: see BrainItemRepository."""

    __tablename__ = "brain_item_owners"
    __table_args__ = (UniqueConstraint("item_id", "employee_id", name="uq_brain_item_owners_item_employee"),)

    item_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("brain_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )

    item: Mapped["BrainItem"] = relationship(back_populates="owners")


class BrainLink(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    """An undirected edge between two nodes — ``relatedIds`` in the frontend contract.

    Stored once with the smaller id first, so (a, b) and (b, a) are the same row.
    No FK on the refs: they may point at a task or meeting. A dangling ref is
    ignored on read rather than trusted.
    """

    __tablename__ = "brain_links"
    __table_args__ = (
        UniqueConstraint("company_id", "source_ref", "target_ref", name="uq_brain_links_pair"),
        Index("ix_brain_links_company_target", "company_id", "target_ref"),
    )

    source_ref: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_ref: Mapped[str] = mapped_column(String(80), nullable=False)
    #: Optional label, e.g. "about", "for_client", "decided_in".
    relation: Mapped[str | None] = mapped_column(String(64), nullable=True)
