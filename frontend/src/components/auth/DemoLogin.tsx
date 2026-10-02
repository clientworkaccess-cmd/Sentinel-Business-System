'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { BrandLockup } from '@/components/ui';
import { Avatar } from '@/components/brain/atoms';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, findDemoAccount } from '@/demo/accounts';
import { ORG } from '@/demo/org';
import type { Role } from '@/demo/types';
import { useBrainStore } from '@/stores/useBrainStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/** Only ever bounce back inside the demo, never to an arbitrary URL. */
function nextPath(): string {
  if (typeof window === 'undefined') return '/brain';
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/brain') ? next : '/brain';
}

/**
 * Sign-in for demo mode (#25): one click per role, or the demo email/password.
 * Needs no backend. Real auth lives in the original login, behind NEXT_PUBLIC_AUTH_MODE=backend.
 */
export function DemoLogin() {
  const router = useRouter();
  const signInDemo = useSessionStore((s) => s.signInDemo);
  const setRole = useBrainStore((s) => s.setRole);
  const [pending, setPending] = useState<Role | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const enter = (role: Role) => {
    setPending(role);
    signInDemo(role);
    setRole(role);
    router.push(nextPath());
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const account = findDemoAccount(email, password);
    if (!account) return setError('That email and password don’t match a demo account.');
    setError('');
    enter(account.role);
  };

  return (
    <main className="brain-root relative min-h-screen bg-stone-canvas overflow-hidden flex items-center justify-center px-4 py-10">
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(59,166,241,0.22), transparent 65%)' }}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-[460px]">
        <div className="text-center">
          <div className="inline-flex"><BrandLockup size="lg" /></div>
          <h1 className="font-display text-[34px] leading-[1.1] text-ink-black mt-5">
            Sign in to <span className="cyan-highlight">Sentinel</span>
          </h1>
          <p className="text-sm text-warm-gray mt-2">
            Demo workspace · {ORG.name}
          </p>
        </div>

        <div className="stone-card mt-8 p-5 sm:p-6">
          <p className="text-xs font-medium text-ink-black mb-3">Continue as</p>
          <div className="space-y-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.role}
                onClick={() => enter(a.role)}
                disabled={pending !== null}
                className={cn(
                  'group w-full flex items-center gap-3 rounded-cards border border-stone-border bg-white px-3.5 py-3 text-left transition',
                  'hover:border-cyan-edge/60 hover:shadow-card disabled:opacity-60',
                )}
              >
                <Avatar person={a.person} size="md" />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink-black truncate">{a.person.name}</span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-stone-border text-warm-gray">
                      {ROLE_LABEL[a.role]}
                    </span>
                  </span>
                  <span className="block text-xs text-warm-gray truncate">{a.person.title} · sees {a.sees}</span>
                </span>
                {pending === a.role ? (
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-signal shrink-0" />
                ) : (
                  <ArrowRight className="w-4 h-4 text-ash-gray group-hover:text-cyan-signal group-hover:translate-x-0.5 transition shrink-0" />
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 my-5 text-[11px] text-ash-gray">
            <span className="flex-1 h-px bg-stone-border" /> or with email <span className="flex-1 h-px bg-stone-border" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={DEMO_ACCOUNTS[0].email}
              aria-label="Email"
              className="w-full h-11 px-3.5 rounded-inputs border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70"
            />
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              className="w-full h-11 px-3.5 rounded-inputs border border-stone-border bg-white text-sm text-ink-black placeholder:text-ash-gray focus:outline-none focus:border-cyan-edge/70"
            />
            {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
            <button type="submit" disabled={pending !== null} className="btn-cyan w-full h-11 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60">
              Sign in <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        <p className="mt-4 flex items-start gap-2 text-[11px] text-ash-gray leading-relaxed">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-px" />
          Demo accounts: {DEMO_ACCOUNTS.map((a) => a.email).join(', ')}. Password <code className="text-warm-gray">{DEMO_PASSWORD}</code>. No server needed.
        </p>
      </div>
    </main>
  );
}
