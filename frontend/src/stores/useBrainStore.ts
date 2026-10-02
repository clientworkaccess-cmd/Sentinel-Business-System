import { create } from 'zustand';
import { DEMO_PERSONAS, ORG } from '@/demo/org';
import { canViewScope, homeScope } from '@/demo/visibility';
import type { Role, Scope, Viewer } from '@/demo/types';

/**
 * The /brain demo's single source of "who is looking, and at what".
 *
 * Deliberately not persisted: a presenter refreshing mid-demo should land back on
 * the Owner view, not wherever the last rehearsal left it.
 */
interface BrainState {
  viewer: Viewer;
  scope: Scope;
  /** Step into a role as its demo persona; scope resets to what that role may see. */
  setRole: (role: Role) => void;
  /** Ignored when the viewer may not see the scope — the UI never has to check first. */
  setScope: (scope: Scope) => void;
  resetScope: () => void;
}

const initialViewer: Viewer = { role: 'owner', personId: DEMO_PERSONAS.owner };

export const useBrainStore = create<BrainState>((set, get) => ({
  viewer: initialViewer,
  scope: homeScope(ORG, initialViewer),

  setRole: (role) => {
    const viewer: Viewer = { role, personId: DEMO_PERSONAS[role] };
    set({ viewer, scope: homeScope(ORG, viewer) });
  },

  setScope: (scope) => {
    if (canViewScope(ORG, get().viewer, scope)) set({ scope });
  },

  resetScope: () => set({ scope: homeScope(ORG, get().viewer) }),
}));
