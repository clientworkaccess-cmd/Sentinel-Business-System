"""Tenant-scoped data access.

Row-level multi-tenancy is enforced here rather than in Postgres RLS. The trade is
deliberate: RLS is stronger, but it adds setup and fights connection pooling. Putting
the filter in a base class means no individual query *can* forget it — which is the
property that actually matters.

Role visibility (Owner / Admin / Member) rides the same mechanism. A repository
built with a ``Visibility`` narrows every read to what that viewer may see, using
the model's ``_visible_clause()``. A model without one returns nothing to a
non-Owner, so a forgotten rule fails closed.

The one rule: a route handler never builds a query itself. It goes through a
repository constructed with a company_id taken from the signed JWT.
"""

import uuid
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Generic, TypeVar

from sqlalchemy import ColumnElement, false, func, select
from sqlalchemy.orm import Session

from app.models.base import Base

if TYPE_CHECKING:
    from app.core.visibility import Visibility

ModelT = TypeVar("ModelT", bound=Base)


class TenantScopedRepository(Generic[ModelT]):
    """Generic CRUD, permanently filtered to one company — and, optionally, one viewer.

    Every read injects ``WHERE company_id = :company_id``; every write sets it.
    Subclasses add domain queries and inherit the scoping for free — see
    ``_scoped()``, which they should build on rather than starting from ``select()``.

    ``visibility`` is None for system actors (agents, the chase cycle), which act
    for the whole company. Requests always pass one — see app/dependencies.py.
    """

    model: type[ModelT]

    def __init__(
        self, db: Session, company_id: uuid.UUID, visibility: "Visibility | None" = None
    ) -> None:
        self.db = db
        self.company_id = company_id
        self.visibility = visibility

    def _visible_clause(self, visibility: "Visibility") -> ColumnElement[bool]:
        """Which rows a non-Owner may read. Override per model; the default is none."""
        return false()

    def _filters(self) -> list[ColumnElement[bool]]:
        """Tenant filter, plus the viewer's visibility when there is a viewer."""
        clauses: list[ColumnElement[bool]] = [self.model.company_id == self.company_id]
        if self.visibility is not None and not self.visibility.sees_all:
            clauses.append(self._visible_clause(self.visibility))
        return clauses

    def _scoped(self):
        """The only entry point for a query. Always starts tenant- and viewer-filtered."""
        return select(self.model).where(*self._filters())

    def get(self, entity_id: uuid.UUID) -> ModelT | None:
        """Fetch by primary key *within this tenant and this viewer's reach*.

        Returns None for a row belonging to another company — or one the viewer may
        not see — even when the id is correct. Guessing a valid UUID must not be
        enough to read someone else's data, and a 404 does not confirm it exists.
        """
        stmt = self._scoped().where(self.model.id == entity_id)
        return self.db.execute(stmt).scalar_one_or_none()

    def list(self, *, limit: int = 100, offset: int = 0) -> Sequence[ModelT]:
        stmt = self._scoped().limit(limit).offset(offset)
        return self.db.execute(stmt).scalars().all()

    def count(self) -> int:
        stmt = select(func.count()).select_from(self.model).where(*self._filters())
        return self.db.execute(stmt).scalar_one()

    def create(self, **values: Any) -> ModelT:
        """company_id is forced from the repository, never taken from the caller."""
        values.pop("company_id", None)
        instance = self.model(company_id=self.company_id, **values)
        self.db.add(instance)
        self.db.flush()
        return instance

    def update(self, entity_id: uuid.UUID, **values: Any) -> ModelT | None:
        instance = self.get(entity_id)
        if instance is None:
            return None
        values.pop("company_id", None)
        for key, value in values.items():
            setattr(instance, key, value)
        self.db.flush()
        return instance

    def delete(self, entity_id: uuid.UUID) -> bool:
        instance = self.get(entity_id)
        if instance is None:
            return False
        self.db.delete(instance)
        self.db.flush()
        return True
