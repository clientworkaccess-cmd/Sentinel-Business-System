"""Google Workspace connectors (#12): Gmail, Calendar, Drive (Docs included).

Each is a separate Composio toolkit, so each is connected separately and has its
own read-only grant. All three call Google's REST APIs through the Composio proxy
and sync incrementally, the way Google documents it:

* Gmail    — backfill by thread, then ``users.history`` from the profile's historyId.
* Calendar — full list once, then ``syncToken``; HTTP 410 means start over.
* Drive    — files ordered by ``modifiedTime``, with a watermark. Google Docs and
             Slides are exported as text; other files are indexed by metadata.
"""

from __future__ import annotations

import base64
import html
import re
from datetime import UTC, date, datetime
from email.utils import getaddresses, parsedate_to_datetime
from typing import Any

from app.connectors.base import Connector, SourceDocument, SyncBatch, SyncContext, clip
from app.connectors.gateway import ProviderNotFound
from app.models.enums import BrainItemKind

GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary"
DRIVE = "https://www.googleapis.com/drive/v3"

#: Threads fetched per sync() call. Each is one extra request.
GMAIL_THREADS_PER_PAGE = 25
#: Messages of a long thread kept in the item, newest last.
GMAIL_MESSAGES_PER_THREAD = 8
DRIVE_FILES_PER_PAGE = 25
CALENDAR_EVENTS_PER_PAGE = 250

#: Exportable as text. Everything else is indexed by name and metadata.
DRIVE_TEXT_EXPORTS = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.presentation": "text/plain",
}
DRIVE_FOLDER = "application/vnd.google-apps.folder"


# --- Gmail ---------------------------------------------------------------------------


