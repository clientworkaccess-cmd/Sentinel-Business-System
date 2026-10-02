"""The connector interface (#11).

A connector turns one person's account into ``SourceDocument``s. It knows its
provider's API and nothing else: it never touches the database, the knowledge store
or another tenant. ``app/connectors/ingest.py`` writes the documents into the graph
(``brain_items``) and vector memory (HydraDB), and ``app/connectors/runner.py`` owns
locking, cursors and failure handling.

    runner ──► connector.sync(ctx) ──► SyncBatch(documents, cursor)
       │                                    │
       └──────────── ingest.write(batch) ◄──┘
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, ClassVar

from app.connectors.gateway import Gateway
from app.models.enums import BrainItemKind

#: Body text kept per item. Enough for retrieval to quote it, small enough that a
#: mailbox does not become a copy of the mailbox.
MAX_BODY_CHARS = 4000


@dataclass
class SourceDocument:
    """One thing learned from a provider: an email thread, an event, a doc, a Slack thread."""

    #: Provider-unique within ``source``. With it, the upsert key in brain_items.
    external_ref: str
    kind: BrainItemKind
    title: str
    #: Plain text the brain can quote. Trimmed to MAX_BODY_CHARS by ingest.
    body: str = ""
    occurred_on: date | None = None
    #: Email addresses and/or Slack user ids of everyone involved. Ingest resolves
    #: them to employees; the connecting person is always added as an owner.
    participant_emails: list[str] = field(default_factory=list)
    participant_slack_ids: list[str] = field(default_factory=list)
    #: Somebody outside the company is involved.
    external: bool = False
    #: Link back to the original, shown in the item drawer.
    url: str | None = None


@dataclass
class SyncBatch:
    documents: list[SourceDocument]
    #: The cursor to store if — and only if — the batch was written successfully.
    cursor: dict[str, Any]
    #: External refs the provider says were deleted.
    deleted_refs: list[str] = field(default_factory=list)
    #: More pages remain; the runner calls sync() again in the same run.
    has_more: bool = False
    #: Human label for the account, e.g. "alyan@arcline.pk". Optional.
    account_label: str | None = None
    #: Provider user id → email, for linking accounts to employees (Slack ids today).
    identities: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class PeopleDirectory:
    """Who is who in this company, so participants can be resolved to employees."""

    by_email: dict[str, uuid.UUID]
    by_slack_id: dict[str, uuid.UUID]
    #: Domains the company's own people use. An address outside them is external.
    company_domains: frozenset[str]

    def is_internal_email(self, address: str) -> bool:
        address = address.strip().lower()
        if address in self.by_email:
            return True
        domain = address.rpartition("@")[2]
        return bool(domain) and domain in self.company_domains

    def any_external(self, addresses: Iterable[str]) -> bool:
        return any(a and not self.is_internal_email(a) for a in addresses)


@dataclass
class SyncContext:
    gateway: Gateway
    account_id: str
    #: The connector's own state from last time ({} on a first sync).
    cursor: dict[str, Any]
    people: PeopleDirectory
    #: First syncs reach back this far.
    backfill_since: datetime
    now: datetime
    #: Per-run memo shared by every sync() call in one run (e.g. Slack's user list).
    #: Never persisted, so it may hold things the cursor must not, like emails.
    scratch: dict[str, Any] = field(default_factory=dict)


class Connector(ABC):
    """One provider product. Stateless: everything per-account arrives in ``ctx``."""

    #: Catalogue id — frontend/src/demo/connectors.ts.
    id: ClassVar[str]
    #: Composio toolkit slug.
    toolkit: ClassVar[str]
    name: ClassVar[str]
    #: Stored on brain_items.source.
    source: ClassVar[str]
    #: Noun for the gallery count: "emails", "events", "files", "threads".
    sync_unit: ClassVar[str]
    #: Personal accounts (a mailbox) key items per connection, so two people's copies
    #: of a thread stay separate. Shared sources (a Slack workspace) key by the
    #: provider's id alone, so two people connecting it produce one item.
    personal: ClassVar[bool] = True

    @abstractmethod
    def sync(self, ctx: SyncContext) -> SyncBatch:
        """Fetch one page of changes since ``ctx.cursor``.

        Must be safe to repeat: the runner only stores the returned cursor after the
        batch is written, so a crash re-fetches the same page, and ingest upserts.
        """


def clip(text: str | None, limit: int = MAX_BODY_CHARS) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"
