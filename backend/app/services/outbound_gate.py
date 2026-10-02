"""The outbound approval gate (#19) — the only way a message leaves Sentinel.

Extends the approval system in approval_service.py from tasks to words: the AI
drafts, a human decides, the decision is recorded, and only then does a connector
send. Three guarantees, each enforced by structure rather than by convention:

1. **Every draft is born pending.** ``draft()`` writes ``pending_approval`` and the
   column defaults to it. Whether a message is internal or external is computed here
   from the recipient — it is not an argument anyone (model, route, connector) can
   pass.
2. **External needs a human.** Only ``approve()``/``retry()`` with a real user can
   clear an external message, and the database refuses an approved/sent external row
   with no ``decided_by_user_id`` (``ck_outbound_external_needs_human``). Company
   policy can auto-send *internal* follow-ups and nothing else.
3. **Connectors never see a message row.** A connector registers a
   ``ChannelSender`` and is handed a ``SendPermit``, which only this module can
   construct, and only after re-reading the row under a lock and confirming it is
   approved. There is no other sender registry and no other permit factory, so a
   connector cannot be called on an unapproved message.

Connector authors (#13): implement ``ChannelSender.send(permit)`` and call
``register_sender(channel, sender)`` at import time. Never call a provider's send API
from anywhere else.
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import ColumnElement, exists, false, func, or_, select
from sqlalchemy.orm import Session

from app.core.visibility import Visibility
from app.exceptions import ConflictError, NotFoundError, ValidationError
from app.models.audit_log import AuditLog
from app.models.company import Company
from app.models.enums import (
    EXTERNAL_ONLY_CHANNELS,
    MessageAudience,
    MessageChannel,
    OutboundStatus,
)
from app.models.outbound_message import OutboundMessage
from app.models.task import Task
from app.models.user import User
from app.repositories.task import TaskRepository
from app.services.base import TenantService

logger = logging.getLogger(__name__)

#: Once decided, a message's decision is final. Re-deciding would rewrite history.
UNDECIDED = (OutboundStatus.PENDING_APPROVAL,)


# --- the sender boundary ----------------------------------------------------------

_PERMIT_KEY = object()


class SendPermit:
    """Proof that one message was approved. Constructible only inside this module.

    Carries a copy of what to send, so a sender has no reason (and no handle) to load
    the row itself.
    """

    __slots__ = ("message_id", "company_id", "channel", "recipient_address", "recipient_name",
                 "subject", "body", "thread_ref")

    def __init__(self, key: object, message: OutboundMessage) -> None:
        if key is not _PERMIT_KEY:
            raise RuntimeError("SendPermit can only be issued by the outbound gate.")
        self.message_id = message.id
        self.company_id = message.company_id
        self.channel = message.channel
        self.recipient_address = message.recipient_address
        self.recipient_name = message.recipient_name
        self.subject = message.subject
        self.body = message.body
        self.thread_ref = message.thread_ref


@dataclass(frozen=True)
class SendResult:
    provider_message_id: str | None = None


class ChannelSender(Protocol):
    """What a connector implements. Raise on failure; the gate records it."""

    def send(self, permit: SendPermit) -> SendResult: ...


_SENDERS: dict[MessageChannel, ChannelSender] = {}


def register_sender(channel: MessageChannel, sender: ChannelSender) -> None:
    """Install the one sender for a channel. Connectors call this at import."""
    _SENDERS[channel] = sender


def registered_channels() -> frozenset[MessageChannel]:
    return frozenset(_SENDERS)


# --- audience -------------------------------------------------------------------


@dataclass(frozen=True)
class Recipient:
    audience: MessageAudience
    address: str
    name: str | None
    employee_id: uuid.UUID | None


def _employee_address(channel: MessageChannel, employee) -> str | None:
    if channel is MessageChannel.EMAIL:
        return employee.email
    if channel is MessageChannel.SLACK:
        return employee.slack_user_id
    if channel is MessageChannel.IN_APP:
        return str(employee.id)
    return None


# --- the gate -------------------------------------------------------------------


class OutboundGate(TenantService):
    """Draft, decide, dispatch. Routes and agent tools both go through this.

    Built with a viewer, the gate sees only messages in that viewer's reach, which is
    how "the Owner, or the Admin of the team it belongs to, may approve" is enforced
    (agreed on #29). A message belongs to the people behind it: the owner of the task
    it is about, its internal recipient, and whoever drafted it. Out of reach is 404.
    Without a viewer (agent tools, connectors) it acts for the whole company — and
    still cannot clear an external message, which needs a human ``decided_by``.
    """

    def __init__(
        self, db: Session, company_id: uuid.UUID, visibility: Visibility | None = None
    ) -> None:
        super().__init__(db, company_id, visibility)

    # --- reads ---------------------------------------------------------------

    def _filters(self) -> list[ColumnElement[bool]]:
        clauses: list[ColumnElement[bool]] = [OutboundMessage.company_id == self.company_id]
        vis = self.visibility
        if vis is not None and not vis.sees_all:
            people = vis.employee_ids
            if not people:
                clauses.append(false())
            else:
                clauses.append(or_(
                    exists().where(Task.id == OutboundMessage.task_id,
                                   Task.owner_employee_id.in_(people)),
                    OutboundMessage.recipient_employee_id.in_(people),
                    exists().where(User.id == OutboundMessage.drafted_by_user_id,
                                   User.employee_id.in_(people)),
                ))
        return clauses

    def _scoped(self):
        return select(OutboundMessage).where(*self._filters())

    def get_or_404(self, message_id: uuid.UUID, *, lock: bool = False) -> OutboundMessage:
        stmt = self._scoped().where(OutboundMessage.id == message_id)
        if lock:
            # populate_existing: the row may already be in this session's identity map
            # from an earlier unlocked read. Without it, SQLAlchemy hands back that cached
            # copy — still "approved" after another request committed "sent" — and the
            # message goes out twice. The lock only helps if we re-read under it.
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        message = self.db.execute(stmt).scalar_one_or_none()
        if message is None:
            raise NotFoundError("Message not found.")
        return message

    def queue(
        self,
        *,
        statuses: Sequence[OutboundStatus] | None = None,
        audience: MessageAudience | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[Sequence[OutboundMessage], int]:
        selected = list(statuses) if statuses else list(UNDECIDED)
        stmt = self._scoped().where(OutboundMessage.status.in_(selected))
        count = (
            select(func.count())
            .select_from(OutboundMessage)
            .where(*self._filters(), OutboundMessage.status.in_(selected))
        )
        if audience is not None:
            stmt = stmt.where(OutboundMessage.audience == audience)
            count = count.where(OutboundMessage.audience == audience)
        rows = self.db.execute(
            stmt.order_by(OutboundMessage.created_at.desc()).limit(limit).offset(offset)
        ).scalars().all()
        return rows, self.db.execute(count).scalar_one()

    # --- classification --------------------------------------------------------

    def classify_recipient(
        self,
        channel: MessageChannel,
        *,
        recipient_employee_id: uuid.UUID | None,
        recipient_address: str | None,
        recipient_name: str | None = None,
    ) -> Recipient:
        """Internal only when it names one of this company's employees, on a channel
        that stays inside the company, at the address on their record.

        Anything else — a bare address, a WhatsApp number, a Slack Connect channel —
        is external. The address for an internal message is copied from the employee
        record rather than accepted from the caller, so "Hira's id, a client's email"
        cannot be smuggled through as internal.
        """
        if recipient_employee_id is not None and recipient_address:
            raise ValidationError("Send either recipient_employee_id or recipient_address, not both.")

        if recipient_employee_id is not None:
            employee = self.require_own_employee(recipient_employee_id, field="recipient")
            if channel in EXTERNAL_ONLY_CHANNELS:
                raise ValidationError(
                    f"{channel.value} reaches people outside the company; address it to "
                    "the external recipient instead of an employee."
                )
            address = _employee_address(channel, employee)
            if not address:
                raise ValidationError(
                    f"{employee.name} has no {channel.value} address on their record."
                )
            return Recipient(MessageAudience.INTERNAL, address, employee.name, employee.id)

        cleaned = (recipient_address or "").strip()
        if not cleaned:
            raise ValidationError("A message needs a recipient.")
        if channel is MessageChannel.IN_APP:
            raise ValidationError("In-app messages can only go to an employee.")
        return Recipient(MessageAudience.EXTERNAL, cleaned, recipient_name, None)

    # --- commands --------------------------------------------------------------

    def draft(
        self,
        *,
        channel: MessageChannel,
        body: str,
        subject: str | None = None,
        recipient_employee_id: uuid.UUID | None = None,
        recipient_address: str | None = None,
        recipient_name: str | None = None,
        task_id: uuid.UUID | None = None,
        thread_ref: str | None = None,
        drafted_by_user: User | None = None,
        drafted_by_agent: str | None = None,
        idempotency_key: str | None = None,
    ) -> tuple[OutboundMessage, bool]:
        """Create a draft. Returns ``(message, created)``. Always pending_approval.

        An internal draft is then cleared by policy when the company allows it — that
        is the only automatic path, and it never applies to external messages.
        """
        key = idempotency_key or f"outbound:{uuid.uuid4()}"
        existing = self.db.execute(
            self._scoped().where(OutboundMessage.idempotency_key == key)
        ).scalar_one_or_none()
        if existing is not None:
            return existing, False

        if not body.strip():
            raise ValidationError("A message cannot be empty.")
        if task_id is not None:
            if TaskRepository(self.db, self.company_id, self.visibility).get(task_id) is None:
                raise ValidationError("That task does not exist in this company.")

        recipient = self.classify_recipient(
            channel,
            recipient_employee_id=recipient_employee_id,
            recipient_address=recipient_address,
            recipient_name=recipient_name,
        )
        message = OutboundMessage(
            company_id=self.company_id,
            channel=channel,
            audience=recipient.audience,
            status=OutboundStatus.PENDING_APPROVAL,
            recipient_address=recipient.address,
            recipient_name=recipient.name,
            recipient_employee_id=recipient.employee_id,
            subject=subject,
            body=body,
            task_id=task_id,
            thread_ref=thread_ref,
            drafted_by_agent=drafted_by_agent,
            drafted_by_user_id=drafted_by_user.id if drafted_by_user else None,
            idempotency_key=key,
        )
        self.db.add(message)
        self.db.flush()
        self._audit(message, "outbound.draft", actor=drafted_by_user, agent=drafted_by_agent)

        if recipient.audience is MessageAudience.INTERNAL and self._company_auto_sends_internal():
            message.status = OutboundStatus.APPROVED
            message.approved_via = "policy"
            message.decided_at = datetime.now(UTC)
            self.db.flush()
            self._audit(message, "outbound.auto_approve", agent=drafted_by_agent,
                        extra={"policy": "auto_send_internal_followups"})
        return message, True

    def approve(self, message_id: uuid.UUID, *, decided_by: User) -> OutboundMessage:
        """Clear one message to send. Call ``dispatch()`` after committing."""
        message = self.get_or_404(message_id, lock=True)
        self._require_undecided(message)
        message.status = OutboundStatus.APPROVED
        message.approved_via = "human"
        message.decided_by_user_id = decided_by.id
        message.decided_at = datetime.now(UTC)
        self.db.flush()
        self._audit(message, "outbound.approve", actor=decided_by)
        return message

    def edit(
        self,
        message_id: uuid.UUID,
        *,
        decided_by: User,
        subject: str | None = None,
        body: str | None = None,
        fields: set[str],
    ) -> OutboundMessage:
        """Change the wording. The message stays pending — editing is not deciding.

        The recipient cannot be edited: that would change who hears it without
        re-running classification. Reject and redraft instead.
        """
        message = self.get_or_404(message_id, lock=True)
        self._require_undecided(message)
        changes: dict[str, Any] = {}
        if "body" in fields:
            if not (body or "").strip():
                raise ValidationError("A message cannot be empty.")
            changes["body"] = body
        if "subject" in fields:
            changes["subject"] = subject
        if not changes:
            return message

        before = {k: getattr(message, k) for k in changes}
        for key, value in changes.items():
            setattr(message, key, value)
        message.edited_payload = {
            # Keep the AI's original across several edits, not just the last one.
            "original": (message.edited_payload or {}).get("original", before),
            "before": before,
            "after": changes,
        }
        self.db.flush()
        self._audit(message, "outbound.edit", actor=decided_by, extra={"fields": sorted(changes)})
        return message

    def reject(
        self, message_id: uuid.UUID, *, decided_by: User, reason: str | None = None
    ) -> OutboundMessage:
        message = self.get_or_404(message_id, lock=True)
        self._require_undecided(message)
        message.status = OutboundStatus.REJECTED
        message.decided_by_user_id = decided_by.id
        message.decided_at = datetime.now(UTC)
        message.rejection_reason = reason
        self.db.flush()
        self._audit(message, "outbound.reject", actor=decided_by, extra={"reason": reason})
        return message

    def retry(self, message_id: uuid.UUID, *, requested_by: User) -> OutboundMessage:
        """Put a failed (or never-delivered) approved message back for dispatch."""
        message = self.get_or_404(message_id, lock=True)
        # Retryable: a failed send, or an approved message that was never handed to a
        # sender (no connector yet — it carries a delivery_error and no sent_at). A
        # plain APPROVED row is mid-dispatch or about to be; retrying it is how a
        # double-click would send the same client email twice.
        never_delivered = (
            message.status is OutboundStatus.APPROVED
            and message.delivery_error is not None
            and message.sent_at is None
        )
        if message.status is not OutboundStatus.FAILED and not never_delivered:
            raise ConflictError(f"Only a failed or undelivered message can be retried; this one is {message.status.value}.")
        message.status = OutboundStatus.APPROVED
        message.delivery_error = None
        self.db.flush()
        self._audit(message, "outbound.retry", actor=requested_by)
        return message

    def dispatch(self, message_id: uuid.UUID) -> OutboundMessage:
        """Hand an approved message to its channel's sender. The only call site.

        Run it in its own transaction, after the approval has been committed, so a
        crash between "sent" and "recorded" can never roll the approval back and let
        the message be approved — and sent — twice.
        """
        message = self.get_or_404(message_id, lock=True)
        if message.status is not OutboundStatus.APPROVED:
            raise ConflictError(f"Only an approved message can be sent; this one is {message.status.value}.")
        if message.audience is MessageAudience.EXTERNAL and message.decided_by_user_id is None:
            # Unreachable while the CHECK constraint exists. Kept so removing the
            # constraint cannot silently open the gate.
            raise ConflictError("An external message needs a human approval before it is sent.")

        sender = _SENDERS.get(message.channel)
        if sender is None:
            message.delivery_error = (
                f"No {message.channel.value} connector is set up yet. The message is "
                "approved; connect it, then press Retry to send."
            )
            self.db.flush()
            self._audit(message, "outbound.dispatch", status="skipped",
                        extra={"reason": "no_sender"})
            return message

        try:
            result = sender.send(SendPermit(_PERMIT_KEY, message))
        except Exception as exc:  # noqa: BLE001 - any connector failure is recorded, not raised
            logger.warning("Outbound send failed for message %s on %s", message.id, message.channel.value,
                           exc_info=exc)
            message.status = OutboundStatus.FAILED
            message.delivery_error = "The connector could not deliver this message. Try again."
            self.db.flush()
            self._audit(message, "outbound.dispatch", status="failure", error=str(exc)[:500])
            return message

        message.status = OutboundStatus.SENT
        message.sent_at = datetime.now(UTC)
        message.provider_message_id = result.provider_message_id
        message.delivery_error = None
        self.db.flush()
        self._audit(message, "outbound.dispatch")
        return message

    # --- helpers ---------------------------------------------------------------

    def _require_undecided(self, message: OutboundMessage) -> None:
        if message.status not in UNDECIDED:
            raise ConflictError(
                f"This message was already {message.status.value}.",
                details={
                    "status": message.status.value,
                    "decided_at": message.decided_at.isoformat() if message.decided_at else None,
                },
            )

    def _company_auto_sends_internal(self) -> bool:
        return bool(
            self.db.execute(
                select(Company.auto_send_internal_followups).where(Company.id == self.company_id)
            ).scalar_one_or_none()
        )

    def _audit(
        self,
        message: OutboundMessage,
        tool: str,
        *,
        actor: User | None = None,
        agent: str | None = None,
        status: str = "success",
        error: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Written in the decision's own transaction: no decision without its record.

        The body is not copied in — the row keeps it, and an audit log full of client
        correspondence is personal data in a second place.
        """
        self.db.add(
            AuditLog(
                company_id=self.company_id,
                agent=agent,
                tool=tool,
                input={
                    "message_id": str(message.id),
                    "actor_user_id": str(actor.id) if actor else None,
                    "channel": message.channel.value,
                    "audience": message.audience.value,
                    **(extra or {}),
                },
                result={"status": message.status.value},
                status=status,
                error_message=error,
            )
        )
        self.db.flush()