class GmailConnector(Connector):
    id = "gmail"
    toolkit = "gmail"
    name = "Gmail"
    source = "gmail"
    sync_unit = "emails"

    def sync(self, ctx: SyncContext) -> SyncBatch:
        cursor = dict(ctx.cursor)
        if cursor.get("phase") == "incremental":
            try:
                return self._incremental(ctx, cursor)
            except ProviderNotFound:
                # historyId older than Google keeps (about a week): back to a backfill.
                # Ingest upserts, so re-reading threads already held is harmless.
                cursor = {}
        return self._backfill(ctx, cursor)

    def _backfill(self, ctx: SyncContext, cursor: dict[str, Any]) -> SyncBatch:
        if "history_id" not in cursor:
            # Take the history mark *before* listing, so nothing that arrives during
            # the backfill falls between the two.
            profile = ctx.gateway.get(ctx.account_id, f"{GMAIL}/profile")
            cursor = {"phase": "backfill", "history_id": str(profile["historyId"]),
                      "email": profile.get("emailAddress")}
        after = int(ctx.backfill_since.timestamp())
        page = ctx.gateway.get(ctx.account_id, f"{GMAIL}/threads", {
            "q": f"after:{after} -in:spam -in:trash -in:chats",
            "maxResults": GMAIL_THREADS_PER_PAGE,
            "pageToken": cursor.get("page_token"),
        }) or {}
        thread_ids = [t["id"] for t in page.get("threads", [])]
        documents = [d for d in (self._thread(ctx, tid) for tid in thread_ids) if d]
        next_token = page.get("nextPageToken")
        if next_token:
            cursor["page_token"] = next_token
        else:
            cursor = {"phase": "incremental", "history_id": cursor["history_id"],
                      "email": cursor.get("email")}
        return SyncBatch(documents=documents, cursor=cursor, has_more=bool(next_token),
                         account_label=cursor.get("email"))

    def _incremental(self, ctx: SyncContext, cursor: dict[str, Any]) -> SyncBatch:
        page = ctx.gateway.get(ctx.account_id, f"{GMAIL}/history", {
            "startHistoryId": cursor["history_id"],
            "historyTypes": "messageAdded",
            "maxResults": 100,
            "pageToken": cursor.get("page_token"),
        }) or {}
        thread_ids: list[str] = []
        for record in page.get("history", []):
            for added in record.get("messagesAdded", []):
                message = added.get("message") or {}
                labels = set(message.get("labelIds") or [])
                if labels & {"SPAM", "TRASH", "CHAT"}:
                    continue
                if (tid := message.get("threadId")) and tid not in thread_ids:
                    thread_ids.append(tid)
        documents = [d for d in (self._thread(ctx, tid) for tid in thread_ids[:GMAIL_THREADS_PER_PAGE * 4]) if d]
        next_token = page.get("nextPageToken")
        new_cursor = {"phase": "incremental", "email": cursor.get("email")}
        if next_token:
            new_cursor.update(history_id=cursor["history_id"], page_token=next_token)
        else:
            new_cursor["history_id"] = str(page.get("historyId") or cursor["history_id"])
        return SyncBatch(documents=documents, cursor=new_cursor, has_more=bool(next_token),
                         account_label=cursor.get("email"))

    def _thread(self, ctx: SyncContext, thread_id: str) -> SourceDocument | None:
        try:
            thread = ctx.gateway.get(ctx.account_id, f"{GMAIL}/threads/{thread_id}", {"format": "full"})
        except ProviderNotFound:
            return None  # deleted between the list and the fetch
        messages = (thread or {}).get("messages") or []
        if not messages:
            return None
        subject = ""
        participants: list[str] = []
        names: dict[str, str] = {}
        lines: list[str] = []
        last_date: datetime | None = None
        for message in messages:
            headers = {h["name"].lower(): h["value"] for h in message.get("payload", {}).get("headers", [])}
            subject = subject or headers.get("subject", "").strip()
            for field in ("from", "to", "cc"):
                for name, address in getaddresses([headers.get(field, "")]):
                    address = address.strip().lower()
                    if address and "@" in address:
                        if address not in participants:
                            participants.append(address)
                        if name:
                            names.setdefault(address, name)
            sent = _message_time(message, headers)
            last_date = max(last_date, sent) if last_date and sent else (sent or last_date)
        for message in messages[-GMAIL_MESSAGES_PER_THREAD:]:
            headers = {h["name"].lower(): h["value"] for h in message.get("payload", {}).get("headers", [])}
            sender = getaddresses([headers.get("from", "")])
            who = (sender[0][0] or sender[0][1]) if sender else "Unknown"
            sent = _message_time(message, headers)
            when = f" ({sent:%d %b %Y})" if sent else ""
            text = _strip_quoted(_message_text(message.get("payload", {}))) or message.get("snippet", "")
            lines.append(f"{who}{when}: {html.unescape(text).strip()}")
        return SourceDocument(
            external_ref=thread_id,
            kind=BrainItemKind.THREAD,
            title=subject or "(no subject)",
            body=clip("\n\n".join(lines)),
            occurred_on=last_date.date() if last_date else None,
            participant_emails=participants,
            external=ctx.people.any_external(participants),
            url=f"https://mail.google.com/mail/#all/{thread_id}",
        )


def _message_time(message: dict[str, Any], headers: dict[str, str]) -> datetime | None:
    if internal := message.get("internalDate"):
        try:
            return datetime.fromtimestamp(int(internal) / 1000, tz=UTC)
        except (TypeError, ValueError):
            pass
    try:
        return parsedate_to_datetime(headers["date"]) if headers.get("date") else None
    except (TypeError, ValueError):
        return None


def _message_text(payload: dict[str, Any]) -> str:
    """The text/plain part, else text/html stripped of tags. Depth-first through parts."""
    plain, rich = _find_part(payload, "text/plain"), _find_part(payload, "text/html")
    if plain:
        return plain
    if rich:
        return _html_to_text(rich)
    return ""


def _find_part(payload: dict[str, Any], mime: str) -> str:
    if payload.get("mimeType") == mime and (data := payload.get("body", {}).get("data")):
        return _b64(data)
    for part in payload.get("parts") or []:
        if found := _find_part(part, mime):
            return found
    return ""


