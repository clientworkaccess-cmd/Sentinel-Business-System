'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowUpRight, ChevronRight, LayoutDashboard, LogOut, Menu, MessageSquareText, Mic, Moon, Network, Plug, Sparkles, Sun, X,
} from 'lucide-react';
import { BrandLockup } from '@/components/ui';
import { ORG, getPerson } from '@/demo/org';
import { canViewScope, scopeLabel, scopePath } from '@/demo/visibility';
import type { Role } from '@/demo/types';
import { useBrainStore } from '@/stores/useBrainStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useUIStore } from '@/stores/useUIStore';
import { cn } from '@/lib/utils';
import { Avatar } from './atoms';

const NAV = [
  { name: 'Overview', href: '/brain', icon: LayoutDashboard },
  { name: 'Knowledge graph', href: '/brain/graph', icon: Network },
  { name: 'Ask Sentinel', href: '/brain/chat', icon: MessageSquareText },
  { name: 'Meetings & notes', href: '/brain/meetings', icon: Mic },
  { name: 'Connectors', href: '/brain/connectors', icon: Plug },
];

const ROLES: { role: Role; label: string }[] = [
  { role: 'owner', label: 'Owner' },
  { role: 'admin', label: 'Admin' },
  { role: 'member', label: 'Member' },
];

const ROLE_SEES: Record<Role, string> = {
  owner: 'Sees the whole company',
  admin: 'Sees their team',
  member: 'Sees only their own work',
};

/** Pages that manage their own full-height layout (canvas, chat thread). */
const FULL_BLEED = ['/brain/graph', '/brain/chat'];

