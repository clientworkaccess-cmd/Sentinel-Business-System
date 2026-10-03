"""Verification: connectors (#11–#13) end to end, against a real database.

Composio, Google and Slack are replaced by ``FakeGateway``, which answers the same
REST calls the connectors make (Gmail threads/history, Calendar events with sync
tokens, Drive files/export, Slack's Web API) from in-memory fixtures. Everything else
is real: the HTTP routes, the signed OAuth state, the runner's lease and cursors,
ingest into brain_items, and the Owner / Admin / Member visibility on what synced.

The ComposioGateway's own error translation (401 → reconnect, Google's 403 quota →
rate limit, 410 → cursor reset) is checked against a stub SDK client in part 9.

    python -m scripts.verify_connectors
"""

from __future__ import annotations

import base64
import sys
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.connectors import gateway as gw
from app.connectors.gateway import (
    AccountState,
    LinkResult,
    ProviderAuthError,
    ProviderNotFound,
    ProviderRateLimited,
)
from app.connectors.runner import SYNC_LEASE, due_connections, sync_connection
from app.core.security import create_access_token, hash_password
from app.database import SessionLocal
from app.main import app
from app.models import (
    AdminAssignment,
    BrainItem,
    BrainItemOwner,
    Company,
    Connection,
    ConnectionStatus,
    Department,
    Employee,
    Team,
    TeamMembership,
    User,
    UserRole,
)

FAILURES: list[str] = []
NOW = datetime.now(UTC)


def check(label: str, condition: bool, detail: object = "") -> None:
    print(f"  [{'PASS' if condition else 'FAIL'}] {label}{f'  — {detail}' if detail and not condition else ''}")
    if not condition:
        FAILURES.append(label)


def b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def ms(days_ago: float) -> str:
    return str(int((NOW - timedelta(days=days_ago)).timestamp() * 1000))


def gmail_message(mid: str, tid: str, frm: str, to: str, subject: str, body: str, days_ago: float,
                  html: bool = False) -> dict[str, Any]:
    return {"id": mid, "threadId": tid, "internalDate": ms(days_ago), "labelIds": ["INBOX"], "snippet": body[:40],
            "payload": {"mimeType": "text/html" if html else "text/plain",
                        "headers": [{"name": "From", "value": frm}, {"name": "To", "value": to},
                                    {"name": "Subject", "value": subject}],
                        "body": {"data": b64(body)}}}


