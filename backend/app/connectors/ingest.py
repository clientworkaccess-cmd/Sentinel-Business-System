"""SourceDocuments → the company brain.

Writes a batch into ``brain_items`` (the graph, Postgres) inside the caller's
transaction, then — only after the caller commits — mirrors the changed items into
HydraDB for vector recall. Postgres is the record; HydraDB is an index of it, so a
mirror failure costs recall quality, never data.

Visibility needs nothing special here. An item's owners are the connecting person and
every participant who resolves to an employee, and the Owner / Admin / Member rules
in app/core/visibility.py apply to those owners like any other item.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass, field

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.connectors.base import (
    Connector,
    PeopleDirectory,
    SourceDocument,
    SyncBatch,
    clip,
)
from app.knowledge.store import get_knowledge_store
from app.models.brain import BrainItem, BrainItemOwner, BrainLink
from app.models.company import Company
from app.models.connection import Connection
from app.models.employee import Employee
from app.models.user import User
from app.repositories.brain import BrainItemRepository
from app.services.graph_service import ITEM_SOURCE_PREFIX

logger = logging.getLogger(__name__)

#: Mail providers whose domain says nothing about the company. An address on one of
#: these is internal only if it belongs to a known employee or user.
PUBLIC_EMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
    "yahoo.com", "ymail.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
    "protonmail.com", "gmx.com", "zoho.com", "yandex.com", "mail.com",
})
MAX_REF = 255


def build_directory(db: Session, company_id: uuid.UUID) -> PeopleDirectory:
    """Every employee's email and Slack id, and the company's own mail domains."""
    by_email: dict[str, uuid.UUID] = {}
    by_slack: dict[str, uuid.UUID] = {}
    domains: set[str] = set()
    for emp_id, email, slack_id in db.execute(
        select(Employee.id, Employee.email, Employee.slack_user_id).where(Employee.company_id == company_id)
    ):
        if email:
            by_email[email.strip().lower()] = emp_id
        if slack_id:
            by_slack[slack_id] = emp_id
    # A login email often differs from the HR record's; both identify the person.
    for email, emp_id in db.execute(
        select(User.email, User.employee_id).where(User.company_id == company_id)
    ):
        email = email.strip().lower()
        if emp_id is not None:
            by_email.setdefault(email, emp_id)
        domains.add(email.rpartition("@")[2])
    domains.update(e.rpartition("@")[2] for e in by_email)
    return PeopleDirectory(by_email=by_email, by_slack_id=by_slack,
                           company_domains=frozenset(d for d in domains if d and d not in PUBLIC_EMAIL_DOMAINS))


@dataclass
class IngestResult:
    written: int = 0
    unchanged: int = 0
    deleted: int = 0
    #: Items to mirror into HydraDB once the transaction commits.
    to_mirror: list[uuid.UUID] = field(default_factory=list)
    #: Items deleted, to forget in HydraDB once the transaction commits.
    to_forget: list[uuid.UUID] = field(default_factory=list)


def scoped_ref(connector: Connector, connection: Connection, external_ref: str) -> str:
    """The upsert key. Personal accounts are keyed per connection (see Connector.personal)."""
    ref = f"{connection.id}:{external_ref}" if connector.personal else external_ref
    if len(ref) > MAX_REF:
        ref = ref[:200] + ":" + hashlib.sha256(ref.encode()).hexdigest()[:32]
    return ref


def write_batch(
    db: Session,
    *,
    company_id: uuid.UUID,
    connection: Connection,
    connector: Connector,
    batch: SyncBatch,
    people: PeopleDirectory,
    connector_employee_id: uuid.UUID | None,
) -> IngestResult:
    """Upsert a batch's documents and apply its deletions. Does not commit."""
    items = BrainItemRepository(db, company_id)  # system actor: the whole company
    result = IngestResult()

    for doc in batch.documents:
        ref = scoped_ref(connector, connection, doc.external_ref)
        owners = _owners(doc, people, connector, connector_employee_id)
        summary = clip(doc.body) or None
        title = clip(doc.title, 500) or "(untitled)"
        existing = items.find_by_external_ref(connector.source, ref)
        if existing is None:
            item = items.create(
                kind=doc.kind, title=title, summary=summary, source=connector.source,
                external_ref=ref, occurred_on=doc.occurred_on, external=doc.external,
                connection_id=connection.id,
            )
            items.set_owners(item, owners)
            result.written += 1
            result.to_mirror.append(item.id)
            continue

        changed = (existing.title, existing.summary, existing.occurred_on, existing.external, existing.kind) != (
            title, summary, doc.occurred_on, doc.external, doc.kind)
        if connector.personal:
            new_owners = owners
        else:
            # A shared item (a Slack thread) may have been synced by several people;
            # nobody's sync removes an owner someone else's added.
            new_owners = list(dict.fromkeys([*existing.owner_ids, *owners]))
        owners_changed = set(new_owners) != set(existing.owner_ids)
        if changed:
            existing.title, existing.summary = title, summary
            existing.occurred_on, existing.external, existing.kind = doc.occurred_on, doc.external, doc.kind
        if owners_changed:
            items.set_owners(existing, new_owners)
        if existing.connection_id is None:
            existing.connection_id = connection.id
        if changed or owners_changed:
            result.written += 1
            if changed:
                result.to_mirror.append(existing.id)
        else:
            result.unchanged += 1

    if batch.deleted_refs:
        refs = [scoped_ref(connector, connection, r) for r in batch.deleted_refs]
        doomed = list(db.execute(
            select(BrainItem.id).where(BrainItem.company_id == company_id, BrainItem.source == connector.source,
                                       BrainItem.external_ref.in_(refs))
        ).scalars())
        result.deleted += delete_items(db, company_id, doomed)
        result.to_forget.extend(doomed)

    if batch.identities:
        link_identities(db, company_id, batch.identities, people)
    db.flush()
    return result


