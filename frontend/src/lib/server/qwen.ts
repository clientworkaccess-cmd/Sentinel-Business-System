/**
 * Minimal streaming client for Qwen's OpenAI-compatible endpoint. Server-only:
 * reads QWEN_API_KEY, which must never reach the browser.
 */

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function qwenConfigured(): boolean {
  return !!(process.env.QWEN_API_KEY && process.env.QWEN_API_BASE);
}

/**
 * Yields answer text as it streams. Reasoning never reaches the caller: the
 * `reasoning_content` delta is ignored, and inline <think>…</think> blocks (some
 * deployments emit them in `content`) are stripped across chunk boundaries.
 */
export async function* streamQwen(messages: ChatTurn[], signal: AbortSignal): AsyncGenerator<string> {
  const base = process.env.QWEN_API_BASE!.replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.AGENT_MODEL || 'qwen-plus',
      messages,
      stream: true,
      temperature: 0.3,
      // DashScope: Qwen3 models otherwise spend the first seconds "thinking".
      enable_thinking: false,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Qwen responded ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let inThink = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, '');
      if (!data || data === '[DONE]' || !line.trim().startsWith('data:')) continue;
      let delta: string | undefined;
      try {
        delta = JSON.parse(data).choices?.[0]?.delta?.content;
      } catch {
        continue; // A keep-alive or partial frame — not worth failing the answer over.
      }
      if (!delta) continue;

      let out = '';
      let rest = delta;
      while (rest) {
        if (inThink) {
          const end = rest.indexOf('</think>');
          if (end < 0) { rest = ''; break; }
          inThink = false;
          rest = rest.slice(end + 8);
        } else {
          const start = rest.indexOf('<think>');
          if (start < 0) { out += rest; break; }
          out += rest.slice(0, start);
          inThink = true;
          rest = rest.slice(start + 7);
        }
      }
      if (out) yield out;
    }
  }
}
