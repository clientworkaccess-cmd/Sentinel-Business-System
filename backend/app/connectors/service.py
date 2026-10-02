"""Connect, finish, inspect and disconnect accounts. Used by app/api/v1/connectors.py.

The OAuth round trip:

    POST /connectors/gmail/connect ─► Composio link ─► Google consent
         ◄── { redirectUrl }                               │
    GET  /connectors/callback?state=…  ◄───────────────────┘
         └─► 302 FRONTEND_URL/brain/connectors?connector=gmail&result=connected

``state`` is a short-lived token signed with the server's JWT secret naming the
connection, company and user. The callback trusts nothing else in its query string:
it re-reads the account from Composio and checks that it belongs to that user before
marking anything active. A token of this kind cannot pass as a login token, nor the
reverse — the claims do not overlap (see ``_STATE_TYPE``).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.connectors import ingest
from app.connectors.base import Connector
from app.connectors.gateway import (
    ACTIVE,
    DEAD_STATES,
    FAILED_STATES,
    ConnectorsUnavailable,
    ProviderError,
    ProviderNotFound,
    require_gateway,
)
from app.connectors.registry import ALIASES, CONNECTORS, get_connector
from app.core.visibility import Visibility
from app.exceptions import ConflictError, NotFoundError, UnavailableError, UpstreamError
from app.models.company import Company
from app.models.connection import Connection
from app.models.enums import ConnectionStatus
from app.models.user import User

logger = logging.getLogger(__name__)

_STATE_TYPE = "connector_state"
STATE_TTL = timedelta(minutes=30)
#: A pending connection is re-checked with Composio at most this often on reads.
PENDING_RECHECK = timedelta(seconds=5)


def composio_user_ref(user: User) -> str:
    """The id Composio files a user's accounts under. Stable and tenant-qualified."""
    return f"sentinel-{user.company_id.hex}-{user.id.hex}"


@dataclass
class ConnectorStatus:
    connector: Connector
    catalogue_id: str
    mine: Connection | None
    #: How many people in the caller's view have connected it, and the items they hold.
    connected_count: int
    item_count: int