def _b64(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")
    except (ValueError, TypeError):
        return ""


_TAG = re.compile(r"<[^>]+>")
_STYLE = re.compile(r"<(style|script)\b.*?</\1>", re.DOTALL | re.IGNORECASE)
_SPACE = re.compile(r"[ \t\r\f\v]+")
_QUOTE_START = re.compile(r"^(On .{5,200} wrote:|-{2,} ?Original Message ?-{2,}|From: .+)$", re.MULTILINE)


def _html_to_text(markup: str) -> str:
    text = _STYLE.sub(" ", markup)
    text = re.sub(r"<(br|/p|/div|/li|/tr)\b[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = html.unescape(_TAG.sub(" ", text))
    return "\n".join(_SPACE.sub(" ", line).strip() for line in text.splitlines() if line.strip())


def _strip_quoted(text: str) -> str:
    """Drop the quoted history under a reply. The thread already holds those messages."""
    match = _QUOTE_START.search(text)
    if match and match.start() > 0:
        text = text[: match.start()]
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith(">")).strip()


# --- Calendar ------------------------------------------------------------------------


class GoogleCalendarConnector(Connector):
    id = "google_calendar"
    toolkit = "googlecalendar"
    name = "Google Calendar"
    source = "google_calendar"
    sync_unit = "events"

    def sync(self, ctx: SyncContext) -> SyncBatch:
        cursor = dict(ctx.cursor)
        params: dict[str, Any] = {"maxResults": CALENDAR_EVENTS_PER_PAGE, "pageToken": cursor.get("page_token")}
        if cursor.get("sync_token"):
            params["syncToken"] = cursor["sync_token"]
        try:
            page = ctx.gateway.get(ctx.account_id, f"{CALENDAR}/events", params) or {}
        except ProviderNotFound:
            # 410 Gone: the sync token expired. Google's instruction is a full resync.
            return SyncBatch(documents=[], cursor={}, has_more=True)

        incremental = bool(cursor.get("sync_token"))
        documents: list[SourceDocument] = []
        deleted: list[str] = []
        for event in page.get("items", []):
            if event.get("status") == "cancelled":
                deleted.append(event["id"])
                continue
            start = _event_start(event)
            # A first sync lists the whole calendar (a time filter would forfeit the
            # sync token), so old history is skipped here instead.
            if not incremental and start and start < ctx.backfill_since.date():
                continue
            if doc := self._event(ctx, event, start):
                documents.append(doc)

        next_page = page.get("nextPageToken")
        if next_page:
            new_cursor = {**cursor, "page_token": next_page}
        else:
            new_cursor = {"sync_token": page.get("nextSyncToken") or cursor.get("sync_token")}
        return SyncBatch(documents=documents, cursor=new_cursor, deleted_refs=deleted,
                         has_more=bool(next_page), account_label=page.get("summary"))

    def _event(self, ctx: SyncContext, event: dict[str, Any], start: date | None) -> SourceDocument | None:
        attendees = [a for a in event.get("attendees", []) if not a.get("resource")]
        emails = [a["email"].lower() for a in attendees if a.get("email")]
        organizer = (event.get("organizer") or {}).get("email")
        if organizer and organizer.lower() not in emails and not organizer.endswith("calendar.google.com"):
            emails.append(organizer.lower())
        who = ", ".join(a.get("displayName") or a.get("email", "") for a in attendees[:25])
        when = _event_when(event)
        parts = [f"When: {when}" if when else "", f"Attendees: {who}" if who else "",
                 f"Where: {event['location']}" if event.get("location") else "",
                 _html_to_text(event.get("description") or "")]
        return SourceDocument(
            external_ref=event["id"],
            kind=BrainItemKind.MEETING,
            title=(event.get("summary") or "(untitled event)").strip(),
            body=clip("\n".join(p for p in parts if p)),
            occurred_on=start,
            participant_emails=emails,
            external=ctx.people.any_external(emails),
            url=event.get("htmlLink"),
        )


def _event_start(event: dict[str, Any]) -> date | None:
    start = event.get("start") or {}
    raw = start.get("dateTime") or start.get("date")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date() if "T" in raw else date.fromisoformat(raw)
    except ValueError:
        return None


def _event_when(event: dict[str, Any]) -> str:
    start = (event.get("start") or {})
    raw = start.get("dateTime") or start.get("date")
    if not raw:
        return ""
    try:
        if "T" in raw:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).strftime("%a %d %b %Y, %H:%M %Z").strip()
        return date.fromisoformat(raw).strftime("%a %d %b %Y (all day)")
    except ValueError:
        return raw


