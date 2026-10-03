"""Business search for chat (#20) — hybrid retrieval, pinned to the caller's reach.

The visibility is resolved once when the agent is built and closed over, so nothing
the model passes can widen it: a Member's agent searches a Member's graph.
"""

import time
import uuid
from typing import Any, Callable

from langchain_core.tools import tool

from app.agentic_ai.audit import record_audit
from app.core.visibility import Visibility
from app.database import SessionLocal
from app.models.company import Company
from app.services.hybrid_retrieval import HybridRetriever, describe


def create_graph_tools(company_id: uuid.UUID, visibility: Visibility) -> list[Callable]:
    @tool
    def search_business(query: str, limit: int = 8) -> dict[str, Any]:
        """Search everything the user is allowed to see — projects, clients, meetings, decisions, documents, tasks, and recorded facts — and the people connected to them. Use for "what's blocking X", "what's the latest with client Y", "what is Hira working on", "what did we decide about Z". Cite the item titles and fact sources in your answer. Results are already limited to what this user may see; never claim to know about anything not returned."""
        started = time.monotonic()
        try:
            with SessionLocal() as session:
                company = session.get(Company, company_id)
                if company is None:
                    return {"error": "Company not found."}
                result = HybridRetriever(session, company, visibility).search(query, limit=max(1, min(limit, 20)))
                payload = describe(result)
            duration = int((time.monotonic() - started) * 1000)
            record_audit(None, company_id, "sentinel", "search_business",
                         {"query": query, "viewer_role": visibility.role.value},
                         {"items": len(payload["items"]), "facts": len(payload["facts"])},
                         "success", duration_ms=duration)
            return payload
        except Exception as e:
            duration = int((time.monotonic() - started) * 1000)
            record_audit(None, company_id, "sentinel", "search_business", {"query": query}, None,
                         "failure", str(e), duration)
            return {"error": "Business search failed. Answer from task tools only, and say so."}

    return [search_business]
