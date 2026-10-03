"""Outbound message API contracts (#19).

Note what the draft request does *not* accept: audience and status. Both are
decided by the gate. ``extra="forbid"`` turns an attempt to pass them into a 400
instead of a silent no-op, so a caller learns the rule rather than assuming it.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MessageAudience, MessageChannel, OutboundStatus


class OutboundDraftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: MessageChannel
    body: str = Field(min_length=1, max_length=20_000)
    subject: str | None = Field(default=None, max_length=500)
    #: A teammate. The address is taken from their record.
    recipient_employee_id: uuid.UUID | None = None
    #: Anyone else — an email, phone number or Slack Connect channel id.
    recipient_address: str | None = Field(default=None, max_length=320)
    recipient_name: str | None = Field(default=None, max_length=200)
    task_id: uuid.UUID | None = None
    thread_ref: str | None = Field(default=None, max_length=255)


class OutboundEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str | None = Field(default=None, max_length=500)
    body: str | None = Field(default=None, min_length=1, max_length=20_000)


class OutboundRejectRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


class OutboundMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    channel: MessageChannel
    audience: MessageAudience
    status: OutboundStatus
    recipient_address: str
    recipient_name: str | None = None
    recipient_employee_id: uuid.UUID | None = None
    subject: str | None = None
    body: str
    task_id: uuid.UUID | None = None
    thread_ref: str | None = None
    drafted_by_agent: str | None = None
    drafted_by_user_id: uuid.UUID | None = None
    approved_via: str | None = None
    decided_by_user_id: uuid.UUID | None = None
    decided_at: datetime | None = None
    rejection_reason: str | None = None
    edited_payload: dict | None = None
    sent_at: datetime | None = None
    delivery_error: str | None = None
    created_at: datetime


class OutboundListResponse(BaseModel):
    items: list[OutboundMessageRead]
    total: int
