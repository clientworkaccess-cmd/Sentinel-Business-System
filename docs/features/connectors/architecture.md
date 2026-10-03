# Connectors — architecture (#11, #12, #13)

## Decision: Composio, Composio-managed OAuth

Alyan chose Composio (Slack, 2026-10-02). Composio runs the consent screens with its own
OAuth apps (no custom branding), stores and refreshes every token, and proxies our calls to
the providers. **Sentinel never holds a provider token**: `connections` stores only Composio's
connected-account id, so a database leak exposes no credential and nothing can leak a token
to the frontend or the logs.

| Concern | How |
|---|---|
| Consent | `connected_accounts.link()` (the older `initiate()` is retired for managed auth) |
| Data | `tools.proxy()` → the provider's own REST API, authenticated by Composio |
| Why proxy, not Composio tools | Real incremental sync (Gmail `historyId`, Calendar `syncToken`), documented response shapes, no toolkit-version pin to drift |
| SDK | `composio==0.22.0` (0.23+ pin a pre-release `composio-client`) |

## Flow

```
Gallery ── POST /connectors/{id}/connect ──► Composio link ──► Google / Slack consent
                                                                    │
FRONTEND_URL/brain/connectors?result=… ◄── 303 ── GET /connectors/callback?state=… ◄──┘
                                                       │  re-reads the account from Composio,
                                                       │  checks it is this user's, marks active
                                                       └─► background: first sync
Scheduler (every 5 min) ── due connections ──► runner.sync_connection ──► connector.sync()
                                                     │                        (one page)
                                                     └─► ingest.write_batch ──► brain_items
                                                          commit(items + cursor)
                                                          then mirror ──► HydraDB
```

## Modules (`backend/app/connectors/`)

- `gateway.py` — the only Composio caller. Translates failures into `ProviderAuthError`
  (reconnect), `ProviderRateLimited` (retry later), `ProviderNotFound` (cursor expired),
  `ProviderError`. Retries 429/5xx with backoff; Google's 403 quota errors count as 429.
- `base.py` — `Connector.sync(ctx) -> SyncBatch(documents, cursor, deleted_refs, has_more)`.
  Connectors never touch the database.
- `google.py` — Gmail (thread items; backfill, then `users.history`), Calendar (meeting
  items; `syncToken`, 410 → full resync, cancellations delete), Drive (document items;
  `modifiedTime` watermark; Docs and Slides exported as text, other files by metadata).
- `slack.py` — public channels the person is in; a thread is one item, the rest of a
  channel's day is one item; people matched by profile email, which also fills
  `employees.slack_user_id`. Private channels and DMs are never read.
- `ingest.py` — upserts by `(source, external_ref)`. Personal sources key per connection
  (two mailboxes keep their own copies); Slack keys per workspace (no duplicates when
  several people connect it).
- `runner.py` — lease via conditional UPDATE (`sync_started_at`), so one sync per connection
  across all workers; items and cursor commit together; MAX_BATCHES per run.
- `service.py` — connect / callback / status / disconnect. The callback's `state` is a
  30-minute JWT whose claims cannot pass as a login token.

## Visibility

Every synced item's owners are the connecting person plus every participant who resolves to
an employee (by email, or Slack id). The normal Owner / Admin / Member rules then apply:
Alyan's mail is visible to Alyan, his Admin and the Owner, and to no one else.

## Configuration (`backend/.env`)

`COMPOSIO_API_KEY` (required to connect), optional `COMPOSIO_AUTH_CONFIG_<TOOLKIT>` pins,
`PUBLIC_API_URL` (callback host), `FRONTEND_URL`, `CONNECTOR_SYNC_INTERVAL_MINUTES` (30),
`CONNECTOR_BACKFILL_DAYS` (90).

## Known limits

- Slack replies added to a thread older than a channel's last-synced day are not picked up
  until the thread's day is re-read. Fixable later with `conversations.replies` on recent roots.
- Drive deletions are not detected (the watermark only sees modified files); Gmail deletions
  likewise. Both disappear on disconnect.
- Large first syncs are spread over several 5-minute runs (MAX_BATCHES = 40 pages per run).

## Verification

`python -m scripts.verify_connectors` — 85 checks against a real database, with Composio,
Google and Slack faked at the gateway.
