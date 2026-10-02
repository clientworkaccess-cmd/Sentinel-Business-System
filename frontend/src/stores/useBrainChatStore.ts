import { create } from 'zustand';
import { offlineAnswer } from '@/demo/answers';
import type { Scope, Viewer } from '@/demo/types';

export interface BrainMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Item ids the answer drew on — rendered as source chips. */
  sources: string[];
  status: 'thinking' | 'streaming' | 'done';
}

interface BrainChatState {
  messages: BrainMessage[];
  busy: boolean;
  /** Ask a question as `viewer`, scoped to `scope`. Resolves with the final answer. */
  ask: (question: string, viewer: Viewer, scope: Scope) => Promise<BrainMessage | null>;
  reset: () => void;
}

let seq = 0;
const id = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Conversation with the demo brain. Not persisted: switching role starts a fresh
 * conversation, because the previous answers may contain things the new role
 * is not allowed to see.
 */
export const useBrainChatStore = create<BrainChatState>((set, get) => {
  const patch = (mid: string, p: Partial<BrainMessage>) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === mid ? { ...m, ...p } : m)) }));

  return {
    messages: [],
    busy: false,

    reset: () => set({ messages: [], busy: false }),

    ask: async (question, viewer, scope) => {
      const text = question.trim();
      if (!text || get().busy) return null;

      const history = get().messages.filter((m) => m.status === 'done');
      const user: BrainMessage = { id: id(), role: 'user', content: text, sources: [], status: 'done' };
      const reply: BrainMessage = { id: id(), role: 'assistant', content: '', sources: [], status: 'thinking' };
      set((s) => ({ messages: [...s.messages, user, reply], busy: true }));

      let content = '';
      try {
        const res = await fetch('/api/brain/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...history, user].map((m) => ({ role: m.role, content: m.content })),
            viewer,
            scope,
          }),
        });
        if (!res.ok || !res.body) throw new Error(String(res.status));
        let sources: string[] = [];
        try {
          sources = JSON.parse(res.headers.get('x-sentinel-sources') ?? '[]');
        } catch {
          /* chips are a nicety */
        }
        patch(reply.id, { sources });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          patch(reply.id, { content, status: 'streaming' });
        }
      } catch {
        // The route itself is unreachable (offline, dev server restarting).
        // Answer from the same local memory instead of showing an error.
        const answer = offlineAnswer(text, viewer, scope);
        patch(reply.id, { sources: answer.sources, status: 'streaming' });
        content = '';
        for (const word of answer.text.match(/\S+\s*/g) ?? []) {
          content += word;
          patch(reply.id, { content });
          await sleep(16);
        }
      }

      patch(reply.id, { status: 'done', content: content.trim() });
      set({ busy: false });
      return get().messages.find((m) => m.id === reply.id) ?? null;
    },
  };
});