class ConnectionService:
    def __init__(self, db: Session, user: User, visibility: Visibility) -> None:
        self.db = db
        self.user = user
        self.company_id = user.company_id
        self.visibility = visibility

    # --- reads -------------------------------------------------------------------------

    def statuses(self) -> list[ConnectorStatus]:
        """Every live connector, with the caller's own connection and a team summary.

        Members see only their own connections. Owners see the company's; Admins see
        the connections of people they manage.
        """
        rows = self.db.execute(
            select(Connection, User.employee_id)
            .join(User, User.id == Connection.user_id)
            .where(Connection.company_id == self.company_id)
        ).all()
        self._recheck_pending([c for c, _ in rows if c.user_id == self.user.id])
        visible = [c for c, emp in rows if c.user_id == self.user.id or self.visibility.sees_all
                   or (emp is not None and emp in self.visibility.employee_ids)]
        out: list[ConnectorStatus] = []
        for catalogue_id in [*CONNECTORS, *ALIASES]:
            connector = get_connector(catalogue_id)
            mine = next((c for c in visible if c.connector_id == connector.id and c.user_id == self.user.id), None)
            active = [c for c in visible if c.connector_id == connector.id and c.status is ConnectionStatus.ACTIVE]
            out.append(ConnectorStatus(
                connector=connector, catalogue_id=catalogue_id, mine=mine,
                connected_count=len(active), item_count=sum(c.item_count for c in active),
            ))
        return out

    def team_connections(self) -> list[tuple[Connection, User]]:
        """Owner view: every connection in the company and who made it."""
        return list(self.db.execute(
            select(Connection, User).join(User, User.id == Connection.user_id)
            .where(Connection.company_id == self.company_id)
            .order_by(Connection.connector_id, User.email)
        ).tuples())

    def _recheck_pending(self, connections: list[Connection]) -> None:
        """Finish a connection whose callback never arrived (tab closed, blocked redirect)."""
        now = datetime.now(UTC)
        stale = [c for c in connections if c.status is ConnectionStatus.PENDING
                 and (c.updated_at is None or now - c.updated_at >= PENDING_RECHECK)]
        if not stale:
            return
        try:
            gateway = require_gateway()
        except ConnectorsUnavailable:
            return
        for connection in stale:
            try:
                self._apply_account_state(connection, gateway.account(connection.composio_account_id))
            except ProviderError:
                continue
        self.db.commit()

    # --- connect -----------------------------------------------------------------------

    def start(self, catalogue_id: str) -> tuple[Connection, str]:
        connector = self._connector(catalogue_id)
        gateway = self._gateway()
        existing = self._mine(connector.id)
        if existing is not None and existing.status is ConnectionStatus.ACTIVE:
            raise ConflictError(f"{connector.name} is already connected. Disconnect it first to switch accounts.")

        connection_id = existing.id if existing else uuid.uuid4()
        state = _issue_state(connection_id=connection_id, company_id=self.company_id, user_id=self.user.id)
        callback = f"{settings.public_api_url.rstrip('/')}/api/v1/connectors/callback?{urlencode({'state': state})}"
        try:
            link = gateway.link(user_ref=composio_user_ref(self.user), toolkit=connector.toolkit,
                                callback_url=callback)
        except ConnectorsUnavailable as exc:
            raise UnavailableError(str(exc)) from None
        except ProviderError as exc:
            raise UpstreamError(str(exc)) from None

        if existing is not None:
            stale_account = existing.composio_account_id
            existing.composio_account_id = link.account_id
            existing.status = ConnectionStatus.PENDING
            existing.status_reason = None
            connection = existing
            if stale_account != link.account_id:
                _forget_account(gateway, stale_account)
        else:
            connection = Connection(
                id=connection_id, company_id=self.company_id, user_id=self.user.id,
                connector_id=connector.id, composio_account_id=link.account_id,
                status=ConnectionStatus.PENDING,
            )
            self.db.add(connection)
        self.db.commit()
        return connection, link.redirect_url

    # --- disconnect ----------------------------------------------------------------------

    def disconnect(self, catalogue_id: str, *, purge: bool) -> int:
        """Remove the caller's account at Composio, then here. Returns items removed."""
        connector = self._connector(catalogue_id)
        connection = self._mine(connector.id)
        if connection is None:
            raise NotFoundError(f"{connector.name} is not connected.")
        if connection.sync_started_at is not None and datetime.now(UTC) - connection.sync_started_at < timedelta(
                minutes=30):
            raise ConflictError(f"{connector.name} is syncing right now. Try again in a minute.")
        gateway = self._gateway()
        try:
            gateway.delete(connection.composio_account_id)
        except ProviderError as exc:
            # Keep our row: deleting it would orphan a live grant at Composio.
            raise UpstreamError(f"Could not revoke the account at Composio: {exc}") from None

        removed: list[uuid.UUID] = []
        if purge:
            from app.models.brain import BrainItem

            removed = list(self.db.execute(
                select(BrainItem.id).where(BrainItem.company_id == self.company_id,
                                           BrainItem.connection_id == connection.id)
            ).scalars())
            ingest.delete_items(self.db, self.company_id, removed)
        self.db.delete(connection)
        self.db.commit()
        if removed:
            company = self.db.get(Company, self.company_id)
            ingest.forget(company, removed)
        return len(removed)

    def mine_or_404(self, catalogue_id: str) -> Connection:
        connector = self._connector(catalogue_id)
        connection = self._mine(connector.id)
        if connection is None:
            raise NotFoundError(f"{connector.name} is not connected.")
        if connection.status is not ConnectionStatus.ACTIVE:
            raise ConflictError(f"{connector.name} needs to be reconnected before it can sync.")
        return connection

    # --- helpers -------------------------------------------------------------------------

    def _connector(self, catalogue_id: str) -> Connector:
        connector = get_connector(catalogue_id)
        if connector is None:
            raise NotFoundError("That connector is not available yet.")
        return connector

    def _gateway(self):
        try:
            return require_gateway()
        except ConnectorsUnavailable as exc:
            raise UnavailableError(str(exc)) from None

    def _mine(self, connector_id: str) -> Connection | None:
        return self.db.execute(
            select(Connection).where(Connection.company_id == self.company_id,
                                     Connection.user_id == self.user.id,
                                     Connection.connector_id == connector_id)
        ).scalar_one_or_none()

    def _apply_account_state(self, connection: Connection, state) -> None:
        apply_account_state(connection, state)


