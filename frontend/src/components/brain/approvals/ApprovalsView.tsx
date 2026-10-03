'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api';
import {
  approveMessage, approveTask, bulkApproveTasks, editMessage, editTask, getTaskApproval, isRetryable,
  listEmployees, listMessageApprovals, listTaskApprovals, rejectMessage, rejectTask, retryMessage,
  type ApprovalEditPayload, type ApprovalEmployee, type ApprovalSummary, type OutboundMessage,
} from '@/lib/approvalsApi';
import { useAuthStore } from '@/stores/useAuthStore';
import { isOwnerRole } from '@/types';
import { cn } from '@/lib/utils';
import { MessageApprovalCard } from './MessageApprovalCard';
import { TaskApprovalCard, type DetailState } from './TaskApprovalCard';
import { EmptyState, InlineError, ListSkeleton, useQueue } from './shared';

type Tab = 'tasks' | 'messages';

/** Below this, every card's confidence is fetched up front; above it, on expand. */
const EAGER_DETAIL_LIMIT = 20;

export function ApprovalsView() {
  const user = useAuthStore((s) => s.user);
  const loadCurrentUser = useAuthStore((s) => s.loadCurrentUser);
  const [authError, setAuthError] = useState<string | null>(null);

  // /brain signs in through the session store; the role here comes from /auth/me.
  useEffect(() => {
    if (user) return;
    loadCurrentUser().catch((err) => setAuthError(apiErrorMessage(err, 'Could not load your account.')));
  }, [user, loadCurrentUser]);

  const canTasks = isOwnerRole(user?.role);
  const canMessages = canTasks || user?.role === 'admin';

  return (
    <div className="space-y-6 min-w-0">
      <div>
        <h1 className="font-display text-[32px] leading-tight text-ink-black">Approvals</h1>
        <p className="text-sm text-warm-gray mt-1">
          Review what Sentinel extracted or drafted before anything is saved or sent.
        </p>
      </div>

      {!user ? (
        authError ? <InlineError message={authError} /> : <ListSkeleton />
      ) : !canTasks && !canMessages ? (
        <p className="text-sm text-warm-gray">Only Owners and Admins can review approvals.</p>
      ) : (
        <Queues canTasks={canTasks} canMessages={canMessages} />
      )}
    </div>
  );
}

