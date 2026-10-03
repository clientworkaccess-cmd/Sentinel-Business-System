'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyRound, ListPlus, Loader2, Trash2, UserPlus, X } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api';
import {
  bulkImport,
  conflictTasks,
  createLogin,
  createMember,
  deleteMember,
  getMemberEmail,
  listMembers,
  parseBulk,
  type BulkResult,
  type LoginRole,
  type TeamMember,
} from '@/lib/settingsApi';
import { cn } from '@/lib/utils';
import { Card, SectionTitle } from '../atoms';
import { ErrorLine, Field, SuccessLine, inputClass, textareaClass } from './fields';

type Panel = 'add' | 'bulk' | null;

export function TeamPanel() {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [loginFor, setLoginFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const items = await listMembers();
      setMembers(items);
      // The list response carries no email; the detail does. Fill it in per member.
      const emails = await Promise.allSettled(items.map((m) => getMemberEmail(m.id)));
      const byId = new Map(items.map((m, i) => [m.id, emails[i].status === 'fulfilled' ? emails[i].value : undefined]));
      setMembers((cur) => cur?.map((m) => (byId.has(m.id) ? { ...m, email: byId.get(m.id) } : m)) ?? cur);
    } catch (err) {
      setLoadError(apiErrorMessage(err, 'Could not load the team.'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameById = useMemo(() => new Map((members ?? []).map((m) => [m.id, m.name])), [members]);
  const sorted = useMemo(() => [...(members ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [members]);

  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Team members"
        hint={members ? `${members.length} ${members.length === 1 ? 'person' : 'people'}` : undefined}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={() => toggle('bulk')}
              aria-expanded={panel === 'bulk'}
              className={cn('btn-ghost text-xs px-3 py-1.5 inline-flex items-center gap-1.5', panel === 'bulk' && 'border-cyan-edge/60')}
            >
              <ListPlus className="w-3.5 h-3.5" /> Add several
            </button>
            <button
              onClick={() => toggle('add')}
              aria-expanded={panel === 'add'}
              className="btn-cyan text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" /> Add member
            </button>
          </div>
        }
      />

      {panel === 'add' && (
        <AddMemberForm
          members={sorted}
          onCancel={() => setPanel(null)}
          onAdded={() => { setPanel(null); load(); }}
        />
      )}
      {panel === 'bulk' && <BulkForm onCancel={() => setPanel(null)} onImported={load} />}

      {loadError ? (
        <Card className="p-5 space-y-3">
          <ErrorLine message={loadError} />
          <button onClick={load} className="btn-ghost text-xs px-3 py-1.5">Try again</button>
        </Card>
      ) : !members ? (
        <Card className="p-6 flex items-center gap-2 text-sm text-warm-gray">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading team…
        </Card>
      ) : members.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-ink-black">No team members yet.</p>
          <p className="text-xs text-warm-gray mt-1">Add people one at a time, or several at once.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_9rem_auto] gap-4 px-5 py-2.5 border-b border-stone-border text-[11px] uppercase tracking-wider text-ash-gray">
            <span>Name</span>
            <span>Role title</span>
            <span>Email</span>
            <span>Manager</span>
            <span>Login</span>
            <span className="w-[4.5rem]" aria-hidden="true" />
          </div>
          <ul className="divide-y divide-stone-border">
            {sorted.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                managerName={m.manager_id ? nameById.get(m.manager_id) : undefined}
                loginOpen={loginFor === m.id}
                onOpenLogin={() => setLoginFor(loginFor === m.id ? null : m.id)}
                onLoginCreated={() => {
                  setLoginFor(null);
                  setMembers((cur) => cur?.map((x) => (x.id === m.id ? { ...x, has_login: true } : x)) ?? cur);
                }}
                onDeleted={() => setMembers((cur) => cur?.filter((x) => x.id !== m.id) ?? cur)}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function MemberRow({
  member: m,
  managerName,
  loginOpen,
  onOpenLogin,
  onLoginCreated,
  onDeleted,
}: {
  member: TeamMember;
  managerName?: string;
  loginOpen: boolean;
  onOpenLogin: () => void;
  onLoginCreated: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<{ message: string; tasks: string[] } | null>(null);

  // A confirm that is not followed through quietly resets.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const remove = async () => {
    if (!confirming) return setConfirming(true);
    setConfirming(false);
    setDeleting(true);
    setError(null);
    try {
      await deleteMember(m.id);
      onDeleted();
    } catch (err) {
      setError({ message: apiErrorMessage(err, `Could not delete ${m.name}.`), tasks: conflictTasks(err) });
      setDeleting(false);
    }
  };

  return (
    <li className="px-4 sm:px-5 py-3">
      <div className="flex flex-col gap-2 md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_9rem_auto] md:items-center md:gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-black truncate">{m.name}</p>
          <p className="md:hidden text-xs text-warm-gray truncate">
            {[m.role_title, managerName && `Reports to ${managerName}`].filter(Boolean).join(' · ') || 'No role title'}
          </p>
        </div>
        <p className="hidden md:block text-sm text-warm-gray truncate">{m.role_title || '—'}</p>
        <p className="text-xs md:text-sm text-warm-gray truncate break-all md:break-normal">
          {m.email === undefined ? <span className="text-ash-gray">…</span> : m.email || <span className="text-ash-gray">No email</span>}
        </p>
        <p className="hidden md:block text-sm text-warm-gray truncate">{managerName || '—'}</p>
        <div className="flex items-center justify-between gap-2 md:contents">
          <div>
            {m.has_login ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Has login
              </span>
            ) : (
              <button
                onClick={onOpenLogin}
                aria-expanded={loginOpen}
                className="text-xs text-cyan-edge hover:underline inline-flex items-center gap-1"
              >
                <KeyRound className="w-3.5 h-3.5" /> Create login
              </button>
            )}
          </div>
          <div className="flex justify-end md:w-[4.5rem]">
            <button
              onClick={remove}
              onBlur={() => setConfirming(false)}
              disabled={deleting}
              aria-label={confirming ? `Confirm delete ${m.name}` : `Delete ${m.name}`}
              className={cn(
                'h-8 rounded-full border text-xs inline-flex items-center justify-center gap-1 transition disabled:opacity-60',
                confirming
                  ? 'px-3 bg-rose-50 border-rose-200 text-rose-700'
                  : 'w-8 border-stone-border text-warm-gray hover:text-rose-700',
              )}
            >
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              {confirming && <span className="whitespace-nowrap">Confirm</span>}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-2 space-y-1">
          <ErrorLine message={error.message} />
          {error.tasks.length > 0 && (
            <ul className="pl-5 list-disc text-[11px] text-warm-gray space-y-0.5">
              {error.tasks.slice(0, 5).map((t, i) => <li key={i} className="break-words">{t}</li>)}
              {error.tasks.length > 5 && <li>and {error.tasks.length - 5} more</li>}
            </ul>
          )}
        </div>
      )}

      {loginOpen && !m.has_login && <LoginForm member={m} onCancel={onOpenLogin} onCreated={onLoginCreated} />}
    </li>
  );
}

function LoginForm({ member, onCancel, onCreated }: { member: TeamMember; onCancel: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState(member.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<LoginRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordOk = password.length >= 8 && password.length <= 128;
  const canSubmit = email.trim() !== '' && passwordOk && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await createLogin(member.id, { email: email.trim(), password, full_name: member.name, role });
      onCreated();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not create the login.'));
      setBusy(false);
    }
  };

  const id = (f: string) => `login-${member.id}-${f}`;

  return (
    <form onSubmit={submit} className="mt-3 rounded-cards border border-stone-border bg-stone-canvas p-4 space-y-3" noValidate>
      <p className="text-xs font-medium text-ink-black">Create a login for {member.name}</p>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] gap-3">
        <Field id={id('email')} label="Email">
          <input id={id('email')} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field
          id={id('password')}
          label="Password"
          error={password && !passwordOk ? '8 to 128 characters.' : undefined}
          hint="At least 8 characters. Share it with them directly."
        >
          <input
            id={id('password')}
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field id={id('role')} label="Role">
          <select id={id('role')} value={role} onChange={(e) => setRole(e.target.value as LoginRole)} className={inputClass}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
      </div>
      {error && <ErrorLine message={error} />}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
        <button type="submit" disabled={!canSubmit} className="btn-cyan text-xs px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create login
        </button>
      </div>
    </form>
  );
}

function AddMemberForm({ members, onCancel, onAdded }: { members: TeamMember[]; onCancel: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [email, setEmail] = useState('');
  const [managerId, setManagerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createMember({
        name: name.trim(),
        ...(roleTitle.trim() ? { role_title: roleTitle.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(managerId ? { manager_id: managerId } : {}),
      });
      onAdded();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not add that person.'));
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <FormHeader title="Add member" onClose={onCancel} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field id="add-name" label="Name">
            <input id="add-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
          </Field>
          <Field id="add-role" label="Role title">
            <input id="add-role" value={roleTitle} maxLength={200} onChange={(e) => setRoleTitle(e.target.value)} className={inputClass} />
          </Field>
          <Field id="add-email" label="Email">
            <input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field id="add-manager" label="Manager">
            <select id="add-manager" value={managerId} onChange={(e) => setManagerId(e.target.value)} className={inputClass}>
              <option value="">No manager</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        </div>
        {error && <ErrorLine message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
          <button type="submit" disabled={!name.trim() || busy} className="btn-cyan text-xs px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add
          </button>
        </div>
      </form>
    </Card>
  );
}

function BulkForm({ onCancel, onImported }: { onCancel: () => void; onImported: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const rows = useMemo(() => parseBulk(text), [text]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rows.length === 0 || busy) return;
    if (rows.length > 500) return setError('Up to 500 people per import.');
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await bulkImport(rows);
      setResult(r);
      setText('');
      onImported();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not import those people.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <FormHeader title="Add several" onClose={onCancel} />
        <Field id="bulk-text" label="One person per line" hint="Name, Role, Manager. Role and manager are optional; the manager is matched by name.">
          <textarea
            id="bulk-text"
            rows={5}
            value={text}
            onChange={(e) => { setText(e.target.value); setResult(null); }}
            placeholder={'Sarah Jenkins, Product Lead, Alex Rivers\nMark Chen, Backend Engineer, Sarah Jenkins'}
            className={cn(textareaClass, 'font-mono text-xs')}
          />
        </Field>
        {error && <ErrorLine message={error} />}
        {result && <BulkSummary result={result} />}
        <div className="flex items-center justify-end gap-2">
          {rows.length > 0 && <span className="mr-auto text-[11px] text-ash-gray">{rows.length} {rows.length === 1 ? 'line' : 'lines'}</span>}
          <button type="button" onClick={onCancel} className="btn-ghost text-xs px-3 py-1.5">Close</button>
          <button type="submit" disabled={rows.length === 0 || busy} className="btn-cyan text-xs px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Import
          </button>
        </div>
      </form>
    </Card>
  );
}

function BulkSummary({ result }: { result: BulkResult }) {
  const added = result.created.length;
  return (
    <div className="rounded-cards border border-stone-border bg-white px-4 py-3 space-y-1.5">
      <SuccessLine message={`Added ${added} ${added === 1 ? 'person' : 'people'}.`} />
      {result.skipped.length > 0 && (
        <p className="text-xs text-warm-gray break-words">
          Skipped, already on the team: {result.skipped.join(', ')}
        </p>
      )}
      {result.warnings.length > 0 && (
        <ul className="text-xs text-amber-700 space-y-0.5">
          {result.warnings.map((w, i) => (
            <li key={i} className="break-words">{w.employee}: {w.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-medium text-ink-black">{title}</h3>
      <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-full text-warm-gray hover:text-ink-black hover:bg-stone-border/40">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
