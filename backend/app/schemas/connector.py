"""Connector API contracts (#11).

Field names are camelCase so the gallery (frontend/src/demo/connectors.ts) can lay
live status over its catalogue without a mapping layer. The catalogue itself (logos,
copy, categories) stays in the frontend; the API answers only what is live.

Nothing here can carry a token: Sentinel never holds one.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

#: The gallery's vocabulary. ``needs_reconnect`` is an expired or failed grant.
GalleryStatus = Literal["connected", "available", "pending", "needs_reconnect"]


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class MyConnection(_Camel):
    status: Literal["pending", "active", "expired", "failed"]
    account_label: str | None = None
    status_reason: str | None = None
    last_synced_at: datetime | None = None
    last_sync_error: str | None = None
    syncing: bool = False
    item_count: int = 0


class ConnectorRead(_Camel):
    id: str
    name: str
    #: The connector that actually serves it ("google_docs" is served by "google_drive").
    served_by: str
    #: False when this server has no Composio key: the card shows, the button is off.
    available: bool
    status: GalleryStatus
    sync_unit: str
    #: Items held across the connections the caller can see.
    sync_count: int
    #: People (in the caller's view) with this connector active.
    connected_count: int
    mine: MyConnection | None = None


class ConnectStart(_Camel):
    connection_id: str
    redirect_url: str


class SyncQueued(_Camel):
    queued: bool
    message: str


class DisconnectResult(_Camel):
    removed_items: int


class TeamConnection(_Camel):
    id: str
    connector_id: str
    user_email: str
    user_name: str | None = None
    status: Literal["pending", "active", "expired", "failed"]
    account_label: str | None = None
    last_synced_at: datetime | None = None
    last_sync_error: str | None = None
    item_count: int = 0