def _owners(doc: SourceDocument, people: PeopleDirectory, connector: Connector,
            connector_employee_id: uuid.UUID | None) -> list[uuid.UUID]:
    resolved: list[uuid.UUID] = []
    for address in doc.participant_emails:
        if emp := people.by_email.get(address.strip().lower()):
            resolved.append(emp)
    for slack_id in doc.participant_slack_ids:
        if emp := people.by_slack_id.get(slack_id):
            resolved.append(emp)
    if connector_employee_id and (connector.personal or not resolved):
        # A mailbox belongs to its owner. A shared item with nobody we recognise is
        # filed under whoever brought it in, rather than under nobody.
        resolved.insert(0, connector_employee_id)
    return list(dict.fromkeys(resolved))


def link_identities(db: Session, company_id: uuid.UUID, identities: dict[str, str],
                    people: PeopleDirectory) -> int:
    """Fill employees.slack_user_id from Slack profile emails. Never overwrites one."""
    taken = set(people.by_slack_id)
    linked = 0
    for slack_id, email in identities.items():
        emp_id = people.by_email.get(email)
        if emp_id is None or slack_id in taken:
            continue
        updated = db.execute(
            update(Employee)
            .where(Employee.company_id == company_id, Employee.id == emp_id, Employee.slack_user_id.is_(None))
            .values(slack_user_id=slack_id)
        ).rowcount
        if updated:
            people.by_slack_id[slack_id] = emp_id
            taken.add(slack_id)
            linked += 1
    return linked


def delete_items(db: Session, company_id: uuid.UUID, item_ids: list[uuid.UUID]) -> int:
    """Remove items with their owners and every edge touching them."""
    if not item_ids:
        return 0
    refs = [str(i) for i in item_ids]
    db.execute(delete(BrainLink).where(BrainLink.company_id == company_id,
                                       (BrainLink.source_ref.in_(refs)) | (BrainLink.target_ref.in_(refs))))
    db.execute(delete(BrainItemOwner).where(BrainItemOwner.company_id == company_id,
                                            BrainItemOwner.item_id.in_(item_ids)))
    return db.execute(delete(BrainItem).where(BrainItem.company_id == company_id,
                                              BrainItem.id.in_(item_ids))).rowcount


def count_items(db: Session, connection: Connection) -> int:
    return db.execute(
        select(func.count()).select_from(BrainItem).where(
            BrainItem.company_id == connection.company_id, BrainItem.connection_id == connection.id)
    ).scalar_one()


# --- vector memory (after commit) -------------------------------------------------------


def mirror(db: Session, company: Company, item_ids: list[uuid.UUID], connector: Connector) -> int:
    """Copy committed items into HydraDB. Best effort; returns how many landed."""
    store = get_knowledge_store()
    if store is None or not company.hydra_tenant_id or not item_ids:
        return 0
    landed = 0
    rows = db.execute(select(BrainItem).where(BrainItem.company_id == company.id, BrainItem.id.in_(item_ids)))
    for item in rows.scalars():
        text = f"{item.kind.value.capitalize()} from {connector.name}: {item.title}." + (
            f"\n{item.summary}" if item.summary else "")
        outcome = store.ingest_fact(
            database=company.hydra_tenant_id,
            statement=text,
            source_quote=(item.summary or item.title)[:400],
            speaker=connector.name,
            subject=item.kind.value,
            fact_type="context",
            source_ref=f"{ITEM_SOURCE_PREFIX}{item.id}",
            source_type=connector.source,
            occurred_at=item.occurred_on,
        )
        landed += int(outcome.ok)
    if landed < len(item_ids):
        logger.warning("Mirrored %d of %d %s items into knowledge memory", landed, len(item_ids), connector.source)
    return landed


def forget(company: Company, item_ids: list[uuid.UUID]) -> None:
    store = get_knowledge_store()
    if store is None or not company.hydra_tenant_id:
        return
    for item_id in item_ids:
        try:
            store.forget_source(database=company.hydra_tenant_id, source_ref=f"{ITEM_SOURCE_PREFIX}{item_id}")
        except Exception as exc:  # noqa: BLE001 - a stale vector is dropped on read anyway
            logger.warning("Could not remove item %s from knowledge memory: %s", item_id, type(exc).__name__)