# --- Drive ---------------------------------------------------------------------------


class GoogleDriveConnector(Connector):
    id = "google_drive"
    toolkit = "googledrive"
    name = "Google Drive"
    source = "google_drive"
    sync_unit = "files"

    def sync(self, ctx: SyncContext) -> SyncBatch:
        cursor = dict(ctx.cursor)
        # Watermark: modifiedTime of the newest file already written. Strictly
        # greater-than, so the boundary file is not re-read every run.
        since = cursor.get("modified_after") or ctx.backfill_since.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S")
        page = ctx.gateway.get(ctx.account_id, f"{DRIVE}/files", {
            "q": f"trashed = false and mimeType != '{DRIVE_FOLDER}' and modifiedTime > '{since}'",
            "orderBy": "modifiedTime",
            "pageSize": DRIVE_FILES_PER_PAGE,
            "pageToken": cursor.get("page_token"),
            "fields": "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, description, "
                      "owners(emailAddress, displayName), lastModifyingUser(emailAddress, displayName))",
            "includeItemsFromAllDrives": "true",
            "supportsAllDrives": "true",
            "corpora": "user",
        }) or {}
        files = page.get("files", [])
        documents = [self._file(ctx, f) for f in files]
        newest = max((f.get("modifiedTime", "") for f in files), default="")
        next_page = page.get("nextPageToken")
        if next_page:
            # Mid-listing: keep the query's watermark, remember the furthest point seen.
            new_cursor = {"modified_after": cursor.get("modified_after"), "page_token": next_page,
                          "high_water": max(newest, cursor.get("high_water", ""))}
            if not new_cursor["modified_after"]:
                new_cursor["modified_after"] = since
        else:
            mark = max(newest, cursor.get("high_water", ""), cursor.get("modified_after") or "")
            new_cursor = {"modified_after": mark or since}
        return SyncBatch(documents=documents, cursor=new_cursor, has_more=bool(next_page))

    def _file(self, ctx: SyncContext, item: dict[str, Any]) -> SourceDocument:
        mime = item.get("mimeType", "")
        text = ""
        if export_as := DRIVE_TEXT_EXPORTS.get(mime):
            try:
                text = ctx.gateway.get_text(ctx.account_id, f"{DRIVE}/files/{item['id']}/export",
                                            {"mimeType": export_as})
            except ProviderNotFound:
                text = ""
        owners = [o["emailAddress"].lower() for o in item.get("owners", []) if o.get("emailAddress")]
        editor = (item.get("lastModifyingUser") or {}).get("emailAddress")
        people = owners + ([editor.lower()] if editor and editor.lower() not in owners else [])
        kind_label = _drive_kind(mime)
        header = f"{kind_label} in Google Drive" + (f" — {item['description']}" if item.get("description") else "")
        modified = item.get("modifiedTime")
        return SourceDocument(
            external_ref=item["id"],
            kind=BrainItemKind.DOCUMENT,
            title=item.get("name") or "(untitled)",
            body=clip(f"{header}\n\n{text}" if text else header),
            occurred_on=datetime.fromisoformat(modified.replace("Z", "+00:00")).date() if modified else None,
            participant_emails=people,
            external=bool(owners) and ctx.people.any_external(owners),
            url=item.get("webViewLink"),
        )


def _drive_kind(mime: str) -> str:
    return {
        "application/vnd.google-apps.document": "Google Doc",
        "application/vnd.google-apps.spreadsheet": "Google Sheet",
        "application/vnd.google-apps.presentation": "Google Slides deck",
        "application/pdf": "PDF",
    }.get(mime, "File")