def apply_account_state(connection: Connection, state) -> bool:
    """Map Composio's view of an account onto the row. Returns True when it became active."""
    was_active = connection.status is ConnectionStatus.ACTIVE
    if state.status == ACTIVE:
        connection.status = ConnectionStatus.ACTIVE
        connection.status_reason = None
        return not was_active
    if state.status in DEAD_STATES:
        connection.status = ConnectionStatus.EXPIRED
        connection.status_reason = "The account was disconnected or expired. Reconnect it."
    elif state.status in FAILED_STATES:
        connection.status = ConnectionStatus.FAILED
        connection.status_reason = "The sign-in did not complete. Try connecting again."
    else:
        # Still mid-consent. Touch the row so the recheck throttle measures from now.
        connection.updated_at = datetime.now(UTC)
    return False


# --- OAuth callback (unauthenticated: the signed state is the credential) ---------------


@dataclass
class CallbackResult:
    redirect_url: str
    connection_id: uuid.UUID | None
    activated: bool


def finish_callback(db: Session, state: str, account_hint: str | None) -> CallbackResult:
    """Validate the state, re-read the account from Composio, and settle the row."""
    claims = _read_state(state)
    if claims is None:
        return CallbackResult(_frontend(None, "expired"), None, False)
    connection = db.execute(
        select(Connection).where(Connection.id == claims["conn"], Connection.company_id == claims["cid"],
                                 Connection.user_id == claims["uid"])
    ).scalar_one_or_none()
    if connection is None:
        return CallbackResult(_frontend(None, "expired"), None, False)
    catalogue_id = connection.connector_id
    if account_hint and account_hint != connection.composio_account_id:
        # The redirect names a different account than the one this state started.
        logger.warning("Connector callback account mismatch for connection %s", connection.id)
        return CallbackResult(_frontend(catalogue_id, "failed"), connection.id, False)
    try:
        gateway = require_gateway()
        state_now = gateway.account(connection.composio_account_id)
    except ProviderNotFound:
        connection.status = ConnectionStatus.FAILED
        connection.status_reason = "The sign-in was not found. Try connecting again."
        db.commit()
        return CallbackResult(_frontend(catalogue_id, "failed"), connection.id, False)
    except ProviderError:
        # Leave it pending: the next status read re-checks with Composio.
        return CallbackResult(_frontend(catalogue_id, "pending"), connection.id, False)

    user = db.get(User, connection.user_id)
    if user is None or (state_now.user_id and state_now.user_id != composio_user_ref(user)):
        logger.warning("Connector callback user mismatch for connection %s", connection.id)
        return CallbackResult(_frontend(catalogue_id, "failed"), connection.id, False)

    activated = apply_account_state(connection, state_now)
    db.commit()
    result = {ConnectionStatus.ACTIVE: "connected", ConnectionStatus.PENDING: "pending"}.get(
        connection.status, "failed")
    return CallbackResult(_frontend(catalogue_id, result), connection.id, activated)


def _issue_state(*, connection_id: uuid.UUID, company_id: uuid.UUID, user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    claims = {"typ": _STATE_TYPE, "conn": str(connection_id), "cid": str(company_id), "uid": str(user_id),
              "iat": now, "exp": now + STATE_TTL}
    return jwt.encode(claims, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _read_state(token: str) -> dict[str, uuid.UUID] | None:
    try:
        claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if claims.get("typ") != _STATE_TYPE:
            return None
        return {k: uuid.UUID(claims[k]) for k in ("conn", "cid", "uid")}
    except (JWTError, KeyError, ValueError, TypeError):
        return None


def _frontend(catalogue_id: str | None, result: str) -> str:
    query = {"result": result, **({"connector": catalogue_id} if catalogue_id else {})}
    return f"{settings.frontend_url.rstrip('/')}/brain/connectors?{urlencode(query)}"


def _forget_account(gateway, account_id: str) -> None:
    """Best effort: remove an abandoned or superseded Composio account."""
    try:
        gateway.delete(account_id)
    except ProviderError:
        logger.info("Could not delete superseded Composio account; it holds no live grant we use.")

