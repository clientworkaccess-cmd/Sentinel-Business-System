import { api, apiErrorMessage } from '@/lib/api';
import { AUTH_MODE } from '@/lib/authMode';

/**
 * Live connectors (#33): Gmail, Google Calendar, Google Drive (+ Docs) and Slack,
 * connected through Composio-managed OAuth on the backend.
 *
 * Only in backend auth mode — the demo login has no API token, and the stage demo
 * must never depend on a provider's consent screen. In demo mode the gallery keeps
 * its simulated flow.
 */
export const LIVE_CONNECTORS = AUTH_MODE === 'backend';

export type LiveStatus = 'connected' | 'available' | 'pending' | 'needs_reconnect';

export interface MyConnection {
  status: 'pending' | 'active' | 'expired' | 'failed';
  accountLabel?: string | null;
  statusReason?: string | null;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
  syncing: boolean;
  itemCount: number;
}

/** GET /connectors — live status laid over the catalogue in demo/connectors.ts. */
export interface LiveConnector {
  id: string;
  name: string;
  /** "google_docs" is served by the "google_drive" connection. */
  servedBy: string;
  /** False when the server has no COMPOSIO_API_KEY. */
  available: boolean;
  status: LiveStatus;
  syncUnit: string;
  syncCount: number;
  connectedCount: number;
  mine?: MyConnection | null;
}

export async function fetchLiveConnectors(): Promise<Record<string, LiveConnector>> {
  const { data } = await api.get<LiveConnector[]>('/connectors');
  return Object.fromEntries(data.map((c) => [c.id, c]));
}

/** Returns Composio's consent URL. The caller sends the browser there. */
export async function startConnect(id: string): Promise<string> {
  const { data } = await api.post<{ connectionId: string; redirectUrl: string }>(`/connectors/${id}/connect`);
  return data.redirectUrl;
}

export async function syncNow(id: string): Promise<string> {
  const { data } = await api.post<{ queued: boolean; message: string }>(`/connectors/${id}/sync`);
  return data.message;
}

/** Revokes at Composio and removes everything the account synced. */
export async function disconnectLive(id: string): Promise<number> {
  const { data } = await api.delete<{ removedItems: number }>(`/connectors/${id}`, { params: { purge: true } });
  return data.removedItems;
}

export { apiErrorMessage };

/** "3 min ago", "2 h ago", "4 Oct". */
export function since(iso?: string | null): string {
  if (!iso) return 'not yet';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
