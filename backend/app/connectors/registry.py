"""Live connectors by catalogue id. Ids match frontend/src/demo/connectors.ts."""

from app.connectors.base import Connector
from app.connectors.google import (
    GmailConnector,
    GoogleCalendarConnector,
    GoogleDriveConnector,
)
from app.connectors.slack import SlackConnector

CONNECTORS: dict[str, Connector] = {
    c.id: c
    for c in (GmailConnector(), GoogleCalendarConnector(), GoogleDriveConnector(), SlackConnector())
}

#: Catalogue entries served by another live connector. Google Docs are exported and
#: indexed by the Drive connector, so the Docs card shows Drive's connection.
ALIASES: dict[str, str] = {"google_docs": "google_drive"}
#: Display name and count noun for each alias's card.
ALIAS_LABELS: dict[str, tuple[str, str]] = {"google_docs": ("Google Docs", "documents")}


def get_connector(connector_id: str) -> Connector | None:
    return CONNECTORS.get(ALIASES.get(connector_id, connector_id))
