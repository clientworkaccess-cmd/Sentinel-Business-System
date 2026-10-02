import { create } from 'zustand';
import { CONNECTORS, type Connector } from '@/demo/connectors';
import { LIVE_CONNECTORS, fetchLiveConnectors, apiErrorMessage, type LiveConnector } from '@/lib/connectorsApi';

/**
 * Connection state for the gallery.
 *
 * Demo mode (#10): starts from the catalogue and changes only in this session.
 * Backend mode (#33): Gmail, Calendar, Drive, Docs and Slack come from
 * GET /connectors; every other card is honestly "coming soon".
 */
interface ConnectorsState {
  status: Record<string, Connector['status']>;
  /** "Just now", or the demo's last-sync label. */
  lastSync: Record<string, string>;
  connect: (id: string) => void;
  disconnect: (id: string) => void;
  /** Backend mode only. null until the first load. */
  live: Record<string, LiveConnector> | null;
  liveError: string | null;
  loadLive: () => Promise<void>;
}

export const useConnectorsStore = create<ConnectorsState>((set) => ({
  status: Object.fromEntries(CONNECTORS.map((c) => [c.id, c.status])),
  lastSync: Object.fromEntries(CONNECTORS.filter((c) => c.status === 'connected').map((c, i) => [c.id, `${2 + (i % 9)} min ago`])),
  connect: (id) => set((s) => ({ status: { ...s.status, [id]: 'connected' }, lastSync: { ...s.lastSync, [id]: 'Just now' } })),
  disconnect: (id) => set((s) => ({ status: { ...s.status, [id]: 'available' } })),
  live: null,
  liveError: null,
  loadLive: async () => {
    if (!LIVE_CONNECTORS) return;
    try {
      set({ live: await fetchLiveConnectors(), liveError: null });
    } catch (err) {
      set({ liveError: apiErrorMessage(err, 'Could not load connector status.') });
    }
  },
}));

export type GalleryState = Connector['status'] | 'pending' | 'needs_reconnect';

/** What a card shows, in either mode. */
export function galleryState(
  c: Connector,
  demo: Record<string, Connector['status']>,
  live: Record<string, LiveConnector> | null,
): GalleryState {
  if (!LIVE_CONNECTORS) return demo[c.id];
  const l = live?.[c.id];
  if (!l) return 'coming_soon';
  return l.status === 'available' ? 'available' : l.status;
}
