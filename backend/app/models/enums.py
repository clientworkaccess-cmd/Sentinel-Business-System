"""Domain enums, stored as native Postgres enum types."""

import enum
from typing import Any

from sqlalchemy import Enum as SAEnum


def pg_enum(enum_cls: type[enum.Enum], name: str, **kwargs: Any) -> SAEnum:
    """A native Postgres enum storing the member *value*, not its Python name.

    SQLAlchemy defaults to persisting ``member.name`` — which would put
    ``'PENDING_APPROVAL'`` in the column while our server defaults say
    ``'pending_approval'``, and every insert relying on the default would fail.
    values_callable is what keeps the two halves in agreement.
    """
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=True,
        values_callable=lambda cls: [member.value for member in cls],
        **kwargs,
    )


class UserRole(str, enum.Enum):
    """Owner sees everything, Admin sees the teams they manage, Member sees self.

    What each role may *read* is resolved once per request by
    ``app.core.visibility`` — never by a role check inside a route.
    """

    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"

    # Deprecated aliases from the founder/employee model, kept so code written
    # against the old names keeps working. Aliases are not enum members: they do not
    # appear in iteration, so the Postgres enum type only ever sees the three above.
    FOUNDER = "owner"
    EMPLOYEE = "member"


class TaskStatus(str, enum.Enum):
    """A task's lifecycle.

    PENDING_APPROVAL is the server-side default. Nothing may create a task in any
    other state — the trust story cannot depend on the model remembering to ask.
    """

    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"
    REJECTED = "rejected"
    OVERDUE = "overdue"


class ApprovalState(str, enum.Enum):
    """Founder's decision on an extracted task."""

    PENDING = "pending"
    APPROVED = "approved"
    EDITED = "edited"
    REJECTED = "rejected"


class ReportedVia(str, enum.Enum):
    """How a status update reached us."""

    SLACK = "slack"
    DASHBOARD = "dashboard"
    AGENT = "agent"


class MessageChannel(str, enum.Enum):
    """Where an outbound message goes. Each has at most one registered sender."""

    EMAIL = "email"
    WHATSAPP = "whatsapp"
    SLACK = "slack"
    #: A shared channel with another organisation. External by definition.
    SLACK_CONNECT = "slack_connect"
    #: An in-product reminder. Never leaves the company.
    IN_APP = "in_app"


#: Channels that can only ever reach someone outside the company. A message on one
#: of these is external no matter who it names.
EXTERNAL_ONLY_CHANNELS = frozenset({MessageChannel.WHATSAPP, MessageChannel.SLACK_CONNECT})


class MessageAudience(str, enum.Enum):
    """Decided by the server from the recipient, never by the model or the caller."""

    INTERNAL = "internal"
    EXTERNAL = "external"


class OutboundStatus(str, enum.Enum):
    """An outbound message's lifecycle.

    PENDING_APPROVAL is the server default — as with tasks, nothing can be created
    already cleared to send. EXTERNAL messages leave it only by a human decision.
    """

    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    SENT = "sent"
    FAILED = "failed"


class BrainItemKind(str, enum.Enum):
    """A node in the company brain. Mirrors ``ItemKind`` in frontend/src/demo/types.ts."""

    PROJECT = "project"
    CLIENT = "client"
    MEETING = "meeting"
    DOCUMENT = "document"
    TASK = "task"
    DECISION = "decision"
    THREAD = "thread"


class BrainItemStatus(str, enum.Enum):
    """Mirrors ``ItemStatus`` in frontend/src/demo/types.ts."""

    ON_TRACK = "on_track"
    AT_RISK = "at_risk"
    BLOCKED = "blocked"
    DONE = "done"
    PENDING_APPROVAL = "pending_approval"


class ConnectionStatus(str, enum.Enum):
    """A connector account's lifecycle, as Sentinel last saw it.

    Composio holds the OAuth tokens. This is our cached view of its status, refreshed
    on every callback, sync and status read, so the UI never has to call Composio.
    """

    #: Link created; the user has not finished the provider's consent screen.
    PENDING = "pending"
    ACTIVE = "active"
    #: The provider rejected the grant (revoked, expired, password change). Only a
    #: reconnect fixes it, so syncs stop until then.
    EXPIRED = "expired"
    #: The consent flow failed or was abandoned.
    FAILED = "failed"
