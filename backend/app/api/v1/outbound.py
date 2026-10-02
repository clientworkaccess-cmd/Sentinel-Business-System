"""Outbound message approvals — the human gate for words leaving the company (#19).

Mounted at ``/approvals/messages``, beside the task approval queue. Owners decide;
Owners and Admins may draft. Every decision is audited in the same transaction.

Each decision commits *before* dispatch, and dispatch commits on its own: if the
process dies mid-send, the approval is already on record and cannot be replayed into
a second approval and a second send.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Response, status

from app.dependencies import CompanyId, DbSession, OwnerOrAdminUser, OwnerUser
from app.models.enums import MessageAudience, OutboundStatus
from app.schemas.outbound import (
    OutboundDraftCreate,
    OutboundEditRequest,
    OutboundListResponse,
    OutboundMessageRead,
    OutboundRejectRequest,
)
from app.services.outbound_gate import OutboundGate

router = APIRouter(prefix="/approvals/messages", tags=["approvals"])


def get_outbound_gate(db: DbSession, company_id: CompanyId) -> OutboundGate:
    return OutboundGate(db, company_id)


Gate = Annotated[OutboundGate, Depends(get_outbound_gate)]


def _dispatch_if_cleared(gate: OutboundGate, db: DbSession, message_id: uuid.UUID) -> OutboundMessageRead:
    message = gate.get_or_404(message_id)
    if message.status is OutboundStatus.APPROVED:
        message = gate.dispatch(message_id)
        db.commit()
        db.refresh(message)
    return OutboundMessageRead.model_validate(message)


@router.get("", response_model=OutboundListResponse)
def list_messages(
    gate: Gate,
    _: OwnerUser,
    status_filter: Annotated[list[OutboundStatus] | None, Query(alias="status")] = None,
    audience: MessageAudience | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> OutboundListResponse:
    """The message queue. Defaults to everything still awaiting a decision."""
    rows, total = gate.queue(statuses=status_filter, audience=audience, limit=limit, offset=offset)
    return OutboundListResponse(items=[OutboundMessageRead.model_validate(m) for m in rows], total=total)


@router.post("", response_model=OutboundMessageRead, status_code=status.HTTP_201_CREATED)
def draft_message(
    payload: OutboundDraftCreate,
    gate: Gate,
    current_user: OwnerOrAdminUser,
    db: DbSession,
    response: Response,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> OutboundMessageRead:
    """Draft a message. It waits for approval unless it is internal and the company
    auto-sends internal follow-ups. External messages always wait."""
    message, created = gate.draft(
        **payload.model_dump(), drafted_by_user=current_user, idempotency_key=idempotency_key
    )
    db.commit()
    if not created:
        response.status_code = status.HTTP_200_OK
    return _dispatch_if_cleared(gate, db, message.id)


@router.get("/{message_id}", response_model=OutboundMessageRead)
def get_message(message_id: uuid.UUID, gate: Gate, _: OwnerUser) -> OutboundMessageRead:
    return OutboundMessageRead.model_validate(gate.get_or_404(message_id))


@router.post("/{message_id}/approve", response_model=OutboundMessageRead)
def approve_message(
    message_id: uuid.UUID, gate: Gate, current_user: OwnerUser, db: DbSession
) -> OutboundMessageRead:
    """Approve and send. 409 if it was already decided."""
    gate.approve(message_id, decided_by=current_user)
    db.commit()
    return _dispatch_if_cleared(gate, db, message_id)


@router.post("/{message_id}/edit", response_model=OutboundMessageRead)
def edit_message(
    message_id: uuid.UUID,
    payload: OutboundEditRequest,
    gate: Gate,
    current_user: OwnerUser,
    db: DbSession,
) -> OutboundMessageRead:
    """Change the wording. The message stays pending until approved."""
    message = gate.edit(
        message_id,
        decided_by=current_user,
        subject=payload.subject,
        body=payload.body,
        fields=payload.model_fields_set,
    )
    db.commit()
    db.refresh(message)
    return OutboundMessageRead.model_validate(message)


@router.post("/{message_id}/reject", response_model=OutboundMessageRead)
def reject_message(
    message_id: uuid.UUID,
    payload: OutboundRejectRequest,
    gate: Gate,
    current_user: OwnerUser,
    db: DbSession,
) -> OutboundMessageRead:
    """Reject. Nothing is sent, and the decision is final."""
    message = gate.reject(message_id, decided_by=current_user, reason=payload.reason)
    db.commit()
    db.refresh(message)
    return OutboundMessageRead.model_validate(message)


@router.post("/{message_id}/retry", response_model=OutboundMessageRead)
def retry_message(
    message_id: uuid.UUID, gate: Gate, current_user: OwnerUser, db: DbSession
) -> OutboundMessageRead:
    """Try a failed or undelivered approved message again. Does not re-approve."""
    gate.retry(message_id, requested_by=current_user)
    db.commit()
    return _dispatch_if_cleared(gate, db, message_id)
