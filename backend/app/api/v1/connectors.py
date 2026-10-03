"""Connector routes (#11–#13).

Anyone signed in may connect their *own* accounts: a mailbox, calendar or Drive is
personal, and what syncs from it is owned by its person and seen through the usual
Owner / Admin / Member rules. Nobody can connect, sync or disconnect someone else's
account through this API.

    GET    /connectors                       live status, laid over the gallery
    POST   /connectors/{id}/connect          → { redirectUrl } for Composio's consent screen
    GET    /connectors/callback              Composio sends the browser back here
    POST   /connectors/{id}/sync             sync now (202, runs in the background)
    DELETE /connectors/{id}?purge=true       revoke at Composio, remove what it synced
    GET    /connectors/connections           Owner: every connection in the company

Routes are sync ``def``: the Composio SDK blocks, so FastAPI runs them in its
threadpool rather than on the event loop.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Query, status
from fastapi.responses import RedirectResponse

from app.config import settings
from app.connectors.registry import ALIAS_LABELS
from app.connectors.runner import sync_connection
from app.connectors.service import ConnectionService, ConnectorStatus, finish_callback
from app.dependencies import CurrentUser, DbSession, OwnerUser, Viewer
from app.models.connection import Connection
from app.models.enums import ConnectionStatus
from app.schemas.connector import (
    ConnectorRead,
    ConnectStart,
    DisconnectResult,
    MyConnection,
    SyncQueued,
    TeamConnection,
)

router = APIRouter(prefix="/connectors", tags=["connectors"])

ConnectorId = Annotated[str, "catalogue id"]


def _mine(connection: Connection | None) -> MyConnection | None:
    if connection is None:
        return None
    return MyConnection(
        status=connection.status.value,
        account_label=connection.account_label,
        status_reason=connection.status_reason,
        last_synced_at=connection.last_synced_at,
        last_sync_error=connection.last_sync_error,
        syncing=connection.sync_started_at is not None,
        item_count=connection.item_count,
    )


def _read(row: ConnectorStatus) -> ConnectorRead:
    mine = row.mine
    if mine is not None and mine.status is ConnectionStatus.ACTIVE:
        gallery = "connected"
    elif mine is not None and mine.status is ConnectionStatus.PENDING:
        gallery = "pending"
    elif mine is not None:
        gallery = "needs_reconnect"
    else:
        gallery = "available"
    name, unit = ALIAS_LABELS.get(row.catalogue_id, (row.connector.name, row.connector.sync_unit))
    return ConnectorRead(
        id=row.catalogue_id, name=name, served_by=row.connector.id, available=settings.connectors_enabled,
        status=gallery, sync_unit=unit, sync_count=row.item_count, connected_count=row.connected_count,
        mine=_mine(mine),
    )


@router.get("", response_model=list[ConnectorRead], response_model_by_alias=True)
def list_connectors(
    db: DbSession, current_user: CurrentUser, viewer: Viewer, background: BackgroundTasks
) -> list[ConnectorRead]:
    """Live connectors and the caller's connection to each. Pending connections whose
    callback never arrived are settled here, so a closed tab does not strand them."""
    service = ConnectionService(db, current_user, viewer)
    rows = [_read(row) for row in service.statuses()]
    for connection_id in service.activated:
        background.add_task(sync_connection, connection_id)
    return rows


@router.get("/connections", response_model=list[TeamConnection], response_model_by_alias=True)
def team_connections(db: DbSession, current_user: OwnerUser, viewer: Viewer) -> list[TeamConnection]:
    return [
        TeamConnection(
            id=str(c.id), connector_id=c.connector_id, user_email=u.email, user_name=u.full_name,
            status=c.status.value, account_label=c.account_label, last_synced_at=c.last_synced_at,
            last_sync_error=c.last_sync_error, item_count=c.item_count,
        )
        for c, u in ConnectionService(db, current_user, viewer).team_connections()
    ]


@router.get("/callback", include_in_schema=False)
def oauth_callback(
    db: DbSession,
    background: BackgroundTasks,
    state: Annotated[str, Query(max_length=2048)] = "",
    connected_account_id: Annotated[str | None, Query(max_length=128)] = None,
) -> RedirectResponse:
    """Where Composio returns the browser. Unauthenticated: the signed state is the
    credential, and Composio is re-asked rather than the query string believed."""
    result = finish_callback(db, state, connected_account_id)
    if result.activated and result.connection_id:
        background.add_task(sync_connection, result.connection_id)
    return RedirectResponse(result.redirect_url, status_code=status.HTTP_303_SEE_OTHER)


@router.post("/{connector_id}/connect", response_model=ConnectStart, response_model_by_alias=True)
def connect(connector_id: ConnectorId, db: DbSession, current_user: CurrentUser, viewer: Viewer) -> ConnectStart:
    """Start Composio's consent flow. Send the browser to ``redirectUrl``."""
    connection, redirect_url = ConnectionService(db, current_user, viewer).start(connector_id)
    return ConnectStart(connection_id=str(connection.id), redirect_url=redirect_url)


@router.post("/{connector_id}/sync", response_model=SyncQueued, response_model_by_alias=True,
             status_code=status.HTTP_202_ACCEPTED)
def sync_now(connector_id: ConnectorId, db: DbSession, current_user: CurrentUser, viewer: Viewer,
             background: BackgroundTasks) -> SyncQueued:
    connection = ConnectionService(db, current_user, viewer).mine_or_404(connector_id)
    if connection.sync_started_at is not None:
        return SyncQueued(queued=False, message="A sync is already running.")
    connection_id: uuid.UUID = connection.id
    background.add_task(sync_connection, connection_id)
    return SyncQueued(queued=True, message="Sync started.")


@router.delete("/{connector_id}", response_model=DisconnectResult, response_model_by_alias=True)
def disconnect(
    connector_id: ConnectorId,
    db: DbSession,
    current_user: CurrentUser,
    viewer: Viewer,
    purge: bool = True,
) -> DisconnectResult:
    """Revoke the account at Composio. With ``purge`` (the default), also remove every
    item it synced, from the graph and from vector memory."""
    removed = ConnectionService(db, current_user, viewer).disconnect(connector_id, purge=purge)
    return DisconnectResult(removed_items=removed)
