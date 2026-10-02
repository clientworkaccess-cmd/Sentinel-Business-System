import { create } from 'zustand';
import { CONNECTORS, type Connector } from '@/demo/connectors';

/**
 * Connection state for the demo gallery (#10). Starts from the catalogue and
 * changes only in this session — connecting is simulated until #11 wires real OAuth.
 */
interface ConnectorsState {
  status: Record<string, Connector['status']>;
  /** "Just now", or the demo's last-sync label. */
  lastSync: Record<string, string>;
  connect: (id: string) => void;
  disconnect: (id: string) => void;
}

export const useConnectorsStore = create<ConnectorsState>((set) => ({
  status: Object.fromEntries(CONNECTORS.map((c) => [c.id, c.status])),
  lastSync: Object.fromEntries(CONNECTORS.filter((c) => c.status === 'connected').map((c, i) => [c.id, `${2 + (i % 9)} min ago`])),
  connect: (id) => set((s) => ({ status: { ...s.status, [id]: 'connected' }, lastSync: { ...s.lastSync, [id]: 'Just now' } })),
  disconnect: (id) => set((s) => ({ status: { ...s.status, [id]: 'available' } })),
}));
