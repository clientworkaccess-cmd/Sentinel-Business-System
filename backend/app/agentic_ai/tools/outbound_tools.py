"""Outbound drafting tool — the agent can write a message, never send one (#19).

The tool only drafts. Whether the draft is internal or external, and whether it may
go out without a human, is decided by OutboundGate — not by anything the model says.
"""

import time
import uuid
from typing import Any, Callable

from langchain_core.tools import tool

from app.agentic_ai.audit import record_audit
from app.database import SessionLocal
from app.models.enums import MessageChannel, OutboundStatus
from app.repositories.employee import EmployeeRepository
from app.services.outbound_gate import OutboundGate


def create_outbound_tools(company_id: uuid.UUID, agent: str = "sentinel") -> list[Callable]:
    """Drafting tools, pinned to one company."""

    @tool
    def draft_message(
        channel: str,
        body: str,
        subject: str | None = None,
        teammate_name: str | None = None,
        external_address: str | None = None,
        external_name: str | None = None,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        """Draft a message for the owner to approve. channel is one of email, whatsapp, slack, slack_connect, in_app. Address a teammate by teammate_name, or anyone outside the company by external_address (email, phone or channel id). Messages to people outside the company always wait for the owner's approval; you cannot send them."""
        start_time = time.monotonic()
        try:
            with SessionLocal() as session:
                employee_id = None
                if teammate_name:
                    matches = EmployeeRepository(session, company_id).search_by_name(teammate_name)
                    if not matches:
                        return {"error": f"No employee matching {teammate_name!r}."}
                    if len(matches) > 1:
                        names = ", ".join(m.name for m in matches)
                        return {"error": f"{teammate_name!r} is ambiguous — matches: {names}. Ask which one."}
                    employee_id = matches[0].id

                gate = OutboundGate(session, company_id)
                message, _ = gate.draft(
                    channel=MessageChannel(channel),
                    body=body,
                    subject=subject,
                    recipient_employee_id=employee_id,
                    recipient_address=external_address,
                    recipient_name=external_name,
                    task_id=uuid.UUID(task_id) if task_id else None,
                    drafted_by_agent=agent,
                )
                session.commit()
                if message.status is OutboundStatus.APPROVED:
                    # Only reachable for an internal message under company policy.
                    message = gate.dispatch(message.id)
                    session.commit()
                result = {
                    "kind": "outbound_draft",
                    "message_id": str(message.id),
                    "audience": message.audience.value,
                    "status": message.status.value,
                    "recipient": message.recipient_name or message.recipient_address,
                    "awaiting_approval": message.status is OutboundStatus.PENDING_APPROVAL,
                }
            duration = int((time.monotonic() - start_time) * 1000)
            record_audit(None, company_id, agent, "draft_message",
                         {"channel": channel, "teammate_name": teammate_name, "has_external_address": bool(external_address)},
                         {k: result[k] for k in ("message_id", "audience", "status")}, "success", duration_ms=duration)
            return result
        except Exception as e:
            duration = int((time.monotonic() - start_time) * 1000)
            record_audit(None, company_id, agent, "draft_message", {"channel": channel}, None, "failure", str(e), duration)
            return {"error": getattr(e, "message", str(e))}

    return [draft_message]
