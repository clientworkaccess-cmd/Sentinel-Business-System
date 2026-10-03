/**
 * POST /api/brain/chat — the demo's live chat (#16).
 *
 * Contract (frozen, see the issue):
 *   { messages, viewer: { role, personId }, scope: { level, id }, sessionId? }
 *   → 200 text/plain, streamed markdown
 *     x-sentinel-sources:  JSON array of item ids the answer drew on
 *     x-sentinel-fallback: 1 when a scripted answer was served instead of a model
 *     x-sentinel-agent:    which answered: "n8n" | "qwen" | "scripted"
 *
 * Who answers, in order:
 *   1. the n8n demo agent, when SENTINEL_AGENT_WEBHOOK_URL is set (Alyan, 2026-10-03)
 *   2. Qwen, when QWEN_API_KEY is set
 *   3. the scripted demo answers
 *
 * Stage rule: this route does not fail. A missing key, a slow first token or an
 * upstream error all degrade to the offline answer, streamed at a natural pace.
 */
import { NextResponse } from 'next/server';
import { ORG, getPerson } from '@/demo/org';
import { offlineAnswer, retrieve } from '@/demo/answers';
import { canViewScope, homeScope } from '@/demo/visibility';
import type { Scope, Viewer } from '@/demo/types';
import { buildSystemPrompt } from '@/lib/server/prompt';
import { qwenConfigured, streamQwen, type ChatTurn } from '@/lib/server/qwen';
import { agentConfigured, askAgent } from '@/lib/server/agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIRST_TOKEN_TIMEOUT_MS = 20_000;
const MAX_TURNS = 12;
const MAX_CHARS = 4_000;
const ROLES = new Set(['owner', 'admin', 'member']);
const LEVELS = new Set(['org', 'department', 'team', 'member']);

interface Body {
  messages?: { role?: string; content?: unknown }[];
  viewer?: Partial<Viewer>;
  scope?: Partial<Scope>;
  sessionId?: unknown;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  // The viewer must be a real person holding the role they claim — otherwise a
  // Member could ask as "owner" and read the whole company.
  const person = body.viewer?.personId ? getPerson(body.viewer.personId) : undefined;
  if (!person || !ROLES.has(body.viewer?.role ?? '') || person.role !== body.viewer!.role) {
    return NextResponse.json({ error: 'viewer must be { role, personId } of a known person with that role.' }, { status: 400 });
  }
  const viewer: Viewer = { role: person.role, personId: person.id };

  const requested = body.scope;
  const scope: Scope =
    requested && LEVELS.has(requested.level ?? '') && typeof requested.id === 'string' && canViewScope(ORG, viewer, requested as Scope)
      ? (requested as Scope)
      : homeScope(ORG, viewer);

  const turns: ChatTurn[] = (body.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content as string).slice(0, MAX_CHARS) }));
  const question = [...turns].reverse().find((t) => t.role === 'user')?.content;
  if (!question) {
    return NextResponse.json({ error: 'messages must include a user turn.' }, { status: 400 });
  }

  const hits = retrieve(question, viewer, scope);
  const fallback = () => {
    const answer = offlineAnswer(question, viewer, scope);
    return textResponse(paced(answer.text), answer.sources, true, 'scripted');
  };

  // Presenters can pin the tuned answers for a rehearsed run.
  if (process.env.BRAIN_CHAT_PREFER_SCRIPTED === '1') return fallback();

  if (agentConfigured()) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 80) : undefined;
    try {
      const reply = await askAgent({ message: question, sessionId, viewer, scope }, req.signal);
      const sources = hits.filter((h) => h.score >= 3).slice(0, 5).map((h) => h.item.id);
      return textResponse(paced(reply, 150), sources, false, 'n8n');
    } catch (err) {
      console.error('[brain/chat] n8n agent unavailable, serving fallback:', (err as Error).message);
      return fallback();
    }
  }

  if (!qwenConfigured()) return fallback();

  const controller = new AbortController();
  req.signal.addEventListener('abort', () => controller.abort());
  const messages: ChatTurn[] = [{ role: 'system', content: buildSystemPrompt(viewer, scope, hits) }, ...turns];
  const gen = streamQwen(messages, controller.signal);

  // Wait for the first token before committing to a response, so a dead or slow
  // upstream can still be swapped for the fallback with the right headers.
  let first: IteratorResult<string>;
  try {
    first = await Promise.race([
      gen.next(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('first-token timeout')), FIRST_TOKEN_TIMEOUT_MS)),
    ]);
  } catch (err) {
    controller.abort();
    console.error('[brain/chat] Qwen unavailable, serving fallback:', (err as Error).message);
    return fallback();
  }
  if (first.done) return fallback();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      c.enqueue(encoder.encode(first.value.replace(/^\s+/, '')));
      try {
        for await (const chunk of gen) c.enqueue(encoder.encode(chunk));
      } catch (err) {
        // Mid-answer failure: end cleanly rather than leave the UI hanging.
        console.error('[brain/chat] stream interrupted:', (err as Error).message);
        c.enqueue(encoder.encode('…'));
      }
      c.close();
    },
    cancel() {
      controller.abort();
    },
  });

  const sources = hits.filter((h) => h.score >= 3).slice(0, 5).map((h) => h.item.id);
  return textResponse(stream, sources, false, 'qwen');
}

function textResponse(
  stream: ReadableStream<Uint8Array>,
  sources: string[],
  isFallback: boolean,
  agent: 'n8n' | 'qwen' | 'scripted',
) {
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'x-sentinel-sources': JSON.stringify(sources),
    'x-sentinel-agent': agent,
  };
  if (isFallback) headers['x-sentinel-fallback'] = '1';
  return new Response(stream, { headers });
}

/** Stream text word by word, after a short beat, so an offline answer still reads as live. */
function paced(text: string, beatMs = 700): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const parts = text.match(/\S+\s*/g) ?? [text];
  return new ReadableStream<Uint8Array>({
    async start(c) {
      await sleep(beatMs);
      for (const p of parts) {
        c.enqueue(encoder.encode(p));
        await sleep(14 + Math.min(40, p.length * 2));
      }
      c.close();
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
