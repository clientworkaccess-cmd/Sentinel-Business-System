"""Graph API contracts (#20) — the shape of frontend/src/demo/types.ts.

Field names serialise in camelCase (``departmentId``, ``ownerIds``) so the frontend
can swap its hard-coded demo org for this response without a mapping layer. Routes
use ``response_model_exclude_none`` so optional fields are absent, not null, exactly
as the TypeScript optional properties expect.
"""

import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.enums import BrainItemKind, BrainItemStatus

Role = Literal["owner", "admin", "member"]
ScopeLevel = Literal["org", "department", "team", "member"]


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class GraphPerson(_Camel):
    id: str
    name: str
    title: str
    role: Role
    department_id: str | None = None
    team_id: str | None = None
    initials: str
    is_lead: bool | None = None
    email: str | None = None


class GraphDepartment(_Camel):
    id: str
    name: str
    #: "" when the department has no head — the contract types it as a string.
    head_id: str
    team_ids: list[str]
    hue: int
    description: str | None = None


class GraphTeam(_Camel):
    id: str
    name: str
    department_id: str
    lead_id: str
    member_ids: list[str]


class GraphItem(_Camel):
    id: str
    kind: BrainItemKind
    title: str
    owner_ids: list[str]
    team_id: str | None = None
    department_id: str | None = None
    source: str | None = None
    date: str | None = None
    summary: str | None = None
    status: BrainItemStatus | None = None
    related_ids: list[str] | None = None
    external: bool | None = None


class GraphRead(_Camel):
    departments: list[GraphDepartment]
    teams: list[GraphTeam]
    people: list[GraphPerson]
    items: list[GraphItem]


# --- writes (Owner) ----------------------------------------------------------------


class BrainItemCreate(BaseModel):
    """A project, client, document, decision or thread. Tasks and meetings have their
    own APIs and appear in the graph automatically."""

    kind: Literal["project", "client", "document", "decision", "thread"]
    title: str = Field(min_length=1, max_length=500)
    summary: str | None = Field(default=None, max_length=5000)
    status: BrainItemStatus | None = None
    source: str | None = Field(default=None, max_length=64)
    external_ref: str | None = Field(default=None, max_length=255)
    occurred_on: date | None = None
    external: bool = False
    department_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    owner_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    #: Node ids — another item's id, ``task:<uuid>`` or ``meeting:<uuid>``.
    related_ids: list[str] = Field(default_factory=list, max_length=200)


class BrainItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    summary: str | None = Field(default=None, max_length=5000)
    status: BrainItemStatus | None = None
    occurred_on: date | None = None
    external: bool | None = None
    department_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    owner_ids: list[uuid.UUID] | None = Field(default=None, max_length=100)
    related_ids: list[str] | None = Field(default=None, max_length=200)


# --- retrieval ---------------------------------------------------------------------


class RetrievedFact(_Camel):
    statement: str
    said_by: str | None = None
    quote: str | None = None
    occurred_at: str | None = None
    source_ref: str | None = None
    #: The graph nodes this fact was traced to — what made it visible to the caller.
    node_ids: list[str] = []


class RetrievalRead(_Camel):
    query: str
    #: False when vector memory could not be searched; items still come from the graph.
    vector_available: bool
    facts: list[RetrievedFact]
    items: list[GraphItem]
    people: list[GraphPerson]
