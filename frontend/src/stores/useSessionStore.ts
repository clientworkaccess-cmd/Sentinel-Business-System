import { create } from 'zustand';
import { DEMO_PERSONAS, getPerson } from '@/demo/org';
import type { Role } from '@/demo/types';
import { AUTH_MODE } from '@/lib/authMode';
import { useAuthStore } from './useAuthStore';
import { isOwnerRole } from '@/types';

/**
 * Who is signed in to /brain (#25), in either auth mode.
 *
 * Demo mode keeps a tiny session in localStorage so a refresh stays signed in.
 * Backend mode defers entirely to the existing useAuthStore and only maps the
 * backend's founder/employee onto the demo's Owner/Member personas.
 */

const KEY = 'sentinel:demo-session';

export interface Session {
  role: Role;
  personId: string;
}

interface SessionState {
  session: Session | null;
  /** 'unknown' until hydrate() has run — the /brain gate waits on this. */
  status: 'unknown' | 'signed_in' | 'signed_out';
  hydrate: () => Promise<void>;
  /** Demo mode only. */
  signInDemo: (role: Role) => Session;
  signOut: () => void;
}

/** A stored session is only trusted if it names a real person holding that role. */
function readDemoSession(): Session | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null;
    if (raw && getPerson(raw.personId)?.role === raw.role) return raw;
  } catch {
    // Unreadable or blocked storage: treat as signed out.
  }
  return null;
}

export const useSessionStore = create<SessionState>((set) => ({
  session: null,
  status: 'unknown',

  hydrate: async () => {
    if (AUTH_MODE === 'demo') {
      const session = readDemoSession();
      set({ session, status: session ? 'signed_in' : 'signed_out' });
      return;
    }
    await useAuthStore.getState().fetchCurrentUser();
    const user = useAuthStore.getState().user;
    if (!user) return set({ session: null, status: 'signed_out' });
    const role: Role = isOwnerRole(user.role) ? 'owner' : user.role === 'admin' ? 'admin' : 'member';
    set({ session: { role, personId: DEMO_PERSONAS[role] }, status: 'signed_in' });
  },

  signInDemo: (role) => {
    const session: Session = { role, personId: DEMO_PERSONAS[role] };
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
    } catch {
      // Still signed in for this tab; it just won't survive a refresh.
    }
    set({ session, status: 'signed_in' });
    return session;
  },

  signOut: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
    set({ session: null, status: 'signed_out' });
    if (AUTH_MODE === 'backend') useAuthStore.getState().logout();
  },
}));
