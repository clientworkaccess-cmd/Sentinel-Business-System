"""Verification: the outbound approval gate (#19).

Proves over HTTP and against the database that:

* every draft is born pending_approval, and audience is the server's call
* an external message reaches a connector only after an Owner approves it — no
  policy, role, request field or direct row edit gets it out otherwise
* internal follow-ups auto-send only when the company turns that on
* approve / edit / reject each write an audit entry, and decisions are final
* a connector only ever receives a SendPermit, which nothing else can mint

Registers fake senders, creates throwaway companies, and removes both.

    python -m scripts.verify_outbound
"""

import sys
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.security import create_access_token, hash_password
from app.database import SessionLocal
from app.main import app
from app.models import (
    AuditLog,
    Company,
    Employee,
    MessageAudience,
    MessageChannel,
    OutboundMessage,
    OutboundStatus,
    User,
    UserRole,
)
from app.services import outbound_gate
from app.services.outbound_gate import SendPermit, SendResult

FAILURES: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}{f'  — {detail}' if detail and not condition else ''}")
    if not condition:
        FAILURES.append(label)


class FakeSender:
    def __init__(self) -> None:
        self.sent: list[SendPermit] = []
        self.fail_next = False

    def send(self, permit: SendPermit) -> SendResult:
        if self.fail_next:
            self.fail_next = False
            raise RuntimeError("provider down")
        self.sent.append(permit)
        return SendResult(provider_message_id=f"fake-{len(self.sent)}")


