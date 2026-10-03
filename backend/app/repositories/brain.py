"""Brain item and link data access, visibility-scoped like everything else."""

import uuid
from collections.abc import Collection, Sequence
from typing import TYPE_CHECKING

from sqlalchemy import ColumnElement, delete, exists, false, or_

from app.models.brain import BrainItem, BrainItemOwner, BrainLink
from app.repositories.base import TenantScopedRepository

if TYPE_CHECKING:
    from app.core.visibility import Visibility


class BrainItemRepository(TenantScopedRepository[BrainItem]):
    model = BrainItem

    def _visible_clause(self, visibility: "Visibility") -> ColumnElement[bool]:
        """Mirrors visibleItems() in frontend/src/demo/visibility.ts.

        An item is visible through any owner in reach, or — for an Admin — by being
        filed under a department or team they manage, even with no owner in reach.
        """
        clauses: list[ColumnElement[bool]] = []
        if visibility.employee_ids:
            clauses.append(
                exists().where(
                    BrainItemOwner.item_id == BrainItem.id,
                    BrainItemOwner.employee_id.in_(visibility.employee_ids),
                )
            )
        if visibility.managed_department_ids:
            clauses.append(BrainItem.department_id.in_(visibility.managed_department_ids))
        if visibility.managed_team_ids:
            clauses.append(BrainItem.team_id.in_(visibility.managed_team_ids))
        return or_(*clauses) if clauses else false()

    def list_all(self, *, limit: int = 1000) -> Sequence[BrainItem]:
        stmt = self._scoped().order_by(BrainItem.occurred_on.desc().nullslast()).limit(limit)
        return self.db.execute(stmt).scalars().all()

    def find_by_external_ref(self, source: str, external_ref: str) -> BrainItem | None:
        stmt = self._scoped().where(BrainItem.source == source, BrainItem.external_ref == external_ref)
        return self.db.execute(stmt).scalar_one_or_none()

    def set_owners(self, item: BrainItem, employee_ids: Collection[uuid.UUID]) -> None:
        """Diffed, not replaced: the unit of work inserts before it deletes orphans,
        so re-adding an existing owner wholesale would trip the unique constraint."""
        wanted = list(dict.fromkeys(employee_ids))
        item.owners = [o for o in item.owners if o.employee_id in wanted]
        have = {o.employee_id for o in item.owners}
        item.owners.extend(
            BrainItemOwner(company_id=self.company_id, employee_id=e) for e in wanted if e not in have
        )
        self.db.flush()


def ordered_pair(a: str, b: str) -> tuple[str, str]:
    """Links are undirected and stored once, smaller ref first."""
    return (a, b) if a <= b else (b, a)


class BrainLinkRepository(TenantScopedRepository[BrainLink]):
    """Edges carry no data of their own; reads are filtered by the nodes they join."""

    model = BrainLink

    def _visible_clause(self, visibility: "Visibility") -> ColumnElement[bool]:
        # Never read through a viewer: GraphService drops edges to invisible nodes.
        return false()

    def all_links(self) -> Sequence[BrainLink]:
        return self.db.execute(self._scoped()).scalars().all()

    def links_touching(self, ref: str) -> Sequence[BrainLink]:
        stmt = self._scoped().where(or_(BrainLink.source_ref == ref, BrainLink.target_ref == ref))
        return self.db.execute(stmt).scalars().all()

    def replace_links(self, ref: str, related: Collection[str]) -> None:
        """Make ``ref``'s neighbour set exactly ``related``."""
        self.db.execute(
            delete(BrainLink).where(
                BrainLink.company_id == self.company_id,
                or_(BrainLink.source_ref == ref, BrainLink.target_ref == ref),
            )
        )
        for other in dict.fromkeys(related):
            if other == ref:
                continue
            source, target = ordered_pair(ref, other)
            self.db.add(BrainLink(company_id=self.company_id, source_ref=source, target_ref=target))
        self.db.flush()

    def add_link(self, a: str, b: str, relation: str | None = None) -> None:
        source, target = ordered_pair(a, b)
        found = self.db.execute(
            self._scoped().where(BrainLink.source_ref == source, BrainLink.target_ref == target)
        ).scalar_one_or_none()
        if found is None and a != b:
            self.db.add(BrainLink(company_id=self.company_id, source_ref=source, target_ref=target,
                                  relation=relation))
            self.db.flush()

