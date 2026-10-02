"""Hybrid retrieval for chat (#20): vector similarity, graph expansion, visibility.

    1. Seed   — HydraDB recall (semantic + temporal) over-fetched, merged with a
                keyword match over the graph, so an outage or an unconfigured
                knowledge layer degrades the answer instead of emptying it
    2. Trace  — map every recalled fact back to graph nodes through its source_ref
                ("item:<id>" for a mirrored brain item, "Meeting: <title>" for a
                transcript fact)
    3. Expand — one hop out through related ids and owners
                (people ↔ clients ↔ meetings ↔ decisions)
    4. Filter — everything is drawn from the viewer's own graph snapshot, so it is
                already narrowed to what they may see. A fact that cannot be traced
                to a visible node is dropped for anyone but an Owner — fail closed

The single seam for swapping the vector source (e.g. to pgvector) is ``_recall``.
"""

import logging
import re
import uuid

from sqlalchemy.orm import Session

from app.core.visibility import Visibility
from app.knowledge.store import KnowledgeUnavailable, RecalledFact, get_knowledge_store
from app.models.company import Company
from app.schemas.graph import GraphItem, RetrievalRead, RetrievedFact
from app.services.graph_service import (
    ITEM_SOURCE_PREFIX,
    MEETING_PREFIX,
    MEETING_SOURCE_PREFIX,
    GraphService,
    Snapshot,
)

logger = logging.getLogger(__name__)

#: Recall is filtered after the fact, so ask for more than we keep.
OVERFETCH = 3
#: A vector hit outranks any number of keyword hits on the same node.
VECTOR_WEIGHT = 2.0
#: Neighbours inherit a share of the score of the node that pulled them in.
NEIGHBOUR_DECAY = 0.5

_STOPWORDS = frozenset(
    "the and for with what who whom whose which when where why how are was were is "
    "has have had did does our your their this that these those about from into any "
    "all can could should would will tell show give me us we you they them it its "
    "kya hai hain ka ki ke ko se aur".split()
)


def _terms(query: str) -> list[str]:
    words = re.findall(r"[\w']+", query.lower())
    return [w for w in dict.fromkeys(words) if len(w) >= 3 and w not in _STOPWORDS]


class HybridRetriever:
    def __init__(self, db: Session, company: Company, visibility: Visibility) -> None:
        self.company = company
        self.viewer = visibility
        self.graph = GraphService(db, company.id, visibility)

    def search(self, query: str, *, limit: int = 8) -> RetrievalRead:
        snap = self.graph.snapshot()
        scores: dict[str, float] = {}

        recalled, vector_available = self._recall(query, limit * OVERFETCH)
        facts: list[RetrievedFact] = []
        meetings_by_title = _meetings_by_title(snap)
        for rank, fact in enumerate(recalled):
            nodes = self._trace(fact.source_ref, snap, meetings_by_title)
            if not nodes and not self.viewer.sees_all:
                continue  # can't show it was about anything this viewer may see
            if len(facts) < limit:
                facts.append(RetrievedFact(
                    statement=fact.statement, said_by=fact.speaker, quote=fact.source_quote,
                    occurred_at=fact.occurred_at, source_ref=fact.source_ref, node_ids=nodes,
                ))
            for node in nodes:
                scores[node] = scores.get(node, 0.0) + VECTOR_WEIGHT * (1 - rank / max(len(recalled), 1))

        terms = _terms(query)
        if terms:
            for item in snap.items.values():
                haystack = f"{item.title} {item.summary or ''}".lower()
                hits = sum(1 for t in terms if t in haystack)
                if hits:
                    scores[item.id] = scores.get(item.id, 0.0) + hits / len(terms)
            # "What is Hira working on" — a person named in the question seeds their items.
            named = {p.id for p in snap.people.values() if set(terms) & set(p.name.lower().split())}
            for item in snap.items.values():
                if named.intersection(item.owner_ids):
                    scores[item.id] = scores.get(item.id, 0.0) + 0.5

        seeds = sorted(scores, key=lambda n: scores[n], reverse=True)[:limit]
        ranked = dict.fromkeys(seeds)
        for seed in seeds:
            for neighbour in snap.items[seed].related_ids or []:
                if neighbour not in ranked and neighbour in snap.items:
                    scores[neighbour] = max(scores.get(neighbour, 0.0), scores[seed] * NEIGHBOUR_DECAY)
                    ranked[neighbour] = None
        ordered = sorted(ranked, key=lambda n: scores.get(n, 0.0), reverse=True)[: limit * 2]

        items = [snap.items[n] for n in ordered]
        owner_ids = dict.fromkeys(o for i in items for o in i.owner_ids)
        people = [snap.people[o] for o in owner_ids if o in snap.people]
        return RetrievalRead(query=query, vector_available=vector_available, facts=facts,
                             items=items, people=people)

    # --- seams -----------------------------------------------------------------

    def _recall(self, query: str, limit: int) -> tuple[list[RecalledFact], bool]:
        store = get_knowledge_store()
        if store is None or not self.company.hydra_tenant_id:
            return [], False
        try:
            return store.recall(database=self.company.hydra_tenant_id, query=query, limit=limit), True
        except KnowledgeUnavailable:
            return [], False

    @staticmethod
    def _trace(source_ref: str | None, snap: Snapshot, meetings_by_title: dict[str, list[str]]) -> list[str]:
        """Which visible graph nodes a fact is about. Empty means "none we can show"."""
        if not source_ref:
            return []
        if source_ref.startswith(ITEM_SOURCE_PREFIX):
            try:
                node = str(uuid.UUID(source_ref[len(ITEM_SOURCE_PREFIX):]))
            except ValueError:
                return []
            return [node] if node in snap.items else []
        if source_ref.startswith(MEETING_SOURCE_PREFIX):
            # Transcript facts cite a meeting only by title. If two meetings share it
            # (one possibly out of reach), the fact can't be pinned to the visible one
            # — attributing it would leak another team's meeting (#29 review).
            title = source_ref[len(MEETING_SOURCE_PREFIX):]
            if title in snap.ambiguous_meeting_titles:
                return []
            return meetings_by_title.get(title, [])
        return []


def _meetings_by_title(snap: Snapshot) -> dict[str, list[str]]:
    grouped: dict[str, list[str]] = {}
    for item in snap.items.values():
        if item.id.startswith(MEETING_PREFIX):
            grouped.setdefault(item.title, []).append(item.id)
    return grouped


def describe(result: RetrievalRead) -> dict:
    """A compact, citation-carrying shape for an agent tool response (Rule 4)."""
    names = {p.id: p.name for p in result.people}
    titles = {i.id: i.title for i in result.items}

    def item(i: GraphItem) -> dict:
        return {k: v for k, v in {
            "id": i.id, "kind": i.kind.value, "title": i.title,
            "status": i.status.value if i.status else None, "date": i.date,
            "owners": [names.get(o, o) for o in i.owner_ids],
            "summary": i.summary,
            "related": [titles[r] for r in (i.related_ids or []) if r in titles],
            "external": i.external,
        }.items() if v not in (None, [], "")}

    return {
        "kind": "business_context",
        "vector_memory": "searched" if result.vector_available else "unavailable — answer from the graph only and say so",
        "facts": [f.model_dump(exclude_none=True, exclude={"node_ids"}) for f in result.facts],
        "items": [item(i) for i in result.items],
        "people": [{"name": p.name, "title": p.title} for p in result.people],
    }