class FakeGateway:
    """Composio + Google + Slack, in memory. One mailbox/calendar/drive per account."""

    def __init__(self) -> None:
        self.accounts: dict[str, dict[str, Any]] = {}
        self.deleted: list[str] = []
        self.calls: list[str] = []
        self.fail: dict[str, Exception] = {}  # account_id → error to raise on get
        self.fail_delete = False
        self.n = 0
        # per-toolkit fixture state, keyed by account id at link time
        self.mailboxes: dict[str, dict[str, Any]] = {}
        self.calendars: dict[str, dict[str, Any]] = {}
        self.drives: dict[str, dict[str, Any]] = {}
        self.slack = {"team": "T1", "users": [], "channels": [], "history": {}, "replies": {}}

    # --- Composio -------------------------------------------------------------------
    def link(self, *, user_ref: str, toolkit: str, callback_url: str) -> LinkResult:
        self.n += 1
        aid = f"ca_fake{self.n}_{uuid.uuid4().hex[:8]}"
        self.accounts[aid] = {"status": "INITIATED", "user_id": user_ref, "toolkit": toolkit,
                              "callback": callback_url}
        return LinkResult(account_id=aid, redirect_url=f"https://connect.composio.dev/link/{aid}")

    def account(self, account_id: str) -> AccountState:
        acc = self.accounts.get(account_id)
        if acc is None:
            raise ProviderNotFound("not found")
        return AccountState(status=acc["status"], reason=None, user_id=acc["user_id"], toolkit=acc["toolkit"])

    def delete(self, account_id: str) -> None:
        if self.fail_delete:
            raise gw.ProviderError("Composio is down.")
        self.deleted.append(account_id)
        self.accounts.pop(account_id, None)

    # --- provider APIs ------------------------------------------------------------------
    def get_text(self, account_id: str, url: str, params: dict[str, Any] | None = None) -> str:
        self.calls.append(url)
        file_id = url.split("/files/")[1].split("/")[0]
        return self.drives[account_id]["text"][file_id]

    def get(self, account_id: str, url: str, params: dict[str, Any] | None = None) -> Any:
        self.calls.append(url)
        if err := self.fail.get(account_id):
            raise err
        p = {k: v for k, v in (params or {}).items() if v is not None}
        toolkit = self.accounts.get(account_id, {}).get("toolkit")
        if toolkit == "gmail":
            return self._gmail(self.mailboxes[account_id], url, p)
        if toolkit == "googlecalendar":
            return self._calendar(self.calendars[account_id], p)
        if toolkit == "googledrive":
            return self._drive(self.drives[account_id], p)
        if toolkit == "slack":
            return self._slack(url, p)
        raise AssertionError(f"unexpected call {url}")

    def _gmail(self, box: dict[str, Any], url: str, p: dict[str, Any]) -> Any:
        if url.endswith("/profile"):
            return {"emailAddress": box["email"], "historyId": str(box["history_id"])}
        if url.endswith("/threads"):
            ids = sorted(box["threads"])
            start = int(p.get("pageToken", 0))
            size = int(p["maxResults"])
            page = ids[start:start + 2]  # pages of two, to exercise pagination
            more = start + 2 < len(ids)
            assert size >= 2
            return {"threads": [{"id": t} for t in page], **({"nextPageToken": str(start + 2)} if more else {})}
        if "/threads/" in url:
            tid = url.rsplit("/", 1)[1]
            if tid not in box["threads"]:
                raise ProviderNotFound("gone")
            return {"id": tid, "messages": box["threads"][tid]}
        if url.endswith("/history"):
            if box.get("history_expired"):
                raise ProviderNotFound("404")
            since = int(p["startHistoryId"])
            records = [r for r in box["history"] if r["id"] > since]
            return {"history": [{"id": str(r["id"]), "messagesAdded": [{"message": r["message"]}]} for r in records],
                    "historyId": str(box["history_id"])}
        raise AssertionError(url)

    def _calendar(self, cal: dict[str, Any], p: dict[str, Any]) -> Any:
        if "syncToken" in p:
            if p["syncToken"] != cal["token"]:
                raise ProviderNotFound("410")
            changes, cal["changes"] = cal["changes"], []
            cal["token"] = f"tok{int(cal['token'][3:]) + 1}"
            return {"items": changes, "nextSyncToken": cal["token"], "summary": cal["email"]}
        return {"items": cal["events"], "nextSyncToken": cal["token"], "summary": cal["email"]}

    def _drive(self, drive: dict[str, Any], p: dict[str, Any]) -> Any:
        if "q" not in p:  # GET /about
            return {"user": {"emailAddress": drive.get("user", "")}}
        since = p["q"].split("modifiedTime > '")[1].rstrip("'")
        files = sorted((f for f in drive["files"] if f["modifiedTime"] > since), key=lambda f: f["modifiedTime"])
        return {"files": files}

    def _slack(self, url: str, p: dict[str, Any]) -> Any:
        method = url.rsplit("/", 1)[1]
        s = self.slack
        if method == "auth.test":
            return {"ok": True, "team_id": s["team"], "team": "Arcline", "user": "someone"}
        if method == "users.list":
            return {"ok": True, "members": s["users"]}
        if method == "users.conversations":
            assert p["types"] == "public_channel", "only public channels are read"
            return {"ok": True, "channels": s["channels"]}
        if method == "conversations.history":
            oldest = float(p["oldest"])
            return {"ok": True, "messages": [m for m in s["history"][p["channel"]] if float(m["ts"]) >= oldest],
                    "has_more": False}
        if method == "conversations.replies":
            return {"ok": True, "messages": s["replies"][(p["channel"], p["ts"])]}
        raise AssertionError(method)


def ts(days_ago: float) -> str:
    return f"{(NOW - timedelta(days=days_ago)).timestamp():.6f}"


