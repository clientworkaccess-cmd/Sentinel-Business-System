"""Company graph routes (#20).

``GET /graph`` is the production replacement for the frontend's hard-coded demo org:
same shape, real data, narrowed to the caller. ``GET /graph/search`` is the hybrid
retrieval the chat agent uses, exposed so the UI can show what an answer drew on.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.dependencies import CompanyId, CurrentUser, DbSession, OwnerUser, Viewer
from app.schemas.graph import (
    BrainItemCreate,
    BrainItemUpdate,
    GraphItem,
    GraphRead,
    RetrievalRead,
    ScopeLevel,
)
from app.services.graph_service import GraphService
from app.services.hybrid_retrieval import HybridRetriever

router = APIRouter(prefix="/graph", tags=["graph"])


def get_graph_service(db: DbSession, company_id: CompanyId, viewer: Viewer) -> GraphService:
    return GraphService(db, company_id, viewer)


GraphSvc = Annotated[GraphService, Depends(get_graph_service)]


def _as_node(service: GraphService, item_id: uuid.UUID) -> GraphItem:
    """The item as the graph renders it, related ids and all."""
    return service.snapshot().items[str(item_id)]


@router.get("", response_model=GraphRead, response_model_exclude_none=True)
def get_graph(
    service: GraphSvc,
    _: Viewer,
    level: ScopeLevel = "org",
    id: Annotated[str | None, Query(max_length=80)] = None,  # noqa: A002 - matches the contract
) -> GraphRead:
    """``{departments, teams, people, items}`` for one scope, in the demo data's shape.

    Owner: any scope. Admin: the departments/teams they manage and the people in them.
    Member: ``level=member&id=<self>`` only. Anything else is 404, so scopes can't be
    probed.
    """
    return service.graph(level, id)


@router.get("/search", response_model=RetrievalRead, response_model_exclude_none=True)
def search_graph(
    current_user: CurrentUser,
    viewer: Viewer,
    db: DbSession,
    q: Annotated[str, Query(min_length=1, max_length=500)],
    limit: Annotated[int, Query(ge=1, le=25)] = 8,
) -> RetrievalRead:
    """Hybrid retrieval: vector recall, graph expansion, then the caller's visibility."""
    return HybridRetriever(db, current_user.company, viewer).search(q, limit=limit)


@router.post("/items", response_model=GraphItem, response_model_exclude_none=True,
             status_code=status.HTTP_201_CREATED)
def create_item(
    payload: BrainItemCreate, service: GraphSvc, current_user: OwnerUser, db: DbSession
) -> GraphItem:
    """Add a project, client, document, decision or thread. Sending the same
    ``source`` + ``external_ref`` again updates the existing item."""
    item = service.create_item(payload)
    db.commit()
    service.mirror_to_memory(item, current_user.company)
    return _as_node(service, item.id)


@router.patch("/items/{item_id}", response_model=GraphItem, response_model_exclude_none=True)
def update_item(
    item_id: uuid.UUID,
    payload: BrainItemUpdate,
    service: GraphSvc,
    current_user: OwnerUser,
    db: DbSession,
) -> GraphItem:
    item = service.update_item(item_id, payload)
    db.commit()
    service.mirror_to_memory(item, current_user.company)
    return _as_node(service, item.id)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: uuid.UUID, service: GraphSvc, current_user: OwnerUser, db: DbSession
) -> None:
    service.delete_item(item_id)
    db.commit()
    service.forget_in_memory(item_id, current_user.company)
