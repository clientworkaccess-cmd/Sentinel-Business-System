"""Running a sync: one connection, start to finish.

Guarantees, each structural:

* **One sync per connection at a time, across every worker.** A run starts by
  claiming a lease with a conditional UPDATE (``sync_started_at`` null or stale).
  Two workers, or a click during a scheduled run, cannot both win it.
* **A cursor never runs ahead of the data.** Each batch's items and the cursor that
  follows them commit in one transaction. A crash re-reads that page; ingest upserts.
* **Failures land on the row, not in the logs alone.** Expired grants mark the
  connection ``expired`` (the UI asks for a reconnect); rate limits and outages keep
  the cursor and are retried on the next run.
* **Bounded.** A run stops after MAX_BATCHES and resumes from its cursor next time,
  so one huge mailbox cannot hold the scheduler.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select, update

from app.config import settings
from app.connectors import ingest
from app.connectors.base import SyncContext
from app.connectors.gateway import (
    ACTIVE,
    DEAD_STATES,
    ConnectorsUnavailable,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimited,
    get_gateway,
)
from app.connectors.registry import CONNECTORS
from app.database import SessionLocal
from app.knowledge.provisioning import ensure_knowledge_database
from app.models.company import Company
from app.models.connection import Connection
from app.models.enums import ConnectionStatus
from app.models.user import User

logger = logging.getLogger(__name__)

#: A lease older than this belongs to a crashed worker and may be taken over.
SYNC_LEASE = timedelta(minutes=30)
#: Pages per run. The cursor carries the rest to the next run.
MAX_BATCHES = 40


@dataclass
class SyncOutcome:
    ran: bool
    written: int = 0
    deleted: int = 0
    error: str | None = None
    status: str | None = None


def _claim(connection_id: uuid.UUID, now: datetime) -> bool:
    with SessionLocal() as db:
        claimed = db.execute(
            update(Connection)
            .where(
                Connection.id == connection_id,
                Connection.status == ConnectionStatus.ACTIVE,
                or_(Connection.sync_started_at.is_(None), Connection.sync_started_at < now - SYNC_LEASE),
            )
            .values(sync_started_at=now)
        ).rowcount
        db.commit()
        return bool(claimed)


def sync_connection(connection_id: uuid.UUID) -> SyncOutcome:
    """Run one connection's sync to completion (or to MAX_BATCHES). Never raises."""
    now = datetime.now(UTC)
    if not _claim(connection_id, now):
        return SyncOutcome(ran=False)

    outcome = SyncOutcome(ran=True)
    with SessionLocal() as db:
        connection = db.get(Connection, connection_id)
        company = db.get(Company, connection.company_id) if connection else None
        connector = CONNECTORS.get(connection.connector_id) if connection else None
        gateway = get_gateway()
        if connection is None or company is None or connector is None or gateway is None:
            _release(connection_id, error="Connectors are not configured on this server.")
            return SyncOutcome(ran=False, error="unavailable")

        user = db.get(User, connection.user_id)
        employee_id = user.employee_id if user else None
        people = ingest.build_directory(db, company.id)
        backfill = now - timedelta(days=settings.connector_backfill_days)
        ctx = SyncContext(gateway=gateway, account_id=connection.composio_account_id,
                          cursor=dict(connection.sync_cursor or {}), people=people,
                          backfill_since=backfill, now=now)
        mirror_ids: list[uuid.UUID] = []
        forget_ids: list[uuid.UUID] = []
        try:
            for _ in range(MAX_BATCHES):
                batch = connector.sync(ctx)
                result = ingest.write_batch(
                    db, company_id=company.id, connection=connection, connector=connector,
                    batch=batch, people=people, connector_employee_id=employee_id,
                )
                connection.sync_cursor = batch.cursor
                if batch.account_label:
                    connection.account_label = batch.account_label[:320]
                db.commit()  # items and cursor together
                outcome.written += result.written
                outcome.deleted += result.deleted
                mirror_ids += result.to_mirror
                forget_ids += result.to_forget
                ctx.cursor = dict(batch.cursor)
                if not batch.has_more:
                    break
            connection.last_synced_at = datetime.now(UTC)
            connection.last_sync_error = None
        except ProviderAuthError as exc:
            db.rollback()
            connection.status = ConnectionStatus.EXPIRED
            connection.status_reason = str(exc)
            connection.last_sync_error = str(exc)
            outcome.error = str(exc)
        except ProviderRateLimited as exc:
            db.rollback()
            connection.last_sync_error = str(exc)
            outcome.error = str(exc)
        except (ProviderError, ConnectorsUnavailable) as exc:
            db.rollback()
            connection.last_sync_error = str(exc)
            outcome.error = str(exc)
            _check_account(gateway, connection)
        except Exception:  # noqa: BLE001 - a bug in one connector must not kill the scheduler
            db.rollback()
            logger.exception("Sync crashed for connection %s (%s)", connection_id, connection.connector_id)
            connection.last_sync_error = "Sync failed unexpectedly. It will be retried."
            outcome.error = connection.last_sync_error
        finally:
            connection.sync_started_at = None
            connection.item_count = ingest.count_items(db, connection)
            db.commit()
        outcome.status = connection.status.value

        if mirror_ids or forget_ids:
            ensure_knowledge_database(db, company)
            ingest.mirror(db, company, list(dict.fromkeys(mirror_ids)), connector)
            ingest.forget(company, forget_ids)

    logger.info("Synced %s connection %s: %d written, %d deleted%s", connector.id, connection_id,
                outcome.written, outcome.deleted, f", error: {outcome.error}" if outcome.error else "")
    return outcome


def _check_account(gateway, connection: Connection) -> None:
    """After an unexplained failure, ask Composio whether the account itself died."""
    try:
        state = gateway.account(connection.composio_account_id)
    except ProviderError:
        return
    if state.status in DEAD_STATES:
        connection.status = ConnectionStatus.EXPIRED
        connection.status_reason = "The account was disconnected or expired. Reconnect it."
    elif state.status != ACTIVE:
        connection.status = ConnectionStatus.FAILED
        connection.status_reason = state.reason or "The connection is not active."


def _release(connection_id: uuid.UUID, *, error: str | None) -> None:
    with SessionLocal() as db:
        db.execute(update(Connection).where(Connection.id == connection_id)
                   .values(sync_started_at=None, last_sync_error=error))
        db.commit()


def due_connections(now: datetime | None = None) -> list[uuid.UUID]:
    """Active connections whose last sync is older than the interval, and not running."""
    now = now or datetime.now(UTC)
    interval = timedelta(minutes=max(settings.connector_sync_interval_minutes, 5))
    with SessionLocal() as db:
        return list(db.execute(
            select(Connection.id)
            .where(
                Connection.status == ConnectionStatus.ACTIVE,
                or_(Connection.last_synced_at.is_(None), Connection.last_synced_at < now - interval),
                or_(Connection.sync_started_at.is_(None),
                    and_(Connection.sync_started_at.is_not(None), Connection.sync_started_at < now - SYNC_LEASE)),
                # A run that just failed waits a full interval too (updated_at is when
                # it ended), so a provider outage is not hammered every tick.
                or_(Connection.last_sync_error.is_(None), Connection.updated_at < now - interval),
            )
            .order_by(Connection.last_synced_at.asc().nullsfirst())
        ).scalars())


def sync_due_connections() -> int:
    """The scheduler's job. Each connection in its own run; one failure stops nothing."""
    if get_gateway() is None:
        return 0
    ran = 0
    for connection_id in due_connections():
        ran += int(sync_connection(connection_id).ran)
    return ran
