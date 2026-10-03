"""Connection — one person's account on one connector (#11).

Composio brokers the OAuth: it runs the consent screen, holds the tokens and
refreshes them. This row holds only the opaque ``composio_account_id``, so a database
leak exposes no credential, and no token can reach the frontend or the logs because
Sentinel never has one.

Connections are personal. Gmail, Calendar and Drive are one person's mailbox,
calendar and files, so what syncs from them is owned by that person and flows
through the same Owner / Admin / Member visibility as everything else.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import ConnectionStatus, pg_enum


class Connection(UUIDPrimaryKeyMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "connections"
    __table_args__ = (
        # One account per person per connector. Reconnecting reuses the row.
        UniqueConstraint("company_id", "user_id", "connector_id", name="uq_connections_user_connector"),
        UniqueConstraint("composio_account_id", name="uq_connections_composio_account"),
    )

    #: Catalogue id, as in frontend/src/demo/connectors.ts: "gmail", "slack", ...
    connector_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    #: Who connected it. Their employee row owns what it syncs.
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Composio's connected-account id ("ca_..."). Not a secret on its own: using it
    #: needs our Composio API key.
    composio_account_id: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[ConnectionStatus] = mapped_column(
        pg_enum(ConnectionStatus, "connection_status"),
        nullable=False,
        server_default=ConnectionStatus.PENDING.value,
    )
    #: Why it is expired/failed, or why the last sync failed. Shown to the user, so it
    #: never carries provider payloads.
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The account on the other side, e.g. the mailbox address or Slack workspace.
    account_label: Mapped[str | None] = mapped_column(String(320), nullable=True)

    #: Per-connector incremental-sync state (Gmail historyId, Calendar syncToken, ...).
    #: Opaque to everything except the connector that wrote it.
    sync_cursor: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    #: Set while a sync runs, cleared when it ends. A stale value (crashed worker) is
    #: reclaimed after SYNC_LEASE — see app/connectors/runner.py.
    sync_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Items currently held from this connection — the gallery's "12,840 emails".
    item_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    def __repr__(self) -> str:
        return f"<Connection {self.connector_id} user={self.user_id} {self.status.value}>"