export function BrainShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const { hydrateNav } = useUIStore();
  const { status, session, hydrate } = useSessionStore();
  const setRole = useBrainStore((s) => s.setRole);
  const startedAs = useRef<string | null>(null);

  useEffect(() => {
    hydrateNav();
    hydrate();
  }, [hydrateNav, hydrate]);

  // Every /brain page needs a signed-in viewer (#25). The signed-in role is only
  // the starting view: the presenter can still switch roles from the top bar.
  useEffect(() => {
    if (status === 'signed_out') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (status === 'signed_in' && session && startedAs.current !== session.personId) {
      startedAs.current = session.personId;
      setRole(session.role);
    }
  }, [status, session, pathname, router, setRole]);

  // A route change on mobile should never leave the drawer covering the page.
  useEffect(() => setNavOpen(false), [pathname]);

  const fullBleed = FULL_BLEED.some((p) => pathname.startsWith(p));

  if (status !== 'signed_in') {
    return (
      <div className="brain-root min-h-screen bg-stone-canvas flex items-center justify-center" aria-busy="true">
        <div className="animate-pulse"><BrandLockup size="lg" /></div>
      </div>
    );
  }

  return (
    <div className="brain-root min-h-screen bg-stone-canvas text-ink-black flex">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} pathname={pathname} />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar onMenu={() => setNavOpen(true)} />
        <main
          className={cn(
            'flex-1 min-w-0',
            fullBleed ? 'h-[calc(100vh-4rem)] p-3 sm:p-4' : 'px-4 sm:px-6 lg:px-10 py-6 lg:py-8 max-w-[1280px] w-full mx-auto',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */

function Sidebar({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  const { viewer } = useBrainStore();
  const me = getPerson(viewer.personId);
  const router = useRouter();
  const signOut = useSessionStore((s) => s.signOut);

  return (
    <>
      {open && <div onClick={onClose} className="fixed inset-0 z-40 bg-ink-black/30 md:hidden" aria-hidden="true" />}
      <aside
        className={cn(
          'fixed md:sticky top-0 left-0 z-50 md:z-auto h-screen w-64 shrink-0 flex flex-col',
          'bg-stone-canvas border-r border-stone-border transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-stone-border shrink-0">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandLockup />
            <span className="font-display text-[17px] text-ink-black">Sentinel</span>
          </Link>
          <button onClick={onClose} className="md:hidden p-1.5 rounded-full text-warm-gray hover:text-ink-black" aria-label="Close navigation">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pt-4">
          <div className="rounded-cards border border-stone-border bg-white px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wider text-ash-gray">Workspace</p>
            <p className="text-sm font-medium text-ink-black mt-0.5">{ORG.name}</p>
            <p className="text-xs text-warm-gray">{ORG.people.length} people · {ORG.departments.length} teams</p>
          </div>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1">
          {NAV.map(({ name, href, icon: Icon }) => {
            const active = href === '/brain' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition',
                  active
                    ? 'bg-white border border-stone-border text-ink-black shadow-subtle'
                    : 'text-warm-gray hover:text-ink-black hover:bg-stone-border/40 border border-transparent',
                )}
              >
                <Icon className={cn('w-4 h-4 shrink-0', active ? 'text-cyan-signal' : 'text-warm-gray')} />
                {name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-stone-border shrink-0">
          <div className="flex items-center gap-3">
            <Avatar person={me} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-black truncate">{me?.name}</p>
              <p className="text-xs text-warm-gray truncate">{me?.title}</p>
            </div>
            <button
              onClick={() => {
                signOut();
                router.replace('/login');
              }}
              title="Sign out"
              aria-label="Sign out"
              className="p-2 rounded-full text-warm-gray hover:text-ink-black hover:bg-stone-border/40 transition shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <p className="mt-3 text-[11px] text-ash-gray">{ROLE_SEES[viewer.role]}</p>
        </div>
      </aside>
    </>
  );
}

/* ── Top bar ────────────────────────────────────────────────────────────── */

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { theme, toggleTheme } = useUIStore();
  return (
    <header className="sticky top-0 z-30 h-16 shrink-0 border-b border-stone-border bg-stone-canvas/80 backdrop-blur-md">
      <div className="h-full px-4 sm:px-6 flex items-center gap-3">
        <button onClick={onMenu} className="md:hidden p-2 -ml-2 rounded-full text-warm-gray hover:text-ink-black" aria-label="Open navigation">
          <Menu className="w-5 h-5" />
        </button>
        <ScopeBreadcrumb />
        <div className="flex-1" />
        <AskPill />
        <RoleSwitcher />
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full text-warm-gray hover:text-ink-black hover:bg-stone-border/40 transition"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}

function ScopeBreadcrumb() {
  const { viewer, scope, setScope } = useBrainStore();
  const path = scopePath(ORG, scope);
  return (
    <nav aria-label="Scope" className="hidden sm:flex items-center gap-1 min-w-0 text-sm">
      {path.map((s, i) => {
        const last = i === path.length - 1;
        const allowed = canViewScope(ORG, viewer, s);
        return (
          <React.Fragment key={`${s.level}:${s.id}`}>
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-ash-gray shrink-0" />}
            <button
              type="button"
              disabled={last || !allowed}
              onClick={() => setScope(s)}
              title={!allowed ? 'Outside what this role can see' : undefined}
              className={cn(
                'px-2 py-1 rounded-md truncate max-w-[160px] transition',
                last ? 'text-ink-black font-medium' : allowed ? 'text-warm-gray hover:text-ink-black hover:bg-stone-border/40' : 'text-ash-gray/70 cursor-not-allowed',
              )}
            >
              {scopeLabel(ORG, s)}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function AskPill() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname.startsWith('/brain/chat')) return null;
  return (
    <button
      onClick={() => router.push('/brain/chat')}
      className="hidden xl:flex items-center gap-2 h-9 pl-3 pr-2 w-72 rounded-full border border-stone-border bg-white text-sm text-ash-gray hover:border-cyan-edge/60 hover:text-warm-gray transition"
    >
      <Sparkles className="w-4 h-4 text-cyan-signal" />
      <span className="flex-1 text-left">Ask your business anything…</span>
      <ArrowUpRight className="w-4 h-4" />
    </button>
  );
}

function RoleSwitcher() {
  const { viewer, setRole } = useBrainStore();
  return (
    <div role="radiogroup" aria-label="View as role" className="flex items-center p-0.5 rounded-full border border-stone-border bg-white">
      {ROLES.map(({ role, label }) => {
        const active = viewer.role === role;
        return (
          <button
            key={role}
            role="radio"
            aria-checked={active}
            onClick={() => setRole(role)}
            title={ROLE_SEES[role]}
            className={cn(
              'px-3 h-8 rounded-full text-xs font-medium transition',
              active ? 'bg-inverse text-white shadow-subtle' : 'text-warm-gray hover:text-ink-black',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