def main() -> int:  # noqa: C901 - a linear script of assertions
    db = SessionLocal()
    client = TestClient(app)
    tag = uuid.uuid4().hex[:8]
    saved_senders = dict(outbound_gate._SENDERS)
    email, slack = FakeSender(), FakeSender()
    outbound_gate.register_sender(MessageChannel.EMAIL, email)
    outbound_gate.register_sender(MessageChannel.SLACK, slack)
    outbound_gate._SENDERS.pop(MessageChannel.SLACK_CONNECT, None)

    company = Company(name=f"gate-verify-{tag}")
    other = Company(name=f"gate-other-{tag}")
    db.add_all([company, other])
    db.flush()
    cid, other_id = company.id, other.id

    try:
        hira = Employee(company_id=cid, name="Hira", email=f"hira-{tag}@arcline.pk", slack_user_id=f"U{tag}")
        saim = Employee(company_id=cid, name="Saim", email=f"saim-{tag}@arcline.pk")
        db.add_all([hira, saim])
        db.flush()

        def user(c: uuid.UUID, role: UserRole, label: str, emp: Employee | None = None) -> User:
            u = User(company_id=c, email=f"{label}-{tag}@example.com", password_hash=hash_password("x" * 12),
                     role=role, employee_id=emp.id if emp else None)
            db.add(u)
            db.flush()
            return u

        owner = user(cid, UserRole.OWNER, "owner")
        admin = user(cid, UserRole.ADMIN, "admin", saim)
        member = user(cid, UserRole.MEMBER, "member", hira)
        stranger = user(other_id, UserRole.OWNER, "stranger")
        db.commit()

        def auth(u: User) -> dict[str, str]:
            return {"Authorization": f"Bearer {create_access_token(user_id=u.id, company_id=u.company_id, role=u.role)}"}

        oh, adh, mh, sh = auth(owner), auth(admin), auth(member), auth(stranger)
        base = "/api/v1/approvals/messages"
        client_email = {"channel": "email", "recipient_address": "cto@kestrel.example", "recipient_name": "Kestrel CTO",
                        "subject": "Revised timeline", "body": "Launch moves to Oct 20."}

        def audits(message_id: str) -> list[str]:
            db.expire_all()
            rows = db.query(AuditLog).filter(AuditLog.company_id == cid).all()
            return [r.tool for r in rows if (r.input or {}).get("message_id") == message_id]

        # --- drafting -----------------------------------------------------------------
        print("\n1. Drafts are born pending, and audience is the server's call")
        r = client.post(base, headers=oh, json=client_email)
        ext = r.json()
        check("external draft is 201 pending_approval", r.status_code == 201 and ext["status"] == "pending_approval", r.text[:200])
        check("…classified external", ext.get("audience") == "external")
        check("…and nothing was sent", email.sent == [])
        check("draft is audited", "outbound.draft" in audits(ext["id"]))

        r = client.post(base, headers=oh, json={**client_email, "audience": "internal"})
        check("a caller cannot declare a message internal", r.status_code == 400, r.status_code)
        r = client.post(base, headers=oh, json={**client_email, "status": "approved"})
        check("a caller cannot create it approved", r.status_code == 400, r.status_code)
        r = client.post(base, headers=oh, json={"channel": "whatsapp", "recipient_employee_id": str(hira.id), "body": "hi"})
        check("WhatsApp to a teammate id is refused (external-only channel)", r.status_code == 400, r.status_code)
        r = client.post(base, headers=oh, json={"channel": "email", "recipient_employee_id": str(hira.id),
                                                "recipient_address": "cto@kestrel.example", "body": "hi"})
        check("a teammate id paired with an outside address is refused", r.status_code == 400, r.status_code)

        r = client.post(base, headers=oh, json={"channel": "email", "recipient_employee_id": str(hira.id), "body": "Status on push?"})
        internal = r.json()
        check("internal draft takes the address from the employee record",
              r.status_code == 201 and internal["audience"] == "internal"
              and internal["recipient_address"] == hira.email, r.text[:200])
        check("…and still waits while the company policy is off", internal.get("status") == "pending_approval")

        r = client.post(base, headers={**oh, "Idempotency-Key": f"k-{tag}"}, json=client_email)
        r2 = client.post(base, headers={**oh, "Idempotency-Key": f"k-{tag}"}, json=client_email)
        check("a retried draft returns the original", r2.status_code == 200 and r2.json()["id"] == r.json()["id"])

        # --- who may decide -----------------------------------------------------------
        print("\n2. Only an Owner decides")
        check("a Member cannot draft", client.post(base, headers=mh, json=client_email).status_code == 403)
        check("an Admin can draft", client.post(base, headers=adh, json=client_email).status_code == 201)
        check("an Admin cannot approve", client.post(f"{base}/{ext['id']}/approve", headers=adh).status_code == 403)
        check("a Member cannot approve", client.post(f"{base}/{ext['id']}/approve", headers=mh).status_code == 403)
        check("another company cannot see it", client.get(f"{base}/{ext['id']}", headers=sh).status_code == 404)
        check("another company cannot approve it", client.post(f"{base}/{ext['id']}/approve", headers=sh).status_code == 404)
        check("still nothing sent", email.sent == [])

        # --- edit / approve / reject --------------------------------------------------
        print("\n3. Edit, approve, reject — each audited, each final")
        r = client.post(f"{base}/{ext['id']}/edit", headers=oh, json={"body": "Launch moves to Oct 20 — sorry."})
        edited = r.json()
        check("edit changes the wording and stays pending",
              r.status_code == 200 and edited["status"] == "pending_approval" and edited["body"].endswith("sorry."), r.text[:200])
        check("…keeping the AI's original", (edited.get("edited_payload") or {}).get("original", {}).get("body") == client_email["body"])
        check("…and is audited", "outbound.edit" in audits(ext["id"]))
        check("the recipient cannot be edited",
              client.post(f"{base}/{ext['id']}/edit", headers=oh, json={"recipient_address": "x@y.z"}).status_code == 400)

        r = client.post(f"{base}/{ext['id']}/approve", headers=oh)
        sent = r.json()
        check("approve sends it", r.status_code == 200 and sent["status"] == "sent", r.text[:200])
        check("…through the connector, once, with the edited body",
              len(email.sent) == 1 and email.sent[0].body.endswith("sorry."))
        check("…recording who approved", sent.get("decided_by_user_id") == str(owner.id) and sent.get("approved_via") == "human")
        trail = audits(ext["id"])
        check("approve and dispatch are audited", {"outbound.approve", "outbound.dispatch"} <= set(trail), trail)
        check("approving twice is 409", client.post(f"{base}/{ext['id']}/approve", headers=oh).status_code == 409)

        r = client.post(f"{base}/{internal['id']}/reject", headers=oh, json={"reason": "Asked her in person"})
        check("reject is final and sends nothing",
              r.status_code == 200 and r.json()["status"] == "rejected" and email.sent and len(email.sent) == 1, r.text[:200])
        check("…audited", "outbound.reject" in audits(internal["id"]))
        check("approving a rejected message is 409", client.post(f"{base}/{internal['id']}/approve", headers=oh).status_code == 409)

        # --- policy --------------------------------------------------------------------
        print("\n4. Company policy auto-sends internal follow-ups only")
        r = client.patch("/api/v1/company", headers=oh, json={"auto_send_internal_followups": True})
        check("owner turns the policy on", r.status_code == 200 and r.json().get("auto_send_internal_followups") is True, r.text[:200])
        r = client.post(base, headers=oh, json={"channel": "slack", "recipient_employee_id": str(hira.id), "body": "Push fix today?"})
        auto = r.json()
        check("an internal follow-up goes straight out", r.status_code == 201 and auto["status"] == "sent", r.text[:200])
        check("…marked as cleared by policy, with no human decider",
              auto.get("approved_via") == "policy" and auto.get("decided_by_user_id") is None)
        check("…to the teammate's Slack id", slack.sent and slack.sent[-1].recipient_address == hira.slack_user_id)
        r = client.post(base, headers=oh, json=client_email)
        check("an external message still waits with the policy on", r.json().get("status") == "pending_approval", r.text[:200])
        pending_ext_id = r.json()["id"]

        # --- the floor under the service -------------------------------------------------
        print("\n5. The database and the sender boundary hold even if the service is bypassed")
        row = db.get(OutboundMessage, uuid.UUID(pending_ext_id))
        row.status = OutboundStatus.APPROVED
        try:
            db.flush()
            check("DB refuses an approved external message with no human", False)
        except IntegrityError:
            check("DB refuses an approved external message with no human", True)
        db.rollback()

        try:
            SendPermit(object(), row)
            check("a SendPermit cannot be minted outside the gate", False)
        except RuntimeError:
            check("a SendPermit cannot be minted outside the gate", True)

        # --- delivery failures -------------------------------------------------------------
        print("\n6. Delivery failure and missing connectors")
        email.fail_next = True
        r = client.post(f"{base}/{pending_ext_id}/approve", headers=oh)
        check("a connector failure is recorded as failed, not raised",
              r.status_code == 200 and r.json()["status"] == "failed" and r.json()["delivery_error"], r.text[:200])
        r = client.post(f"{base}/{pending_ext_id}/retry", headers=oh)
        check("retry sends it without re-approving", r.status_code == 200 and r.json()["status"] == "sent", r.text[:200])
        r = client.post(base, headers=oh, json={"channel": "slack_connect", "recipient_address": "C0SHARED", "body": "hi"})
        sc = r.json()
        r = client.post(f"{base}/{sc['id']}/approve", headers=oh)
        check("with no connector, an approved message waits with a plain reason",
              r.json().get("status") == "approved" and "connector" in (r.json().get("delivery_error") or ""), r.text[:200])

        # --- the agent tool ---------------------------------------------------------------
        print("\n7. The chat agent can only draft")
        from app.agentic_ai.tools.outbound_tools import create_outbound_tools

        (draft_tool,) = create_outbound_tools(cid)
        before = len(email.sent)
        out = draft_tool.invoke({"channel": "email", "body": "Following up on INV-2291.",
                                 "external_address": "ap@indus.example"})
        check("an agent's external draft waits for approval",
              out.get("status") == "pending_approval" and out.get("audience") == MessageAudience.EXTERNAL.value, out)
        check("…and nothing was sent", len(email.sent) == before)

    finally:
        outbound_gate._SENDERS.clear()
        outbound_gate._SENDERS.update(saved_senders)
        db.rollback()
        for company_id in (cid, other_id):
            db.execute(text("DELETE FROM companies WHERE id = :id"), {"id": company_id})
        db.commit()
        db.close()

    print(f"\n{'All outbound gate checks passed.' if not FAILURES else f'{len(FAILURES)} failed: {FAILURES}'}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
