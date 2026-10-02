"""Sentinel Agent Factory (One function builds every Sentinel)."""

import uuid
from datetime import date
from typing import Literal

from langgraph.prebuilt import create_react_agent
from sqlalchemy.orm import Session

from app.agentic_ai.checkpointer import get_checkpointer
from app.agentic_ai.config import get_llm
from app.agentic_ai.prompts import (
    render_employee_chat_prompt,
    render_extractor_prompt,
    render_founder_chat_prompt,
)
from app.agentic_ai.tools import (
    create_knowledge_read_tools,
    create_knowledge_write_tools,
    create_employee_task_tools,
    create_employee_tools,
    create_extractor_task_tools,
    create_founder_task_tools,
    create_graph_tools,
    create_outbound_tools,
)
from app.core.visibility import Visibility, resolve_visibility
from app.models.company import Company
from app.models.enums import UserRole
from app.models.user import User


def _visibility(db: Session | None, actor: User) -> Visibility:
    """The actor's reach, for tools that read across people. Needs the request session."""
    if db is None:
        raise ValueError("Chat tools need a database session to resolve visibility.")
    return resolve_visibility(db, actor)


def _tools_for(
    db: Session | None,
    company: Company,
    actor: User | None,
    entry: Literal["chat", "transcript"],
    source_ref: str | None = None,
    meeting_title: str | None = None,
    occurred_on: date | None = None,
    meeting_id: uuid.UUID | None = None,
) -> list:
    """Determine the strict tool set based on actor role and entry point."""
    if entry == "chat":
        if not actor:
            raise ValueError("Chat entry requires an authenticated user actor.")
        if actor.role is UserRole.OWNER:
            return (
                create_founder_task_tools(company.id, actor.id)
                + create_employee_tools(company.id)
                # Read-only: the founder queries settled history, never writes it.
                + create_knowledge_read_tools(company.id, company.hydra_tenant_id)
                # Drafts only. External messages wait for the Owner in the gate (#19).
                + create_outbound_tools(company.id)
                # Hybrid graph + vector search (#20). An Owner's reach is everything.
                + create_graph_tools(company.id, _visibility(db, actor))
            )
        elif actor.role in (UserRole.ADMIN, UserRole.MEMBER):
            # Task tools stay own-tasks-only. Team-wide answers come from search_business,
            # whose visibility is resolved here and pinned: an Admin's agent reads their
            # teams, a Member's reads themselves, and no argument can widen either.
            if not actor.employee_id:
                raise ValueError("Admin or member user has no linked employee_id.")
            return (
                create_employee_task_tools(company.id, actor.id, actor.employee_id)
                + create_graph_tools(company.id, _visibility(db, actor))
            )
        else:
            raise ValueError(f"Unknown user role: {actor.role}")

    elif entry == "transcript":
        raw_threshold = getattr(company, "auto_approve_threshold", None)
        threshold = float(raw_threshold) if raw_threshold is not None and raw_threshold > 0 else 1.0
        return (
            create_extractor_task_tools(
                company.id, threshold=threshold, source_ref=source_ref, meeting_id=meeting_id
            )
            + create_employee_tools(company.id)
            # A transcript yields commitments *and* knowledge. This is the only
            # entry point that writes to memory.
            + create_knowledge_write_tools(
                company.id,
                company.hydra_tenant_id,
                source_ref=source_ref,
                meeting_title=meeting_title,
                occurred_on=occurred_on,
            )
        )

    raise ValueError(f"Unknown entry point: {entry}")


def _prompt_for(
    company: Company,
    actor: User | None,
    entry: Literal["chat", "transcript"],
) -> str:
    """Render the modular on-demand system prompt."""
    if entry == "chat":
        if actor and actor.role in (UserRole.ADMIN, UserRole.MEMBER):
            return render_employee_chat_prompt(company, actor)
        elif actor:
            return render_founder_chat_prompt(company, actor)
        return render_founder_chat_prompt(company, actor)  # type: ignore

    elif entry == "transcript":
        return render_extractor_prompt(company)

    raise ValueError(f"Unknown entry point: {entry}")


def build_sentinel(
    db: Session,
    company: Company,
    *,
    actor: User | None = None,
    entry: Literal["chat", "transcript"] = "chat",
    source_ref: str | None = None,
    meeting_title: str | None = None,
    occurred_on: date | None = None,
    meeting_id: uuid.UUID | None = None,
):
    """Assemble Sentinel agent for one invocation with strict role-scoped tools."""
    tools = _tools_for(db, company, actor, entry, source_ref, meeting_title, occurred_on, meeting_id)
    prompt = _prompt_for(company, actor, entry)
    llm = get_llm()
    checkpointer = get_checkpointer()

    return create_react_agent(
        model=llm,
        tools=tools,
        prompt=prompt,
        checkpointer=checkpointer if entry == "chat" else None,
    )
