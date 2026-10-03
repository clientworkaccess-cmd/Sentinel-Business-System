/**
 * The demo's Sentinel agent: an n8n workflow behind a webhook (Alyan, 2026-10-03).
 *
 *   POST SENTINEL_AGENT_WEBHOOK_URL  { message, sessionId, viewer, scope }
 *   ← { response: "..." }
 *
 * `message` is the contract; the other keys are context the workflow may use
 * (sessionId for memory) or ignore. Server-only, so the webhook URL never reaches
 * the browser. Swapping to the production agent later means pointing
 * SENTINEL_AGENT_WEBHOOK_URL elsewhere, or unsetting it to fall back to Qwen.
 */
import type { Scope, Viewer } from '@/demo/types';

const TIMEOUT_MS = 25_000;

export function agentConfigured(): boolean {
  return Boolean(process.env.SENTINEL_AGENT_WEBHOOK_URL?.trim());
}

export class AgentUnavailable extends Error {}

export async function askAgent(
  input: { message: string; sessionId?: string; viewer: Viewer; scope: Scope },
  signal?: AbortSignal,
): Promise<string> {
  const url = process.env.SENTINEL_AGENT_WEBHOOK_URL?.trim();
  if (!url) throw new AgentUnavailable('SENTINEL_AGENT_WEBHOOK_URL is not set');

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new AgentUnavailable(`agent webhook ${res.status}`);

  const raw = await res.text();
  const text = extractResponse(raw);
  if (!text) throw new AgentUnavailable('agent webhook returned no `response`');
  return text;
}

/**
 * The agreed shape is `{ "response": "..." }`. n8n's "Respond to Webhook" and
 * "Last node" modes also produce `[{ response }]`, `{ output }` or plain text, so
 * those are accepted too rather than failing a live demo over a node setting.
 */
export function extractResponse(raw: string): string {
  const body = raw.trim();
  if (!body) return '';
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return body; // plain text reply
  }
  const first = Array.isArray(data) ? data[0] : data;
  if (typeof first === 'string') return first.trim();
  if (first && typeof first === 'object') {
    const o = first as Record<string, unknown>;
    for (const key of ['response', 'output', 'text', 'message', 'answer']) {
      if (typeof o[key] === 'string' && (o[key] as string).trim()) return (o[key] as string).trim();
    }
    if (o.json && typeof o.json === 'object') return extractResponse(JSON.stringify(o.json));
  }
  return '';
}