def main() -> int:  # noqa: C901 - a linear script of assertions
    db = SessionLocal()
    client = TestClient(app)
    fake = FakeGateway()
    tag = uuid.uuid4().hex[:8]
    domain = f"arcline-{tag}.pk"
    company = Company(name=f"conn-verify-{tag}")
    other = Company(name=f"conn-other-{tag}")
    db.add_all([company, other])
    db.flush()
    cid, other_id = company.id, other.id

    try:
        eng = Department(company_id=cid, name="Engineering")
        sales = Department(company_id=cid, name="Sales")
        db.add_all([eng, sales])
        db.flush()
        mobile = Team(company_id=cid, name="Mobile", department_id=eng.id)
        db.add(mobile)
        db.flush()

        def emp(name: str, dept: Department, email: str | None) -> Employee:
            e = Employee(company_id=cid, name=name, department_id=dept.id, email=email)
            db.add(e)
            db.flush()
            return e

        saim = emp("Saim", eng, f"saim@{domain}")
        alyan = emp("Alyan Ali", eng, f"alyan@{domain}")
        mark = emp("Mark", sales, f"mark@{domain}")
        db.add(TeamMembership(company_id=cid, team_id=mobile.id, employee_id=alyan.id))

        def user(role: UserRole, e: Employee | None, label: str, company_id: uuid.UUID = cid) -> User:
            u = User(company_id=company_id, email=f"{label}-{tag}@{domain}" if e is None else e.email,
                     password_hash=hash_password("x" * 12), role=role, employee_id=e.id if e else None)
            db.add(u)
            db.flush()
            return u

        owner = user(UserRole.OWNER, None, "owner")
        saim_u = user(UserRole.ADMIN, saim, "saim")
        alyan_u = user(UserRole.MEMBER, alyan, "alyan")
        mark_u = user(UserRole.MEMBER, mark, "mark")
        outsider = user(UserRole.OWNER, None, "outsider", other_id)
        db.add(AdminAssignment(company_id=cid, user_id=saim_u.id, department_id=eng.id))
        db.commit()

        def auth(u: User) -> dict[str, str]:
            return {"Authorization": f"Bearer {create_access_token(user_id=u.id, company_id=u.company_id, role=u.role)}"}

        oh, sh, ah, mh, xh = auth(owner), auth(saim_u), auth(alyan_u), auth(mark_u), auth(outsider)
        C = "/api/v1/connectors"

        def mine(h, cid_: str) -> dict[str, Any]:
            return next(c for c in client.get(C, headers=h).json() if c["id"] == cid_)

        def connect_and_finish(h, connector: str, setup) -> Connection:
            r = client.post(f"{C}/{connector}/connect", headers=h)
            assert r.status_code == 200, r.text
            aid = r.json()["redirectUrl"].rsplit("/", 1)[1]
            setup(aid)
            fake.accounts[aid]["status"] = "ACTIVE"
            state = parse_qs(urlparse(fake.accounts[aid]["callback"]).query)["state"][0]
            r = client.get(f"{C}/callback", params={"state": state, "status": "success",
                                                    "connected_account_id": aid}, follow_redirects=False)
            assert r.status_code == 303 and "result=connected" in r.headers["location"], (r.status_code, r.headers)
            db.expire_all()
            return db.execute(select(Connection).where(Connection.composio_account_id == aid)).scalar_one()

        def items(source: str) -> list[BrainItem]:
            db.expire_all()
            return list(db.execute(select(BrainItem).where(BrainItem.company_id == cid, BrainItem.source == source)
                                   .order_by(BrainItem.title)).scalars())

        def graph_titles(h) -> set[str]:
            r = client.get("/api/v1/graph", headers=h)
            return {i["title"] for i in r.json().get("items", [])} if r.status_code == 200 else set()

        def member_titles(h, e: Employee) -> set[str]:
            r = client.get("/api/v1/graph", headers=h, params={"level": "member", "id": str(e.id)})
            return {i["title"] for i in r.json().get("items", [])} if r.status_code == 200 else set()

        # --- 1. unconfigured ----------------------------------------------------------------
        print("\n1. Without COMPOSIO_API_KEY")
        gw.set_gateway(None)
        r = client.get(C, headers=ah)
        body = r.json()
        check("the catalogue still answers, marked unavailable",
              r.status_code == 200 and body and all(c["available"] is False for c in body), r.text[:200])
        check("ids match the gallery (gmail, google_calendar, google_drive, google_docs, slack)",
              {c["id"] for c in body} == {"gmail", "google_calendar", "google_drive", "google_docs", "slack"})
        r = client.post(f"{C}/gmail/connect", headers=ah)
        check("connecting is a clean 503, not a crash", r.status_code == 503 and r.json()["code"] == "UNAVAILABLE",
              r.text)
        check("an unauthenticated read is refused", client.get(C).status_code == 401)

        gw.set_gateway(fake)

        # --- 2. OAuth round trip -------------------------------------------------------
        print("\n2. Connect: Composio link, signed callback")
        r = client.post(f"{C}/gmail/connect", headers=ah)
        check("connect returns Composio's consent URL", r.status_code == 200
              and r.json()["redirectUrl"].startswith("https://connect.composio.dev/"), r.text)
        aid = r.json()["redirectUrl"].rsplit("/", 1)[1]
        check("the account is filed under a tenant-qualified user ref",
              fake.accounts[aid]["user_id"] == f"sentinel-{cid.hex}-{alyan_u.id.hex}")
        check("…and the gallery shows it pending", mine(ah, "gmail")["status"] == "pending")
        check("the response never carries Composio's account id", aid not in client.get(C, headers=ah).text)
        state = parse_qs(urlparse(fake.accounts[aid]["callback"]).query)["state"][0]
        check("the callback URL points at this API", fake.accounts[aid]["callback"].startswith(
            "http://localhost:8000/api/v1/connectors/callback?state="))
        r = client.get(f"{C}/callback", params={"state": "forged"}, follow_redirects=False)
        check("a forged state is turned away", r.status_code == 303 and "result=expired" in r.headers["location"])
        r = client.get(f"{C}/callback", params={"state": state, "connected_account_id": "ca_someone_else"},
                       follow_redirects=False)
        check("a callback naming another account fails", "result=failed" in r.headers["location"])
        r = client.get(C, headers={"Authorization": f"Bearer {state}"})
        check("the state token is useless as a login token", r.status_code == 401, r.status_code)
        r = client.get(f"{C}/callback", params={"state": state}, follow_redirects=False)
        check("consent not finished yet → stays pending", "result=pending" in r.headers["location"]
              and mine(ah, "gmail")["status"] == "pending")
        fake.accounts[aid]["user_id"] = "sentinel-someone-else"
        fake.accounts[aid]["status"] = "ACTIVE"
        r = client.get(f"{C}/callback", params={"state": state}, follow_redirects=False)
        check("an account Composio files under another user is refused", "result=failed" in r.headers["location"])
        fake.accounts[aid]["user_id"] = f"sentinel-{cid.hex}-{alyan_u.id.hex}"
        fake.accounts[aid]["status"] = "INITIATED"

        # --- 3. Gmail ---------------------------------------------------------------------
        print("\n3. Gmail: backfill by thread, visibility, incremental history")
        box = {"email": "alyan.home@gmail.com", "history_id": 100, "history": [], "threads": {
            "t1": [gmail_message("m1", "t1", f"Saim <saim@{domain}>", f"alyan@{domain}", "Release train",
                                 "Can we ship Friday?", 3),
                   gmail_message("m2", "t1", "Alyan <alyan.home@gmail.com>", f"saim@{domain}", "Re: Release train",
                                 "Yes, after QA.\n\nOn Mon, Saim wrote:\n> Can we ship Friday?", 2)],
            "t2": [gmail_message("m3", "t2", "Dana <dana@kestrel.com>", f"alyan@{domain}", "Kestrel v2 launch",
                                 "<p>The launch is slipping to <b>Oct 20</b>.</p><style>p{}</style>", 1, html=True)],
            "t3": [gmail_message("m4", "t3", "News <news@vendor.io>", f"alyan@{domain}", "Weekly digest",
                                 "Nothing new.", 5)],
        }}
        fake.mailboxes[aid] = box
        fake.accounts[aid]["status"] = "ACTIVE"
        r = client.get(f"{C}/callback", params={"state": state, "connected_account_id": aid}, follow_redirects=False)
        check("consent done → connected, back to the gallery",
              r.headers["location"] == "http://localhost:3000/brain/connectors?result=connected&connector=gmail",
              r.headers.get("location"))
        gmail = items("gmail")
        check("the first sync ran in the background and paged through every thread",
              [i.title for i in gmail] == ["Kestrel v2 launch", "Release train", "Weekly digest"], [i.title for i in gmail])
        release = next(i for i in gmail if i.title == "Release train")
        kestrel = next(i for i in gmail if i.title == "Kestrel v2 launch")
        check("a thread is one item, both messages in order",
              "Saim" in release.summary and release.summary.index("Can we ship") < release.summary.index("after QA"),
              release.summary)
        check("quoted reply history is stripped", release.summary.count("Can we ship Friday?") == 1, release.summary)
        check("HTML mail is reduced to text", "slipping to Oct 20" in kestrel.summary and "<" not in kestrel.summary
              and "p{}" not in kestrel.summary, kestrel.summary)
        check("mail with someone outside the company is external", kestrel.external)
        check("…but the mailbox's own address never is, even on gmail.com", not release.external,
              release.external)
        check("owners: the mailbox's person plus colleagues on the thread",
              set(release.owner_ids) == {alyan.id, saim.id} and set(kestrel.owner_ids) == {alyan.id})
        conn = db.execute(select(Connection).where(Connection.composio_account_id == aid)).scalar_one()
        check("the connection is active, labelled, counted, and in incremental mode",
              conn.status is ConnectionStatus.ACTIVE and conn.account_label == box["email"] and conn.item_count == 3
              and conn.sync_cursor.get("phase") == "incremental" and conn.sync_cursor.get("history_id") == "100",
              (conn.status, conn.account_label, conn.item_count, conn.sync_cursor))
        g = mine(ah, "gmail")
        check("the gallery shows it connected with a count",
              g["status"] == "connected" and g["mine"]["itemCount"] == 3 and g["syncCount"] == 3, g)

        check("Alyan sees his mail in his brain", {"Release train", "Kestrel v2 launch"} <= member_titles(ah, alyan))
        r = client.get("/api/v1/graph", headers=sh, params={"level": "department", "id": str(eng.id)})
        check("his Admin (Engineering) sees it",
              "Kestrel v2 launch" in {i["title"] for i in r.json().get("items", [])}, r.status_code)
        check("the Owner sees it", "Kestrel v2 launch" in graph_titles(oh))
        check("a Sales Member does not", not ({"Release train", "Kestrel v2 launch"} & graph_titles(mh)))
        check("…nor does another company", not ({"Release train"} & graph_titles(xh)))
        check("Mark's gallery shows nothing connected for him", mine(mh, "gmail")["status"] == "available"
              and mine(mh, "gmail")["connectedCount"] == 0)
        check("the Owner's gallery counts Alyan's connection", mine(oh, "gmail")["connectedCount"] == 1)

        box["threads"]["t2"].append(gmail_message("m5", "t2", f"Alyan <alyan@{domain}>", "dana@kestrel.com",
                                                  "Re: Kestrel v2 launch", "Understood, we'll replan.", 0.1))
        box["history"].append({"id": 101, "message": {"id": "m5", "threadId": "t2", "labelIds": ["SENT"]}})
        box["history_id"] = 101
        r = client.post(f"{C}/gmail/sync", headers=ah)
        check("sync now is accepted", r.status_code == 202 and r.json()["queued"] is True, r.text)
        gmail = items("gmail")
        kestrel = next(i for i in gmail if i.title == "Kestrel v2 launch")
        check("incremental: the new reply lands in the existing item, no duplicate",
              len(gmail) == 3 and "we'll replan" in kestrel.summary, [i.title for i in gmail])
        db.refresh(conn)
        check("the history mark advances", conn.sync_cursor.get("history_id") == "101", conn.sync_cursor)
        calls = len(fake.calls)
        sync_connection(conn.id)
        check("a quiet mailbox costs one history call", len(fake.calls) - calls == 1, fake.calls[calls:])

        box["history_expired"] = True
        sync_connection(conn.id)
        box["history_expired"] = False
        check("an expired historyId falls back to a backfill without duplicating", len(items("gmail")) == 3)

        # --- 4. Calendar ----------------------------------------------------------------------
        print("\n4. Google Calendar: events, sync token, cancellations, 410")

        def calendar_setup(account: str) -> None:
            fake.calendars[account] = {"email": f"alyan@{domain}", "token": "tok1", "changes": [], "events": [
                {"id": "e1", "summary": "Kestrel QBR", "start": {"dateTime": (NOW + timedelta(days=2)).isoformat()},
                 "attendees": [{"email": f"alyan@{domain}"}, {"email": "dana@kestrel.com", "displayName": "Dana"},
                               {"email": "room@resource.calendar.google.com", "resource": True}],
                 "description": "<b>Agenda</b>: renewal", "htmlLink": "https://calendar.google.com/e1"},
                {"id": "e2", "summary": "Mobile standup", "start": {"date": (NOW - timedelta(days=1)).date().isoformat()},
                 "attendees": [{"email": f"alyan@{domain}"}, {"email": f"saim@{domain}"}]},
                {"id": "e0", "summary": "Ancient offsite", "start": {"date": "2019-01-01"}},
            ]}

        cal = connect_and_finish(ah, "google_calendar", calendar_setup)
        events = items("google_calendar")
        check("events become meeting items; history beyond the backfill window is skipped",
              [i.title for i in events] == ["Kestrel QBR", "Mobile standup"], [i.title for i in events])
        qbr = next(i for i in events if i.title == "Kestrel QBR")
        check("an event lists attendees (not rooms) and an external guest marks it external",
              qbr.kind.value == "meeting" and "Dana" in qbr.summary and "room@" not in qbr.summary and qbr.external,
              qbr.summary)
        check("the sync token is stored", cal.sync_cursor == {"sync_token": "tok1"}, cal.sync_cursor)
        fake.calendars[cal.composio_account_id]["changes"] = [{"id": "e2", "status": "cancelled"}]
        sync_connection(cal.id)
        check("a cancelled event is removed", [i.title for i in items("google_calendar")] == ["Kestrel QBR"])
        db.execute(text("UPDATE connections SET sync_cursor = '{\"sync_token\": \"stale\"}' WHERE id = :id"),
                   {"id": cal.id})
        db.commit()
        sync_connection(cal.id)
        db.refresh(cal)
        check("410 Gone → full resync, then a fresh token", cal.sync_cursor.get("sync_token", "").startswith("tok")
              and cal.sync_cursor["sync_token"] != "stale" and len(items("google_calendar")) == 2, cal.sync_cursor)

        # --- 5. Drive -----------------------------------------------------------------------
        print("\n5. Google Drive: Docs exported as text, other files by metadata")

        def drive_setup(account: str) -> None:
            fake.drives[account] = {"text": {"d1": "Kestrel SOW: 3 milestones, net-30."}, "files": [
                {"id": "d1", "name": "Kestrel SOW", "mimeType": "application/vnd.google-apps.document",
                 "modifiedTime": (NOW - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                 "owners": [{"emailAddress": f"alyan@{domain}"}], "webViewLink": "https://docs.google.com/d1"},
                {"id": "f1", "name": "Signed contract.pdf", "mimeType": "application/pdf",
                 "modifiedTime": (NOW - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                 "owners": [{"emailAddress": "legal@kestrel.com"}]},
            ]}

        drive = connect_and_finish(ah, "google_drive", drive_setup)
        files = items("google_drive")
        sow = next((i for i in files if i.title == "Kestrel SOW"), None)
        pdf = next((i for i in files if i.title == "Signed contract.pdf"), None)
        check("a Google Doc is indexed by its text", sow is not None and "3 milestones" in (sow.summary or ""),
              sow and sow.summary)
        check("a PDF is indexed by metadata, and an outside owner marks it external",
              pdf is not None and pdf.summary.startswith("PDF") and pdf.external, pdf and pdf.summary)
        check("the watermark is the newest modifiedTime", drive.sync_cursor.get("modified_after", "").endswith("Z"),
              drive.sync_cursor)
        calls = len(fake.calls)
        sync_connection(drive.id)
        check("an unchanged Drive exports nothing again", not [c for c in fake.calls[calls:] if "/export" in c])
        check("the Docs card is served by the Drive connection",
              mine(ah, "google_docs")["status"] == "connected" and mine(ah, "google_docs")["servedBy"] == "google_drive")

        # --- 6. Slack -----------------------------------------------------------------------
        print("\n6. Slack: public channels, threads, day digests, people by email")
        fake.slack["users"] = [
            {"id": "U1", "profile": {"display_name": "Saim", "email": f"saim@{domain}"}},
            {"id": "U2", "profile": {"real_name": "Alyan Ali", "email": f"alyan@{domain}"}},
            {"id": "U9", "profile": {"real_name": "Dana (Kestrel)", "email": "dana@kestrel.com"}},
            {"id": "B1", "is_bot": True, "profile": {"real_name": "Jira bot"}},
        ]
        fake.slack["channels"] = [{"id": "C1", "name": "eng"}, {"id": "C2", "name": "kestrel-shared",
                                                                 "is_ext_shared": True}]
        root = ts(2)
        fake.slack["history"] = {
            "C1": [{"ts": root, "user": "U1", "text": "Release blocked on <@U2>'s SDK fix", "reply_count": 1},
                   {"ts": ts(1.5), "user": "U2", "text": "Lunch?"},
                   {"ts": ts(1.4), "user": "U1", "subtype": "channel_join", "text": "joined"},
                   {"ts": ts(1.3), "bot_id": "B1", "text": "JIRA-12 moved"}],
            "C2": [{"ts": ts(1), "user": "U9", "text": "Can we get the build by <https://x.io|Friday>?"}],
        }
        fake.slack["replies"] = {("C1", root): [
            {"ts": root, "user": "U1", "text": "Release blocked on <@U2>'s SDK fix"},
            {"ts": ts(1.9), "user": "U2", "text": "Fix is in review"}]}
        slack = connect_and_finish(sh, "slack", lambda a: None)
        threads = items("slack")
        titles = sorted(i.title for i in threads)
        check("a thread is one item; loose messages become a channel-day item",
              len(threads) == 3 and any(t.startswith("#eng: Release blocked") for t in titles)
              and any(t.startswith("#eng on ") for t in titles), titles)
        blocked = next(i for i in threads if i.title.startswith("#eng: Release blocked"))
        check("mentions are resolved to names, joins and bots are dropped",
              "@Alyan Ali" in blocked.summary and "Fix is in review" in blocked.summary
              and "joined" not in "".join(i.summary for i in threads)
              and "JIRA-12" not in "".join(i.summary for i in threads), blocked.summary)
        check("participants become owners", set(blocked.owner_ids) == {saim.id, alyan.id})
        shared = next(i for i in threads if i.title.startswith("#kestrel-shared"))
        check("a Slack Connect channel is external; links read as text",
              shared.external and "Friday (https://x.io)" in shared.summary, shared.summary)
        check("an item with no colleague in it is filed under whoever synced it", set(shared.owner_ids) == {saim.id})
        db.expire_all()
        check("Slack ids are linked to employees by email",
              db.get(Employee, saim.id).slack_user_id == "U1" and db.get(Employee, alyan.id).slack_user_id == "U2")
        check("private channels and DMs were never requested", True)  # asserted inside the fake

        mark_slack = connect_and_finish(mh, "slack", lambda a: None)
        check("a second person connecting the same workspace adds no duplicates", len(items("slack")) == 3)
        check("…and their connection counts no items of its own", mark_slack.item_count == 0)

        fake.slack["history"]["C1"].append({"ts": ts(1.45), "user": "U1", "text": "Sure, 1pm"})
        sync_connection(slack.id)
        day = next(i for i in items("slack") if i.title.startswith("#eng on "))
        check("incremental Slack rebuilds the whole day, not just the new message",
              "Lunch?" in day.summary and "Sure, 1pm" in day.summary, day.summary)

        # --- 7. failures ------------------------------------------------------------------
        print("\n7. Failures land on the connection")
        fake.fail[conn.composio_account_id] = ProviderRateLimited("The provider is rate-limiting us.")
        before = dict(conn.sync_cursor)
        sync_connection(conn.id)
        db.refresh(conn)
        check("rate limited: still active, error recorded, cursor kept",
              conn.status is ConnectionStatus.ACTIVE and "rate" in (conn.last_sync_error or "")
              and conn.sync_cursor == before and conn.sync_started_at is None, (conn.status, conn.last_sync_error))
        check("…and the scheduler waits a full interval before retrying it", conn.id not in due_connections())
        fake.fail[conn.composio_account_id] = ProviderAuthError("Reconnect it.")
        sync_connection(conn.id)
        db.refresh(conn)
        check("grant revoked: marked expired", conn.status is ConnectionStatus.EXPIRED, conn.status)
        check("the gallery asks for a reconnect", mine(ah, "gmail")["status"] == "needs_reconnect")
        check("sync now is refused until then", client.post(f"{C}/gmail/sync", headers=ah).status_code == 409)
        check("expired connections are never scheduled", conn.id not in due_connections())
        fake.fail.pop(conn.composio_account_id)
        r = client.post(f"{C}/gmail/connect", headers=ah)
        check("reconnecting reuses the row and drops the dead Composio account",
              r.status_code == 200 and r.json()["connectionId"] == str(conn.id) and aid in fake.deleted, r.text)
        new_aid = r.json()["redirectUrl"].rsplit("/", 1)[1]
        fake.mailboxes[new_aid] = box
        fake.accounts[new_aid]["status"] = "ACTIVE"
        db.execute(text("UPDATE connections SET updated_at = now() - interval '1 minute' WHERE id = :id"),
                   {"id": conn.id})
        db.commit()
        client.get(C, headers=ah)  # the callback never came: the status read settles it
        db.refresh(conn)
        check("a pending connection whose callback never arrived is settled on read",
              conn.status is ConnectionStatus.ACTIVE, conn.status)
        check("…and that read starts its sync", conn.last_synced_at is not None and conn.sync_started_at is None)
        check("an active connection cannot be connected twice",
              client.post(f"{C}/gmail/connect", headers=ah).status_code == 409)

        # --- 8. lease, scheduler ------------------------------------------------------------
        print("\n8. One sync at a time")
        db.execute(text("UPDATE connections SET sync_started_at = now() WHERE id = :id"), {"id": conn.id})
        db.commit()
        check("a live lease blocks a second run", sync_connection(conn.id).ran is False)
        check("…and sync now says so", client.post(f"{C}/gmail/sync", headers=ah).json()["queued"] is False)
        db.execute(text("UPDATE connections SET sync_started_at = :t WHERE id = :id"),
                   {"t": datetime.now(UTC) - SYNC_LEASE - timedelta(minutes=1), "id": conn.id})
        db.commit()
        check("a crashed worker's stale lease is taken over", sync_connection(conn.id).ran is True)
        db.execute(text("UPDATE connections SET last_synced_at = now() - interval '2 hours', "
                        "last_sync_error = NULL WHERE id = :id"), {"id": conn.id})
        db.commit()
        check("a connection past its interval is due", conn.id in due_connections())
        check("one synced just now is not", drive.id not in due_connections())

        # --- 9. ComposioGateway error translation -------------------------------------------
        print("\n9. ComposioGateway maps provider statuses")

        class Resp:
            def __init__(self, status: int, data: Any = None, headers: dict | None = None) -> None:
                self.status, self.data, self.headers, self.binary_data = status, data, headers or {}, None

        class StubTools:
            def __init__(self, responses: list[Resp]) -> None:
                self.responses = responses

            def proxy(self, **_: Any) -> Resp:
                return self.responses.pop(0)

        class StubClient:
            def __init__(self, responses: list[Resp]) -> None:
                self.tools = StubTools(responses)

        def gateway_with(*responses: Resp) -> gw.ComposioGateway:
            g = gw.ComposioGateway.__new__(gw.ComposioGateway)
            g._client = StubClient(list(responses))
            return g

        gw.time.sleep = lambda *_: None  # no real backoff in a test
        check("200 returns the body", gateway_with(Resp(200, {"ok": 1})).get("ca", "u") == {"ok": 1})
        for status_code, expected in ((401, ProviderAuthError), (410, ProviderNotFound)):
            try:
                gateway_with(Resp(status_code)).get("ca", "u")
                check(f"{status_code} raises {expected.__name__}", False)
            except expected:
                check(f"{status_code} raises {expected.__name__}", True)
        quota = Resp(403, {"error": {"errors": [{"reason": "userRateLimitExceeded"}]}})
        check("Google's 403 quota error is retried as a rate limit, not an expiry",
              gateway_with(quota, Resp(200, {"ok": 2})).get("ca", "u") == {"ok": 2})
        try:
            gateway_with(*[Resp(429)] * gw.MAX_ATTEMPTS).get("ca", "u")
            check("persistent 429 gives up as ProviderRateLimited", False)
        except ProviderRateLimited:
            check("persistent 429 gives up as ProviderRateLimited", True)
        check("a 5xx is retried", gateway_with(Resp(503), Resp(200, [1])).get("ca", "u") == [1])

        # --- 10. Owner view, disconnect --------------------------------------------------
        print("\n10. Owner overview and disconnect")
        r = client.get(f"{C}/connections", headers=oh)
        check("the Owner sees every connection", r.status_code == 200 and len(r.json()) == 5, r.text[:300])
        check("…a Member may not", client.get(f"{C}/connections", headers=ah).status_code == 403)
        check("…and the overview carries no Composio ids", "ca_fake" not in r.text)
        check("nobody else's company appears", client.get(f"{C}/connections", headers=xh).json() == [])

        drive_aid = drive.composio_account_id
        fake.fail_delete = True
        r = client.delete(f"{C}/google_drive", headers=ah)
        check("if Composio cannot revoke, nothing is removed here (502)",
              r.status_code == 502 and len(items("google_drive")) == 2, r.status_code)
        fake.fail_delete = False
        r = client.delete(f"{C}/google_drive", headers=ah)
        check("disconnect revokes at Composio and removes what it synced",
              r.status_code == 200 and r.json()["removedItems"] == 2 and not items("google_drive")
              and drive_aid in fake.deleted, r.text)
        db.expire_all()
        orphan_owners = db.execute(select(func.count()).select_from(BrainItemOwner).where(
            BrainItemOwner.company_id == cid,
            ~BrainItemOwner.item_id.in_(select(BrainItem.id)))).scalar_one()
        check("no orphaned owner rows remain", orphan_owners == 0)
        check("disconnecting twice is a 404", client.delete(f"{C}/google_drive", headers=ah).status_code == 404)
        r = client.delete(f"{C}/gmail", headers=mh)
        check("you cannot disconnect someone else's account", r.status_code == 404 and len(items("gmail")) == 3)
        r = client.delete(f"{C}/slack", headers=sh, params={"purge": "false"})
        check("purge=false keeps what was synced", r.status_code == 200 and len(items("slack")) == 3, r.text)

    finally:
        gw.set_gateway(None)
        db.rollback()
        for company_id in (cid, other_id):
            db.execute(text("DELETE FROM companies WHERE id = :id"), {"id": company_id})
        db.commit()
        db.close()

    print(f"\n{'All connector checks passed.' if not FAILURES else f'{len(FAILURES)} failed: {FAILURES}'}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
