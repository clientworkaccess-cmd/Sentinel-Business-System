"""Verification: Owner / Admin / Member visibility at the API layer (#18).

Not a test suite — a runnable check, like the other scripts here. Builds one company
with two departments and three squads, then proves over HTTP that:

* a Member reads only their own tasks, meetings and employee record, and no knowledge
* an Admin reads inside the departments/teams assigned to them and nowhere else
* an Owner reads everything
* writes stay Owner-only, role changes end old sessions, and ids from another
  company are refused

Creates throwaway companies and deletes them.

    python -m scripts.verify_rbac
"""

import sys
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.security import create_access_token, hash_password
from app.database import SessionLocal
from app.main import app
from app.models import (
    AdminAssignment,
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

FAILURES: list[str] = []


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}{f'  — {detail}' if detail and not condition else ''}")
    if not condition:
        FAILURES.append(label)


def ids(response) -> set[str]:
    body = response.json()
    items = body["items"] if isinstance(body, dict) and "items" in body else body
    return {item["id"] for item in items}


def main() -> int:  # noqa: C901 - a linear script of assertions
    db = SessionLocal()
    client = TestClient(app)
    tag = uuid.uuid4().hex[:8]
    company = Company(name=f"rbac-verify-{tag}")
    other = Company(name=f"rbac-other-{tag}")
    db.add_all([company, other])
    db.flush()
    cid, other_id = company.id, other.id

    def employee(name: str, dept: Department | None = None) -> Employee:
        e = Employee(company_id=cid, name=name, department_id=dept.id if dept else None)
        db.add(e)
        db.flush()
        return e

    def user(role: UserRole, emp: Employee | None, label: str) -> User:
        u = User(company_id=cid, email=f"{label}-{tag}@example.com",
                 password_hash=hash_password("x" * 12), role=role,
                 employee_id=emp.id if emp else None)
        db.add(u)
        db.flush()
        return u

    def task(owner: Employee, title: str, source_ref: str | None = None) -> Task:
        t = Task(company_id=cid, title=title, status=TaskStatus.APPROVED,
                 owner_employee_id=owner.id, idempotency_key=f"rbac-{tag}-{title}",
                 source_ref=source_ref)
        db.add(t)
        db.flush()
        return t

    def meeting(title: str, speaker: Employee | None = None) -> Meeting:
        m = Meeting(company_id=cid, title=title, status=MeetingStatus.COMPLETED,
                    raw_transcript="...")
        db.add(m)
        db.flush()
        if speaker:
            db.add(TranscriptSegment(company_id=cid, meeting_id=m.id, text="hello",
                                     speaker_employee_id=speaker.id))
        return m

    try:
        # --- the org ----------------------------------------------------------------
        eng = Department(company_id=cid, name="Engineering")
        sales = Department(company_id=cid, name="Sales")
        db.add_all([eng, sales])
        db.flush()
        platform = Team(company_id=cid, name="Platform", department_id=eng.id)
        mobile = Team(company_id=cid, name="Mobile", department_id=eng.id)
        deals = Team(company_id=cid, name="Deals", department_id=sales.id)
        db.add_all([platform, mobile, deals])
        db.flush()

        saim = employee("Saim", eng)          # Admin over all of Engineering
        usman = employee("Usman", eng)        # Platform
        alyan = employee("Alyan", eng)        # Mobile — the Member under test
        hira = employee("Hira", eng)          # Mobile
        mark = employee("Mark", sales)        # Deals
        lisa = employee("Lisa", sales)        # Admin over the Mobile squad only
        for team, people in ((platform, [usman]), (mobile, [alyan, hira]), (deals, [mark])):
            for p in people:
                db.add(TeamMembership(company_id=cid, team_id=team.id, employee_id=p.id))
        eng.head_employee_id = saim.id

        owner = user(UserRole.OWNER, None, "owner")
        saim_u = user(UserRole.ADMIN, saim, "saim")
        lisa_u = user(UserRole.ADMIN, lisa, "lisa")
        alyan_u = user(UserRole.MEMBER, alyan, "alyan")
        db.add_all([
            AdminAssignment(company_id=cid, user_id=saim_u.id, department_id=eng.id),
            AdminAssignment(company_id=cid, user_id=lisa_u.id, team_id=mobile.id),
        ])

        t_alyan = task(alyan, "alyan ships mobile build")
        t_hira = task(hira, "hira fixes push")
        t_usman = task(usman, "usman migrates db")
        t_mark = task(mark, "mark renews indus", source_ref="Meeting: Sales Sync")
        task(saim, "saim hires backend")

        m_mobile = meeting("Mobile Standup", speaker=alyan)
        m_platform = meeting("Platform Standup", speaker=usman)
        m_sales = meeting("Sales Sync")  # linked only through Mark's task
        db.commit()

        def auth(u: User) -> dict[str, str]:
            tok = create_access_token(user_id=u.id, company_id=cid, role=u.role)
            return {"Authorization": f"Bearer {tok}"}

        oh, sh, lh, ah = auth(owner), auth(saim_u), auth(lisa_u), auth(alyan_u)

        # --- Member -----------------------------------------------------------------
        print("\n1. Member (Alyan) sees only themselves")
        r = client.get("/api/v1/tasks", headers=ah)
        check("lists only their own tasks", r.status_code == 200 and ids(r) == {str(t_alyan.id)}, r.text[:200])
        check("total counts only their own", r.json().get("total") == 1, r.json().get("total"))
        for label, t in (("a squad-mate's", t_hira), ("another team's", t_usman), ("another department's", t_mark)):
            r = client.get(f"/api/v1/tasks/{t.id}", headers=ah)
            check(f"{label} task is 404, not 403", r.status_code == 404, r.status_code)
        r = client.get("/api/v1/tasks", headers=ah, params={"owner_employee_id": str(hira.id)})
        check("filtering by someone else returns nothing", r.status_code == 200 and ids(r) == set(), r.text[:200])

        r = client.get("/api/v1/employees", headers=ah)
        check("employee list is just themselves", r.status_code == 200 and ids(r) == {str(alyan.id)}, r.text[:200])
        check("another member's record is 404", client.get(f"/api/v1/employees/{hira.id}", headers=ah).status_code == 404)
        check("another member's task list is 404",
              client.get(f"/api/v1/employees/{hira.id}/tasks", headers=ah).status_code == 404)

        r = client.get("/api/v1/meetings", headers=ah)
        check("sees only meetings they spoke in", r.status_code == 200 and ids(r) == {str(m_mobile.id)}, r.text[:200])
        for m in (m_platform, m_sales):
            check(f"'{m.title}' is 404", client.get(f"/api/v1/meetings/{m.id}", headers=ah).status_code == 404)

        check("knowledge graph is refused", client.get("/api/v1/knowledge/graph", headers=ah).status_code == 403)
        check("cannot create a task", client.post("/api/v1/tasks", headers=ah, json={"title": "x"}).status_code == 403)
        check("cannot edit someone's task",
              client.patch(f"/api/v1/tasks/{t_hira.id}", headers=ah, json={"title": "x"}).status_code == 403)
        check("cannot restructure the org",
              client.post("/api/v1/org/departments", headers=ah, json={"name": "Mine"}).status_code == 403)

        r = client.get("/api/v1/org/teams", headers=ah)
        teams = {t["id"]: t for t in r.json()} if r.status_code == 200 else {}
        check("sees their own squad as a label", set(teams) == {str(mobile.id)}, r.text[:200])
        check("…but not their squad-mates in it",
              teams.get(str(mobile.id), {}).get("member_ids") == [str(alyan.id)], teams)
        r = client.get("/api/v1/org/departments", headers=ah)
        check("sees only their own department", r.status_code == 200 and ids(r) == {str(eng.id)}, r.text[:200])

        # --- Admin over a department ------------------------------------------------
        print("\n2. Admin over Engineering (Saim) sees Engineering only")
        r = client.get("/api/v1/tasks", headers=sh)
        eng_tasks = {str(t.id) for t in (t_alyan, t_hira, t_usman)}
        check("sees every Engineering task", r.status_code == 200 and eng_tasks <= ids(r), r.text[:200])
        check("does not see Sales tasks", str(t_mark.id) not in ids(r))
        check("Sales task by id is 404", client.get(f"/api/v1/tasks/{t_mark.id}", headers=sh).status_code == 404)
        r = client.get("/api/v1/employees", headers=sh)
        check("roster is Engineering only", r.status_code == 200 and ids(r) == {str(e.id) for e in (saim, usman, alyan, hira)},
              r.text[:300])
        check("Sales member record is 404", client.get(f"/api/v1/employees/{mark.id}", headers=sh).status_code == 404)
        r = client.get("/api/v1/meetings", headers=sh)
        check("sees Engineering meetings, not Sales",
              r.status_code == 200 and ids(r) == {str(m_mobile.id), str(m_platform.id)}, r.text[:200])
        check("Sales meeting is 404", client.get(f"/api/v1/meetings/{m_sales.id}", headers=sh).status_code == 404)
        check("knowledge graph is refused", client.get("/api/v1/knowledge/graph", headers=sh).status_code == 403)
        r = client.get("/api/v1/org/teams", headers=sh)
        check("teams are Platform and Mobile", r.status_code == 200 and ids(r) == {str(platform.id), str(mobile.id)},
              r.text[:200])

        # --- Admin over one team ----------------------------------------------------
        print("\n3. Admin over the Mobile squad only (Lisa)")
        r = client.get("/api/v1/tasks", headers=lh)
        visible = ids(r) if r.status_code == 200 else set()
        check("sees Mobile tasks", {str(t_alyan.id), str(t_hira.id)} <= visible, visible)
        check("does not see Platform in the same department", str(t_usman.id) not in visible)
        check("Platform task by id is 404", client.get(f"/api/v1/tasks/{t_usman.id}", headers=lh).status_code == 404)
        check("does not see own department's other squads' people",
              client.get(f"/api/v1/employees/{usman.id}", headers=lh).status_code == 404)

        # --- Owner -------------------------------------------------------------------
        print("\n4. Owner sees everything")
        r = client.get("/api/v1/tasks", headers=oh)
        check("every task", r.status_code == 200 and r.json()["total"] == 5, r.json().get("total"))
        r = client.get("/api/v1/meetings", headers=oh)
        check("every meeting", r.status_code == 200 and len(ids(r)) == 3, r.text[:200])

        # --- Assignments and role changes -------------------------------------------
        print("\n5. Assignments, role changes, tenancy")
        foreign_dept = Department(company_id=other_id, name="Foreign")
        db.add(foreign_dept)
        db.commit()
        r = client.put(f"/api/v1/org/admins/{lisa_u.id}/assignments", headers=oh,
                       json={"department_ids": [str(foreign_dept.id)], "team_ids": []})
        check("another company's department cannot be assigned", r.status_code == 400, r.status_code)
        r = client.put(f"/api/v1/org/admins/{alyan_u.id}/assignments", headers=oh,
                       json={"department_ids": [str(eng.id)], "team_ids": []})
        check("a Member cannot be given teams", r.status_code == 400, r.status_code)
        r = client.put(f"/api/v1/org/admins/{lisa_u.id}/assignments", headers=oh,
                       json={"department_ids": [], "team_ids": [str(mobile.id), str(platform.id)]})
        check("owner can widen an Admin's reach", r.status_code == 200, r.text[:200])
        check("…and it applies on the next request",
              client.get(f"/api/v1/tasks/{t_usman.id}", headers=lh).status_code == 200)
        check("an Admin cannot change assignments",
              client.put(f"/api/v1/org/admins/{lisa_u.id}/assignments", headers=lh,
                         json={"department_ids": [str(sales.id)], "team_ids": []}).status_code == 403)

        r = client.patch(f"/api/v1/employees/{lisa.id}/login", headers=oh, json={"role": "member"})
        check("owner can demote an Admin", r.status_code == 200 and r.json()["role"] == "member", r.text[:200])
        check("the demoted Admin's old token stops working",
              client.get("/api/v1/tasks", headers=lh).status_code == 401)
        db.expire_all()
        left = db.query(AdminAssignment).filter(AdminAssignment.user_id == lisa_u.id).count()
        check("demotion drops their assignments", left == 0, left)
        r = client.patch(f"/api/v1/employees/{lisa.id}/login", headers=oh, json={"role": "owner"})
        check("owner role cannot be granted from the roster", r.status_code == 400, r.status_code)

        stale = create_access_token(user_id=alyan_u.id, company_id=cid, role="owner")
        check("a token claiming a role the user lacks is rejected",
              client.get("/api/v1/tasks", headers={"Authorization": f"Bearer {stale}"}).status_code == 401)

    finally:
        db.rollback()
        # Company delete cascades through every tenant-owned table in Postgres.
        for company_id in (cid, other_id):
            db.execute(text("DELETE FROM companies WHERE id = :id"), {"id": company_id})
        db.commit()
        db.close()

    print(f"\n{'All RBAC checks passed.' if not FAILURES else f'{len(FAILURES)} failed: {FAILURES}'}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
