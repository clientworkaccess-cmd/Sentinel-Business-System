/**
 * Approval queues against the real backend.
 *
 * Task approvals:    backend/app/api/v1/approvals.py   (Owner only)
 * Message approvals: backend/app/api/v1/outbound.py    (Owner, or the Admin of the message's team)
 *
 * Shapes mirror backend/app/schemas/{approval,task,outbound,employee}.py. They are kept
 * local to this module rather than in types/index.ts.
 */
import { api } from './api';

/* ── Tasks ─────────────────────────────────────────────────────────────── */

export type ApprovalState = 'pending' | 'approved' | 'edited' | 'rejected';

export type ApprovalTaskStatus =
  | 'pending_approval'
  | 'approved'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'rejected';

/** schemas/task.py · TaskSummary */
export interface ApprovalTaskSummary {
  id: string;
  title: string;
  status: ApprovalTaskStatus;
  deadline: string | null;
  owner_employee_id: string | null;
  owner_name: string | null;
  days_late: number | null;
}

/** schemas/task.py · TaskDetail (status_updates omitted; not used here) */
export interface ApprovalTaskDetail extends ApprovalTaskSummary {
  description: string | null;
  source_quote: string | null;
  source_ref: string | null;
  confidence: number | null;
  created_by_agent: string | null;
  created_at: string;
  updated_at: string;
}

/** schemas/approval.py · ApprovalSummary */
export interface ApprovalSummary {
  id: string;
  task_id: string;
  state: ApprovalState;
  created_at: string;
  task: ApprovalTaskSummary;
}

/** schemas/approval.py · ApprovalDetail */
export interface ApprovalDetail {
  id: string;
  task_id: string;
  state: ApprovalState;
  decided_by_user_id: string | null;
  decided_at: string | null;
  edited_payload: Record<string, unknown> | null;
  rejection_reason: string | null;
  created_at: string;
  task: ApprovalTaskDetail;
}

/** schemas/task.py · TaskUpdate. Only the fields sent are changed; status is ignored on edit. */
export interface ApprovalEditPayload {
  title?: string;
  description?: string;
  owner_employee_id?: string;
  deadline?: string;
}

export interface BulkApproveResult {
  approved: string[];
  skipped: { id: string; reason: string }[];
}

export async function listTaskApprovals(): Promise<ApprovalSummary[]> {
  const res = await api.get<{ items: ApprovalSummary[]; total: number }>('/approvals');
  return res.data.items;
}

export async function getTaskApproval(id: string): Promise<ApprovalDetail> {
  const res = await api.get<ApprovalDetail>(`/approvals/${id}`);
  return res.data;
}

export async function approveTask(id: string): Promise<ApprovalDetail> {
  const res = await api.post<ApprovalDetail>(`/approvals/${id}/approve`);
  return res.data;
}

export async function rejectTask(id: string, reason?: string): Promise<ApprovalDetail> {
  const res = await api.post<ApprovalDetail>(`/approvals/${id}/reject`, { reason: reason?.trim() || null });
  return res.data;
}

export async function editTask(id: string, payload: ApprovalEditPayload): Promise<ApprovalDetail> {
  const res = await api.post<ApprovalDetail>(`/approvals/${id}/edit`, payload);
  return res.data;
}

export async function bulkApproveTasks(ids: string[]): Promise<BulkApproveResult> {
  const res = await api.post<BulkApproveResult>('/approvals/bulk-approve', { approval_ids: ids });
  return res.data;
}

/* ── Employees (owner picker) ──────────────────────────────────────────── */

/** schemas/employee.py · EmployeeSummary (the fields used here) */
export interface ApprovalEmployee {
  id: string;
  name: string;
  role_title: string | null;
}

export async function listEmployees(): Promise<ApprovalEmployee[]> {
  const res = await api.get<{ items: ApprovalEmployee[]; total: number }>('/employees');
  return res.data.items;
}

/* ── Outbound messages ─────────────────────────────────────────────────── */

export type MessageChannel = 'email' | 'whatsapp' | 'slack' | 'slack_connect' | 'in_app';
export type MessageAudience = 'internal' | 'external';
export type OutboundStatus = 'pending_approval' | 'approved' | 'rejected' | 'sent' | 'failed';

/** schemas/outbound.py · OutboundMessageRead */
export interface OutboundMessage {
  id: string;
  channel: MessageChannel;
  audience: MessageAudience;
  status: OutboundStatus;
  recipient_address: string;
  recipient_name: string | null;
  recipient_employee_id: string | null;
  subject: string | null;
  body: string;
  task_id: string | null;
  thread_ref: string | null;
  drafted_by_agent: string | null;
  drafted_by_user_id: string | null;
  approved_via: string | null;
  decided_by_user_id: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  edited_payload: Record<string, unknown> | null;
  sent_at: string | null;
  delivery_error: string | null;
  created_at: string;
}

/**
 * Retryable per OutboundGate.retry: a failed send, or an approved message that was
 * never handed to a sender (delivery_error set, no sent_at).
 */
export const isRetryable = (m: OutboundMessage) =>
  m.status === 'failed' || (m.status === 'approved' && !!m.delivery_error && !m.sent_at);

/** What belongs in the queue: undecided drafts plus anything that needs a retry. */
export const needsAttention = (m: OutboundMessage) => m.status === 'pending_approval' || isRetryable(m);

export async function listMessageApprovals(): Promise<OutboundMessage[]> {
  // `status` is a repeated query param (list[OutboundStatus]); axios's default
  // `status[]=` form would not bind, so the query string is built by hand.
  const qs = new URLSearchParams();
  for (const s of ['pending_approval', 'failed', 'approved'] as OutboundStatus[]) qs.append('status', s);
  qs.set('limit', '200');
  const res = await api.get<{ items: OutboundMessage[]; total: number }>(`/approvals/messages?${qs.toString()}`);
  return res.data.items.filter(needsAttention);
}

export async function approveMessage(id: string): Promise<OutboundMessage> {
  const res = await api.post<OutboundMessage>(`/approvals/messages/${id}/approve`);
  return res.data;
}

export async function rejectMessage(id: string, reason?: string): Promise<OutboundMessage> {
  const res = await api.post<OutboundMessage>(`/approvals/messages/${id}/reject`, { reason: reason?.trim() || null });
  return res.data;
}

export async function editMessage(id: string, payload: { subject?: string | null; body?: string }): Promise<OutboundMessage> {
  const res = await api.post<OutboundMessage>(`/approvals/messages/${id}/edit`, payload);
  return res.data;
}

export async function retryMessage(id: string): Promise<OutboundMessage> {
  const res = await api.post<OutboundMessage>(`/approvals/messages/${id}/retry`);
  return res.data;
}