function Queues({ canTasks, canMessages }: { canTasks: boolean; canMessages: boolean }) {
  const [tab, setTab] = useState<Tab>(canTasks ? 'tasks' : 'messages');
  const tasks = useQueue<ApprovalSummary>();
  const messages = useQueue<OutboundMessage>();
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [employees, setEmployees] = useState<ApprovalEmployee[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  const { setItems: setTaskItems } = tasks;
  const { setItems: setMessageItems } = messages;

  const loadDetail = useCallback(async (id: string) => {
    setDetails((d) => ({ ...d, [id]: { status: 'loading' } }));
    try {
      const detail = await getTaskApproval(id);
      setDetails((d) => ({ ...d, [id]: { status: 'ready', detail } }));
    } catch (err) {
      setDetails((d) => ({ ...d, [id]: { status: 'error', message: apiErrorMessage(err, 'Could not load the source.') } }));
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setTasksError(null);
    try {
      const items = await listTaskApprovals();
      setTaskItems(items);
      if (items.length <= EAGER_DETAIL_LIMIT) items.forEach((a) => void loadDetail(a.id));
    } catch (err) {
      setTasksError(apiErrorMessage(err, 'Could not load the task queue.'));
      setTaskItems((prev) => prev ?? []);
    }
  }, [setTaskItems, loadDetail]);

  const loadMessages = useCallback(async () => {
    setMessagesError(null);
    try {
      setMessageItems(await listMessageApprovals());
    } catch (err) {
      setMessagesError(apiErrorMessage(err, 'Could not load the message queue.'));
      setMessageItems((prev) => prev ?? []);
    }
  }, [setMessageItems]);

  useEffect(() => {
    if (canTasks) {
      void loadTasks();
      listEmployees().then(setEmployees).catch(() => setEmployees([]));
    }
    if (canMessages) void loadMessages();
  }, [canTasks, canMessages, loadTasks, loadMessages]);

  /* ── Task actions ── */

  const approveOne = (a: ApprovalSummary) => tasks.decide(a, () => approveTask(a.id), 'Could not approve this task.');
  const rejectOne = (a: ApprovalSummary, reason: string) =>
    tasks.decide(a, () => rejectTask(a.id, reason), 'Could not reject this task.');

  const saveTask = async (a: ApprovalSummary, payload: ApprovalEditPayload) => {
    try {
      const detail = await editTask(a.id, payload);
      const { task } = detail;
      tasks.replace({
        ...a,
        state: detail.state,
        task: {
          id: task.id, title: task.title, status: task.status, deadline: task.deadline,
          owner_employee_id: task.owner_employee_id, owner_name: task.owner_name, days_late: task.days_late,
        },
      });
      setDetails((d) => ({ ...d, [a.id]: { status: 'ready', detail } }));
      tasks.setError(a.id, null);
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Could not save the changes.'));
    }
  };

  const approveAll = async () => {
    const all = tasks.items ?? [];
    if (all.length === 0) return;
    const ids = all.map((a) => a.id);
    const rows = tasks.positions(ids).map(({ index }, i) => ({ item: all[i], index }));
    setBulkBusy(true);
    setBulkNotice(null);
    tasks.remove(ids);
    try {
      // The endpoint takes at most 200 ids per call.
      const skipped: { id: string; reason: string }[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const res = await bulkApproveTasks(ids.slice(i, i + 200));
        skipped.push(...res.skipped);
      }
      if (skipped.length > 0) {
        setBulkNotice(
          `${skipped.length} could not be approved: ${skipped[0].reason}${skipped.length > 1 ? ' (and others)' : ''}`,
        );
        await loadTasks();
      }
    } catch (err) {
      tasks.restore(rows);
      setBulkNotice(apiErrorMessage(err, 'Could not approve the queue.'));
    } finally {
      setBulkBusy(false);
    }
  };

  /* ── Message actions ── */

  // A message that was approved but could not be delivered comes back for a retry.
  const keepIfRetryable = (m: OutboundMessage) => (isRetryable(m) ? m : null);

  const approveMsg = (m: OutboundMessage) =>
    messages.decide(m, () => approveMessage(m.id), 'Could not approve this message.', keepIfRetryable);
  const rejectMsg = (m: OutboundMessage, reason: string) =>
    messages.decide(m, () => rejectMessage(m.id, reason), 'Could not reject this message.');
  const retryMsg = (m: OutboundMessage) =>
    messages.decide(m, () => retryMessage(m.id), 'Could not retry this message.', keepIfRetryable);

  const saveMsg = async (m: OutboundMessage, payload: { subject?: string | null; body?: string }) => {
    try {
      messages.replace(await editMessage(m.id, payload));
      messages.setError(m.id, null);
    } catch (err) {
      throw new Error(apiErrorMessage(err, 'Could not save the changes.'));
    }
  };

  /* ── Render ── */

  const taskCount = tasks.items?.length ?? 0;
  const messageCount = messages.items?.length ?? 0;
  const tabs: [Tab, string][] = [
    ...(canTasks ? [['tasks', `Tasks · ${taskCount}`] as [Tab, string]] : []),
    ...(canMessages ? [['messages', `Messages · ${messageCount}`] as [Tab, string]] : []),
  ];

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Approval queues" className="flex gap-1.5 flex-wrap">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'shrink-0 px-3 h-8 rounded-full text-xs font-medium border transition whitespace-nowrap tabular-nums',
                tab === key ? 'bg-inverse text-white border-transparent' : 'bg-white border-stone-border text-warm-gray hover:text-ink-black',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'tasks' && taskCount > 0 && (
          <button
            type="button"
            onClick={approveAll}
            disabled={bulkBusy}
            className="btn-cyan text-xs inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
            Approve all ({taskCount})
          </button>
        )}
      </div>

      {tab === 'tasks' ? (
        <section role="tabpanel" aria-label="Tasks" className="space-y-3 min-w-0">
          {tasksError && <InlineError message={tasksError} />}
          {bulkNotice && <InlineError message={bulkNotice} />}
          {tasks.items === null ? (
            <ListSkeleton />
          ) : tasks.items.length === 0 ? (
            !tasksError && <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-3 min-w-0">
              {tasks.items.map((a) => (
                <TaskApprovalCard
                  key={a.id}
                  approval={a}
                  detail={details[a.id]}
                  employees={employees}
                  error={tasks.errors[a.id]}
                  onNeedDetail={() => void loadDetail(a.id)}
                  onApprove={() => void approveOne(a)}
                  onReject={(reason) => void rejectOne(a, reason)}
                  onSave={(payload) => saveTask(a, payload)}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section role="tabpanel" aria-label="Messages" className="space-y-3 min-w-0">
          {messagesError && <InlineError message={messagesError} />}
          {messages.items === null ? (
            <ListSkeleton />
          ) : messages.items.length === 0 ? (
            !messagesError && <EmptyState />
          ) : (
            <div className="grid grid-cols-1 gap-3 min-w-0">
              {messages.items.map((m) => (
                <MessageApprovalCard
                  key={m.id}
                  message={m}
                  error={messages.errors[m.id]}
                  onApprove={() => void approveMsg(m)}
                  onReject={(reason) => void rejectMsg(m, reason)}
                  onRetry={() => void retryMsg(m)}
                  onSave={(payload) => saveMsg(m, payload)}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
