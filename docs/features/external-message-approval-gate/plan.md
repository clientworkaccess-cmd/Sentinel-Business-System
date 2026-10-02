# External Message Approval Gate Plan

Issue #19 (epic #2). Owner: claude-three-junior. Stacked on #18 (PR #29).

## Context

Sentinel already gates *tasks*: every extracted task waits in `approvals` until the
Owner decides. Connectors (#13 Slack/WhatsApp, #12 Gmail) will let Sentinel send
*messages*, some of them to clients. A message to someone outside the company must
never go out on model judgment. This feature extends the approval system from tasks
to words and makes it the only route to any sender.

## Locked decisions

- **One table, `outbound_messages`.** Channel (`email | whatsapp | slack |
  slack_connect | in_app`), audience (`internal | external`), status
  (`pending_approval → approved → sent | failed`, or `rejected`), recipient, subject,
  body, optional task context, who drafted it, who decided and when, the edit
  history, and delivery outcome.
- **Born pending.** The column defaults to `pending_approval` and `draft()` writes it
  explicitly. The draft API uses `extra="forbid"`, so passing `audience` or `status`
  is a 400, not a silent no-op.
- **Audience is computed, never accepted.** Internal only when the message names one
  of this company's employees on a channel that stays inside the company. The address
  is then copied from that employee's record, so a teammate's id can't be paired with
  a client's address. WhatsApp and Slack Connect are always external. A bare address
  is external. Sending both an employee id and an address is refused.
- **External needs a human, enforced by the database.** CHECK
  `ck_outbound_external_needs_human`: an external row can't be approved, sent or
  failed without `decided_by_user_id`. `dispatch()` re-checks this anyway.
- **Internal policy.** `companies.auto_send_internal_followups` (default off). When it
  is on, an internal draft is cleared with `approved_via = "policy"` and sent. It
  never touches external messages.
- **Senders only see permits.** Connectors implement `ChannelSender.send(permit)` and
  call `register_sender(channel, sender)`. A `SendPermit` can only be constructed
  inside `outbound_gate.py`, after the row has been re-read under `FOR UPDATE` and
  confirmed approved. There is no other registry.
- **Commit before dispatch.** Each route commits the decision first and dispatch
  second, so a crash mid-send can't roll back an approval and lead to a second send.
  Idempotency-Key on draft stops a retried request creating a duplicate.
- **Edit isn't deciding.** Edit changes subject/body only, keeps the AI's original in
  `edited_payload.original`, and leaves the message pending. To change the recipient,
  reject and redraft.
- **Audit in the same transaction.** Draft, auto-approve, approve, edit, reject,
  retry and every dispatch attempt each write an `audit_log` row atomically with the
  change. The body isn't copied into the log.
- **Roles** (agreed with claude-one on #29). The **Owner, or the Admin of the team a
  message belongs to**, may read, approve, edit, reject and retry it. A message belongs
  to the owner of its task, its internal recipient and its drafter. The gate is built
  with the caller's `Visibility`, so another team's message is a 404. Members can
  neither draft nor decide.
- **Failures are states, not errors.** A connector exception marks the message
  `failed` with a plain-English reason, logged in full server-side. Without a
  connector, an approved message waits with a reason, and `retry` re-dispatches
  without re-approving.

## API (`/api/v1/approvals/messages`)

- `GET ""`: queue, defaults to pending, filter by `status` and `audience`
- `POST ""`: draft (Owner/Admin), honours `Idempotency-Key`
- `GET /{id}`
- `POST /{id}/approve`, `/edit`, `/reject`, `/retry` (Owner, or the team's Admin)
- `PATCH /company` accepts `auto_send_internal_followups`

## Agent

The Owner's chat agent gets `draft_message` (`app/agentic_ai/tools/outbound_tools.py`).
It can only draft. It addresses teammates by name, refuses ambiguous names, and its
external drafts land in the queue like anyone else's.

## Verification

`python -m scripts.verify_outbound` registers fake senders and checks:
- classification
- refused smuggling attempts
- role gates and cross-tenant 404s
- edit/approve/reject finality and auditing
- policy scope
- the DB constraint and the permit boundary
- failure and retry
- the agent tool
