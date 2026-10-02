"""Verification: the graph API and hybrid retrieval (#20).

Proves over HTTP that ``GET /api/v1/graph`` returns the frontend contract's shape,
that scopes follow canViewScope (Owner anything, Admin what they manage, Member
themselves), that items, owners and related ids never leak across that line, and
that hybrid search and the chat tool are bound by the same visibility.

HydraDB is not required: with no knowledge store configured, retrieval runs on the
graph alone (``vectorAvailable: false``), which is also the outage path.

    python -m scripts.verify_graph
"""

import sys
import uuid
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.security import create_access_token, hash_password
from app.core.visibility import resolve_visibility
from app.database import SessionLocal
from app.main import app
from app.models import (
    AdminAssignment,
    BrainItem,
    BrainItemKind,
    BrainItemOwner,
    BrainItemStatus,
    BrainLink,
    Company,
    Department,
    Employee,
    Meeting,
    MeetingStatus,
    Task,
    TaskStatus,
    Team,
    TeamMembership,
    TranscriptSegment,
    User,
    UserRole,
)
from app.repositories.brain import ordered_pair

FAILURES: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}{f'  — {detail}' if detail and not condition else ''}")
    if not condition:
        FAILURES.append(label)


def main() -> int:  # noqa: C901 - a linear script of assertions
    db = SessionLocal()
    client = TestClient(app)
    tag = uuid.uuid4().hex[:8]
    company = Company(name=f"graph-verify-{tag}")
    other = Company(name=f"graph-other-{tag}")
    db.add_all([company, other])
    db.flush()
    cid, other_id = company.id, other.id

    try:
        eng = Department(company_id=cid, name="Engineering", hue=205)
        sales = Department(company_id=cid, name="Sales")
        db.add_all([eng, sales])
        db.flush()
        platform = Team(company_id=cid, name="Platform", department_id=eng.id)
        mobile = Team(company_id=cid, name="Mobile", department_id=eng.id)
        deals = Team(company_id=cid, name="Deals", department_id=sales.id)
        db.add_all([platform, mobile, deals])
        db.flush()

        def emp(name: str, dept: Department) -> Employee:
            e = Employee(company_id=cid, name=name, department_id=dept.id, role_title="Engineer")
            db.add(e)
            db.flush()
            return e

        saim, usman, alyan, hira, mark, lisa = (emp(n, d) for n, d in (
            ("Saim", eng), ("Usman Tariq", eng), ("Alyan", eng), ("Hira Javed", eng),
            ("Mark", sales), ("Lisa", sales)))
        for team, people in ((platform, [usman]), (mobile, [alyan, hira]), (deals, [mark])):
            for p in people:
                db.add(TeamMembership(company_id=cid, team_id=team.id, employee_id=p.id))
        mobile.lead_employee_id = hira.id
        eng.head_employee_id = saim.id

        def user(role: UserRole, e: Employee | None, label: str) -> User:
            u = User(company_id=cid, email=f"{label}-{tag}@example.com", password_hash=hash_password("x" * 12),
                     role=role, employee_id=e.id if e else None)
            db.add(u)
            db.flush()
            return u

        owner = user(UserRole.OWNER, None, "owner")
        saim_u = user(UserRole.ADMIN, saim, "saim")
        lisa_u = user(UserRole.ADMIN, lisa, "lisa")
        alyan_u = user(UserRole.MEMBER, alyan, "alyan")
        mark_u = user(UserRole.MEMBER, mark, "mark")
        db.add_all([
            AdminAssignment(company_id=cid, user_id=saim_u.id, department_id=eng.id),
            AdminAssignment(company_id=cid, user_id=lisa_u.id, team_id=mobile.id),
        ])

        def item(kind: BrainItemKind, title: str, owners: list[Employee], **kw) -> BrainItem:
            i = BrainItem(company_id=cid, kind=kind, title=title, **kw)
            db.add(i)
            db.flush()
            for o in owners:
                db.add(BrainItemOwner(company_id=cid, item_id=i.id, employee_id=o.id))
            return i

        kestrel = item(BrainItemKind.CLIENT, "Kestrel Health", [alyan], summary="App v2 launch slipping to Oct 20",
                       status=BrainItemStatus.AT_RISK, external=True, occurred_on=date(2026, 10, 1))
        migration = item(BrainItemKind.PROJECT, "AWS Bahrain migration", [], department_id=eng.id)
        indus = item(BrainItemKind.DECISION, "Indus Freight discount capped at 5%", [mark])
        cross_filed = item(BrainItemKind.MEETING, "Kestrel pricing call", [alyan], department_id=sales.id)
        sdk_task = Task(company_id=cid, title="Certify payment SDK for Kestrel", status=TaskStatus.BLOCKED,
                        owner_employee_id=alyan.id, idempotency_key=f"g-{tag}-1",
                        source_ref="Meeting: Mobile Standup")
        usman_task = Task(company_id=cid, title="Usman cuts over DNS", status=TaskStatus.IN_PROGRESS,
                          owner_employee_id=usman.id, idempotency_key=f"g-{tag}-2")
        db.add_all([sdk_task, usman_task])
        db.flush()
        standup = Meeting(company_id=cid, title="Mobile Standup", status=MeetingStatus.COMPLETED, raw_transcript="...")
        db.add(standup)
        db.flush()
        for speaker in (alyan, usman):
            db.add(TranscriptSegment(company_id=cid, meeting_id=standup.id, text="...", speaker_employee_id=speaker.id))
        for a, b in ((str(kestrel.id), f"task:{sdk_task.id}"), (str(kestrel.id), str(indus.id))):
            s, t = ordered_pair(a, b)
            db.add(BrainLink(company_id=cid, source_ref=s, target_ref=t))
        db.commit()

        def auth(u: User) -> dict[str, str]:
            return {"Authorization": f"Bearer {create_access_token(user_id=u.id, company_id=cid, role=u.role)}"}

        oh, sh, lh, ah, mh = auth(owner), auth(saim_u), auth(lisa_u), auth(alyan_u), auth(mark_u)
        G = "/api/v1/graph"
        task_node, meeting_node = f"task:{sdk_task.id}", f"meeting:{standup.id}"

        def get(h, **params):
            return client.get(G, headers=h, params=params)

        def item_ids(r) -> set[str]:
            return {i["id"] for i in r.json()["items"]} if r.status_code == 200 else set()

        # --- shape --------------------------------------------------------------------
        print("\n1. Owner, org level — the frontend contract's shape")
        r = get(oh)
        body = r.json()
        check("200 with exactly departments, teams, people, items",
              r.status_code == 200 and set(body) == {"departments", "teams", "people", "items"}, r.text[:200])
        dept = next((d for d in body.get("departments", []) if d["id"] == str(eng.id)), {})
        check("departments are camelCase with headId, teamIds and hue",
              dept.get("headId") == str(saim.id) and set(dept.get("teamIds", [])) == {str(platform.id), str(mobile.id)}
              and dept.get("hue") == 205, dept)
        sales_dept = next((d for d in body.get("departments", []) if d["id"] == str(sales.id)), {})
        check("a department without a head or hue still fills both", sales_dept.get("headId") == "" and
              isinstance(sales_dept.get("hue"), int), sales_dept)
        person = next((p for p in body.get("people", []) if p["id"] == str(hira.id)), {})
        check("people carry role, departmentId, teamId, initials, isLead",
              person.get("role") == "member" and person.get("departmentId") == str(eng.id)
              and person.get("teamId") == str(mobile.id) and person.get("initials") == "HJ"
              and person.get("isLead") is True, person)
        check("optional fields are omitted, not null", all(None not in p.values() for p in body.get("people", [])))
        ids = item_ids(r)
        check("items include brain items, live tasks and meetings",
              {str(kestrel.id), str(indus.id), str(migration.id), task_node, meeting_node} <= ids, ids)
        k = next(i for i in body["items"] if i["id"] == str(kestrel.id))
        check("an item carries ownerIds, relatedIds, status, external, date, placement",
              k["ownerIds"] == [str(alyan.id)] and set(k["relatedIds"]) == {task_node, str(indus.id)}
              and k["status"] == "at_risk" and k["external"] is True and k["date"] == "2026-10-01"
              and k["departmentId"] == str(eng.id) and k["teamId"] == str(mobile.id), k)
        t = next(i for i in body["items"] if i["id"] == task_node)
        check("a task is projected live, linked to its meeting",
              t["kind"] == "task" and t["status"] == "blocked" and meeting_node in t["relatedIds"], t)

        # --- Admin over a department ------------------------------------------------------
        print("\n2. Department Admin (Saim)")
        check("org level is 404", get(sh).status_code == 404)
        check("another department is 404", get(sh, level="department", id=str(sales.id)).status_code == 404)
        r = get(sh, level="department", id=str(eng.id))
        ids = item_ids(r)
        check("their department returns", r.status_code == 200, r.text[:200])
        check("…its items, including one filed under it with no owner",
              {str(kestrel.id), str(migration.id), task_node} <= ids, ids)
        check("…but not Sales' decision", str(indus.id) not in ids)
        # Filed under Sales, but an Engineering person is part of it: an Admin sees their
        # people's work wherever it is filed (visibility.ts itemsInScope, #32 review).
        check("…plus Sales-filed work an engineer owns", str(cross_filed.id) in ids, ids)
        check("…and Kestrel's link to it is dropped",
              str(indus.id) not in next(i for i in r.json()["items"] if i["id"] == str(kestrel.id))["relatedIds"])
        check("…people are Engineering only",
              {p["id"] for p in r.json()["people"]} == {str(e.id) for e in (saim, usman, alyan, hira)})

        # --- Admin over a team --------------------------------------------------------------
        print("\n3. Team Admin (Lisa, Mobile only)")
        check("their team returns", get(lh, level="team", id=str(mobile.id)).status_code == 200)
        check("a sibling team is 404", get(lh, level="team", id=str(platform.id)).status_code == 404)
        check("the whole department is 404", get(lh, level="department", id=str(eng.id)).status_code == 404)
        ids = item_ids(get(lh, level="team", id=str(mobile.id)))
        check("Platform's task is absent", f"task:{usman_task.id}" not in ids, ids)

        # --- Member ---------------------------------------------------------------------------
        print("\n4. Member (Alyan) sees themselves")
        check("org level is 404", get(ah).status_code == 404)
        check("their team is 404", get(ah, level="team", id=str(mobile.id)).status_code == 404)
        check("a squad-mate is 404", get(ah, level="member", id=str(hira.id)).status_code == 404)
        r = get(ah, level="member", id=str(alyan.id))
        ids = item_ids(r)
        check("their own scope returns their items", r.status_code == 200 and
              {str(kestrel.id), task_node, meeting_node} <= ids, ids)
        check("nobody else's items", not ids & {str(indus.id), str(migration.id), f"task:{usman_task.id}"}, ids)
        m = next((i for i in r.json()["items"] if i["id"] == meeting_node), {})
        check("a shared meeting lists only owners they can see", m.get("ownerIds") == [str(alyan.id)], m)
        check("people is just them", [p["id"] for p in r.json()["people"]] == [str(alyan.id)])
        check("an unknown id is 404 like a forbidden one",
              get(ah, level="member", id=str(uuid.uuid4())).status_code == 404)

        # --- hybrid search --------------------------------------------------------------------
        print("\n5. Hybrid search obeys the same visibility")
        r = client.get(f"{G}/search", headers=ah, params={"q": "Kestrel launch"})
        found = {i["id"] for i in r.json().get("items", [])}
        check("finds the client by keyword", r.status_code == 200 and str(kestrel.id) in found, r.text[:300])
        check("expands to the linked task", task_node in found, found)
        check("does not expand into a decision they can't see", str(indus.id) not in found, found)
        check("reports whether vector memory was searched", "vectorAvailable" in r.json())
        r = client.get(f"{G}/search", headers=ah, params={"q": "Indus Freight discount"})
        check("another department's decision is never returned",
              str(indus.id) not in {i["id"] for i in r.json().get("items", [])}, r.text[:300])
        r = client.get(f"{G}/search", headers=oh, params={"q": "Indus Freight discount"})
        check("…while the Owner finds it", str(indus.id) in {i["id"] for i in r.json().get("items", [])})
        r = client.get(f"{G}/search", headers=sh, params={"q": "what is Hira working on"})
        check("a named teammate seeds their work for their Admin", r.status_code == 200, r.text[:200])

        # Transcript facts cite meetings by title only (#29 review). A shared title
        # must not attribute a fact to the visible meeting of that name.
        from app.services.graph_service import Snapshot
        from app.services.hybrid_retrieval import HybridRetriever

        shared = Snapshot(ambiguous_meeting_titles=frozenset({"Weekly Standup"}))
        check("a fact citing a title two meetings share is pinned to neither",
              HybridRetriever._trace("Meeting: Weekly Standup", shared, {"Weekly Standup": ["meeting:x"]}) == [])
        check("…while a unique title still traces",
              HybridRetriever._trace("Meeting: Mobile Standup", shared, {"Mobile Standup": ["meeting:y"]})
              == ["meeting:y"])

        from app.agentic_ai.tools.graph_tools import create_graph_tools

        db.expire_all()
        (tool,) = create_graph_tools(cid, resolve_visibility(db, db.get(User, mark_u.id)))
        out = tool.invoke({"query": "Kestrel launch"})
        check("the chat tool, pinned to a Sales Member, cannot see Kestrel",
              all(i["title"] != "Kestrel Health" for i in out.get("items", [])), out)

        # --- writes ----------------------------------------------------------------------------
        print("\n6. Writes")
        new = {"kind": "project", "title": "Lumen Pay security questionnaire", "owner_ids": [str(mark.id)],
               "related_ids": [str(indus.id)], "source": "notion", "external_ref": f"n-{tag}"}
        check("a Member cannot add items", client.post(f"{G}/items", headers=ah, json=new).status_code == 403)
        check("an Admin cannot add items", client.post(f"{G}/items", headers=sh, json=new).status_code == 403)
        r = client.post(f"{G}/items", headers=oh, json=new)
        created = r.json()
        check("the Owner can", r.status_code == 201 and created.get("relatedIds") == [str(indus.id)], r.text[:300])
        r2 = client.post(f"{G}/items", headers=oh, json={**new, "title": "Lumen Pay questionnaire (v2)"})
        check("the same source + external_ref updates instead of duplicating",
              r2.json().get("id") == created.get("id") and r2.json().get("title").endswith("(v2)"), r2.text[:300])
        foreign = Employee(company_id=other_id, name="Outsider")
        db.add(foreign)
        db.commit()
        r = client.post(f"{G}/items", headers=oh, json={**new, "external_ref": f"x-{tag}", "owner_ids": [str(foreign.id)]})
        check("an owner from another company is refused", r.status_code == 400, r.status_code)
        r = client.post(f"{G}/items", headers=oh, json={**new, "external_ref": f"y-{tag}", "related_ids": [f"task:{uuid.uuid4()}"]})
        check("a related id that doesn't exist is refused", r.status_code == 400, r.status_code)
        check("delete works", client.delete(f"{G}/items/{created['id']}", headers=oh).status_code == 204)
        check("…and the item is gone from the graph", created["id"] not in item_ids(get(oh)))

    finally:
        db.rollback()
        for company_id in (cid, other_id):
            db.execute(text("DELETE FROM companies WHERE id = :id"), {"id": company_id})
        db.commit()
        db.close()

    print(f"\n{'All graph checks passed.' if not FAILURES else f'{len(FAILURES)} failed: {FAILURES}'}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
