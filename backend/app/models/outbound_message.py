"""OutboundMessage — anything Sentinel would say to someone, waiting for a human.

The external-message half of the approval gate (#19). The task Approval decides
whether work is delegated; this decides whether words leave the building.

Two rules are schema constraints, not application code, for the same reason as on
Task — a constraint cannot be forgotten:

* status defaults to pending_approval, so nothing is born cleared to send
* an EXTERNAL message cannot be approved or sent without a human decider
  (``ck_outbound_external_needs_human``)
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import MessageAudience, MessageChannel, OutboundStatus, pg_enum


class OutboundMessage(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "outbound_messages"
    __table_args__ = (
        CheckConstraint(
            "audience <> 'external' OR status NOT IN ('approved', 'sent', 'failed') "
            "OR decided_by_user_id IS NOT NULL",
            name="ck_outbound_external_needs_human",
        ),
        # A re-run agent or a double-clicked Draft returns the original draft.
        UniqueConstraint("company_id", "idempotency_key", name="uq_outbound_company_idempotency"),
        # The queue's hot path.
        Index("ix_outbound_company_status_created", "company_id", "status", "created_at"),
    )

    channel: Mapped[MessageChannel] = mapped_column(
        pg_enum(MessageChannel, "message_channel"), nullable=False
    )
    #: Computed by the gate from the recipient — see classify_recipient(). Not an
    #: input on any API or tool.
    audience: Mapped[MessageAudience] = mapped_column(
        pg_enum(MessageAudience, "message_audience"), nullable=False
    )
    status: Mapped[OutboundStatus] = mapped_column(
        pg_enum(OutboundStatus, "outbound_status"),
        nullable=False,
        server_default=OutboundStatus.PENDING_APPROVAL.value,
        index=True,
    )

    #: Email address, phone number, Slack user/channel id — whatever the channel
    #: addresses. For an internal message it is copied from the employee record, so a
    #: caller cannot pair a teammate's id with a client's address.
    recipient_address: Mapped[str] = mapped_column(String(320), nullable=False)
    recipient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    recipient_employee_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )

    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    #: What it is about, when it is about a task. Context for the reviewer.
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    #: Provider thread to reply into (email thread, Slack thread ts).
    thread_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)

    #: Which agent drafted it, or null when a person typed it.
    drafted_by_agent: Mapped[str | None] = mapped_column(String(64), nullable=True)
    drafted_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    #: "human" or "policy". Policy approval exists only for internal messages, when
    #: the company has turned on auto_send_internal_followups.
    approved_via: Mapped[str | None] = mapped_column(String(16), nullable=True)
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The AI's draft and the human's correction, kept side by side.
    edited_payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: The provider's id for the delivered message, for threading and support.
    provider_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Plain-English reason the last delivery attempt did not go out.
    delivery_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)

    def __repr__(self) -> str:
        return f"<OutboundMessage {self.channel.value} {self.audience.value} {self.status.value}>"
