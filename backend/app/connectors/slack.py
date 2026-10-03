"""Slack connector (#13).

Reads the **public channels the connecting person is a member of**, through Slack's
Web API on the Composio proxy. Private channels and DMs are deliberately out of
scope: the brain is shared with Owners and Admins, and a DM is not company knowledge.

What becomes an item:

* a **thread** (a message with replies) → one THREAD item, root plus replies;
* the rest of a channel's day → one THREAD item per channel per day.

Both are keyed by workspace + channel (+ thread ts or day), not by who synced them,
so two people connecting the same workspace produce one item, not two.

People are matched by the email on their Slack profile. A match also fills in
``employees.slack_user_id``, which outbound Slack messages (#19) need.

Incremental: each channel keeps the ts of its newest message seen. The next run
re-reads from the start of that message's day, so the day item is rebuilt whole
rather than overwritten with only the newest messages.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from app.connectors.base import Connector, SourceDocument, SyncBatch, SyncContext, clip
from app.connectors.gateway import ProviderAuthError, ProviderError, ProviderRateLimited
from app.models.enums import BrainItemKind

SLACK = "https://slack.com/api"
#: Threads expanded per channel per run. Each is one conversations.replies call.
THREADS_PER_CHANNEL = 30
HISTORY_PAGES_PER_CHANNEL = 5
#: Slack errors that mean the grant is gone.
AUTH_ERRORS = frozenset({"invalid_auth", "token_revoked", "account_inactive", "not_authed",
                         "token_expired", "no_permission", "org_login_required"})
#: Bot and housekeeping messages that carry no knowledge.
SKIPPED_SUBTYPES = frozenset({"channel_join", "channel_leave", "channel_topic", "channel_purpose",
                              "channel_name", "bot_add", "bot_remove", "pinned_item", "tombstone"})
_MENTION = re.compile(r"<@([UW][A-Z0-9]+)(?:\|[^>]*)?>")
_CHANNEL_REF = re.compile(r"<#[CG][A-Z0-9]+\|([^>]*)>")
_LINK = re.compile(r"<(https?://[^|>]+)\|([^>]+)>")
_BARE_LINK = re.compile(r"<(https?://[^>]+)>")


class SlackConnector(Connector):
    id = "slack"
    toolkit = "slack"
    name = "Slack"
    source = "slack"
    sync_unit = "threads"
    #: Keyed by workspace, not by account: see the module docstring.
    personal = False

    def sync(self, ctx: SyncContext) -> SyncBatch:
        cursor = dict(ctx.cursor)
        identity = self._identity(ctx)
        team = identity["team_id"]
        users = self._users(ctx)

        if not cursor.get("queue"):
            # Start of a pass: every public channel the person is in, oldest-synced first.
            channels = self._channels(ctx)
            latest: dict[str, str] = dict(cursor.get("latest", {}))
            cursor["queue"] = sorted(channels, key=lambda c: latest.get(c, "0"))
            cursor["names"] = {cid: meta for cid, meta in channels.items()}
            cursor.setdefault("latest", latest)
            if not cursor["queue"]:
                return SyncBatch(documents=[], cursor=_strip(cursor), account_label=identity["label"],
                                 identities=users.emails)

        channel = cursor["queue"].pop(0)
        meta = cursor["names"].get(channel, {"name": channel, "external": False})
        last_ts = cursor["latest"].get(channel)
        if last_ts:
            day_start = datetime.fromtimestamp(float(last_ts), tz=UTC).replace(hour=0, minute=0, second=0,
                                                                               microsecond=0)
            oldest = day_start.timestamp()
        else:
            oldest = ctx.backfill_since.timestamp()

        messages = self._history(ctx, channel, oldest)
        documents = self._documents(ctx, team, channel, meta, messages, users)
        if messages:
            cursor["latest"][channel] = max(m["ts"] for m in messages)
        has_more = bool(cursor["queue"])
        out = cursor if has_more else _strip(cursor)
        return SyncBatch(documents=documents, cursor=out, has_more=has_more,
                         account_label=identity["label"], identities=users.emails)

    # --- Slack API ---------------------------------------------------------------------

    def _call(self, ctx: SyncContext, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        data = ctx.gateway.get(ctx.account_id, f"{SLACK}/{method}", params) or {}
        if not isinstance(data, dict):
            raise ProviderError("Slack returned an unexpected response.")
        if data.get("ok") is False:
            error = str(data.get("error") or "unknown_error")
            if error in AUTH_ERRORS:
                raise ProviderAuthError("Slack no longer accepts this connection. Reconnect it.")
            if error == "ratelimited":
                raise ProviderRateLimited("Slack is rate-limiting us. Sync will resume later.")
            if error == "missing_scope":
                raise ProviderError("The Slack connection is missing a permission Sentinel needs. Reconnect it.")
            raise ProviderError(f"Slack refused the request ({error}).")
        return data

    def _identity(self, ctx: SyncContext) -> dict[str, str]:
        if "slack_identity" not in ctx.scratch:
            me = self._call(ctx, "auth.test")
            ctx.scratch["slack_identity"] = {
                "team_id": me.get("team_id", ""),
                "label": f"{me.get('team') or 'Slack'} ({me.get('user') or 'you'})",
            }
        return ctx.scratch["slack_identity"]

    def _users(self, ctx: SyncContext) -> _Users:
        if "slack_users" not in ctx.scratch:
            names: dict[str, str] = {}
            emails: dict[str, str] = {}
            next_cursor = None
            for _ in range(20):
                page = self._call(ctx, "users.list", {"limit": 200, "cursor": next_cursor})
                for member in page.get("members", []):
                    if member.get("deleted") or member.get("is_bot") or member.get("id") == "USLACKBOT":
                        continue
                    profile = member.get("profile") or {}
                    names[member["id"]] = (profile.get("display_name") or profile.get("real_name")
                                           or member.get("real_name") or member.get("name") or member["id"])
                    if email := (profile.get("email") or "").strip().lower():
                        emails[member["id"]] = email
                next_cursor = (page.get("response_metadata") or {}).get("next_cursor")
                if not next_cursor:
                    break
            ctx.scratch["slack_users"] = _Users(names, emails)
        return ctx.scratch["slack_users"]

    def _channels(self, ctx: SyncContext) -> dict[str, dict[str, Any]]:
        channels: dict[str, dict[str, Any]] = {}
        next_cursor = None
        for _ in range(20):
            page = self._call(ctx, "users.conversations", {
                "types": "public_channel", "exclude_archived": "true", "limit": 200, "cursor": next_cursor,
            })
            for channel in page.get("channels", []):
                channels[channel["id"]] = {
                    "name": channel.get("name") or channel["id"],
                    # Slack Connect: people from another organisation are in the room.
                    "external": bool(channel.get("is_ext_shared") or channel.get("is_shared")),
                }
            next_cursor = (page.get("response_metadata") or {}).get("next_cursor")
            if not next_cursor:
                break
        return channels

    def _history(self, ctx: SyncContext, channel: str, oldest: float) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        next_cursor = None
        for _ in range(HISTORY_PAGES_PER_CHANNEL):
            page = self._call(ctx, "conversations.history", {
                "channel": channel, "oldest": f"{oldest:.6f}", "limit": 200, "cursor": next_cursor,
            })
            messages.extend(m for m in page.get("messages", []) if _keep(m))
            next_cursor = (page.get("response_metadata") or {}).get("next_cursor")
            if not (page.get("has_more") and next_cursor):
                break
        return messages

    def _replies(self, ctx: SyncContext, channel: str, ts: str) -> list[dict[str, Any]]:
        page = self._call(ctx, "conversations.replies", {"channel": channel, "ts": ts, "limit": 200})
        return [m for m in page.get("messages", []) if _keep(m)]

    # --- shaping -----------------------------------------------------------------------

    def _documents(self, ctx: SyncContext, team: str, channel: str, meta: dict[str, Any],
                   messages: list[dict[str, Any]], users: _Users) -> list[SourceDocument]:
        name = meta.get("name", channel)
        roots = [m for m in messages if int(m.get("reply_count") or 0) > 0]
        roots.sort(key=lambda m: m.get("latest_reply") or m["ts"], reverse=True)
        threaded = {m["ts"] for m in roots[:THREADS_PER_CHANNEL]}
        documents: list[SourceDocument] = []

        for root in roots[:THREADS_PER_CHANNEL]:
            thread = self._replies(ctx, channel, root["ts"]) or [root]
            documents.append(self._doc(
                ref=f"{team}:{channel}:{root['ts']}",
                title=f"#{name}: {_headline(_text(root, users))}",
                messages=thread, users=users, meta=meta,
                url=None,
            ))

        by_day: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for message in messages:
            if message["ts"] in threaded or message.get("thread_ts") not in (None, message["ts"]):
                continue  # in a thread item already, or a reply surfaced in history
            day = datetime.fromtimestamp(float(message["ts"]), tz=UTC).date().isoformat()
            by_day[day].append(message)
        for day, day_messages in by_day.items():
            day_messages.sort(key=lambda m: float(m["ts"]))
            pretty = datetime.fromisoformat(day).strftime("%d %b %Y")
            documents.append(self._doc(
                ref=f"{team}:{channel}:{day}",
                title=f"#{name} on {pretty}",
                messages=day_messages, users=users, meta=meta, url=None,
            ))
        return documents

    def _doc(self, *, ref: str, title: str, messages: list[dict[str, Any]], users: _Users,
             meta: dict[str, Any], url: str | None) -> SourceDocument:
        people = list(dict.fromkeys(m["user"] for m in messages if m.get("user")))
        lines = [f"{users.name(m.get('user'))}: {_text(m, users)}" for m in messages]
        newest = max(float(m["ts"]) for m in messages)
        return SourceDocument(
            external_ref=ref,
            kind=BrainItemKind.THREAD,
            title=clip(title, 480),
            body=clip("\n".join(lines)),
            occurred_on=datetime.fromtimestamp(newest, tz=UTC).date(),
            participant_slack_ids=people,
            participant_emails=[users.emails[p] for p in people if p in users.emails],
            external=bool(meta.get("external")),
            url=url,
        )


class _Users:
    def __init__(self, names: dict[str, str], emails: dict[str, str]) -> None:
        self.names = names
        #: Slack user id → profile email. Feeds employees.slack_user_id.
        self.emails = emails

    def name(self, user_id: str | None) -> str:
        return self.names.get(user_id or "", user_id or "Someone")


def _keep(message: dict[str, Any]) -> bool:
    if message.get("subtype") in SKIPPED_SUBTYPES or message.get("bot_id"):
        return False
    return bool((message.get("text") or "").strip() or message.get("files"))


def _text(message: dict[str, Any], users: _Users) -> str:
    text = message.get("text") or ""
    text = _MENTION.sub(lambda m: "@" + users.name(m.group(1)), text)
    text = _CHANNEL_REF.sub(lambda m: "#" + m.group(1), text)
    text = _LINK.sub(lambda m: f"{m.group(2)} ({m.group(1)})", text)
    text = _BARE_LINK.sub(lambda m: m.group(1), text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    files = [f.get("name") or f.get("title") for f in message.get("files", []) if f.get("name") or f.get("title")]
    if files:
        text = (text + " " if text else "") + "[shared: " + ", ".join(files) + "]"
    return text.strip()


def _headline(text: str, limit: int = 80) -> str:
    first = text.splitlines()[0] if text else "thread"
    return first if len(first) <= limit else first[: limit - 1].rstrip() + "…"


def _strip(cursor: dict[str, Any]) -> dict[str, Any]:
    """End of a pass: keep only the per-channel marks."""
    return {"latest": cursor.get("latest", {})}

