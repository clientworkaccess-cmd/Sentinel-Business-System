# Current Plan — Sentinel Business System Hackathon

> Every session starts here. Read this, then `product-brief.md`, then your open issues.
> Last updated: 2026-10-02 by claude-one-orchestrator.

## Team

| Agent | Owns | Label |
|---|---|---|
| `claude-one-orchestrator` | Frontend architecture + UI/UX, planning, PR review, communication with Alyan | `agent-1` |
| `claude-two-junior` | Connectors & integrations | `agent-2` |
| `claude-three-junior` | Backend, data, AI/voice APIs | `agent-3` |
| **Alyan** (human) | **The only person who merges to `main`** | `needs-human` |

All three agents push from the same GitHub account, so **ownership is the `agent-N`
label, not the GitHub assignee**. To find your work:

```bash
gh issue list -R clientworkaccess-cmd/Sentinel-Business-System -l agent-2 --state open
```

## Epics and issues

| Epic | Sub-issues |
|---|---|
| #1 Frontend — Premium Demo UI | #5 shell + roles + demo data · #6 landing · #7 graph · #8 chat · #9 meetings |
| #2 Backend — Production Systems | #16 demo chat API · #17 voice API · #18 RBAC · #19 approval gate |
| #3 Connectors & Integrations | #10 gallery UI · #11 framework · #12 Google · #13 Slack/WhatsApp · #14 work tools · #15 note-takers |
| #4 Knowledge Graph & RBAC | #7 graph UI · #18 RBAC · #20 graph API + hybrid retrieval |

**Priority 1 (do first):** #5, #6, #7, #8, #9 (agent-1) · #10 (agent-2) · #16, #17 (agent-3)
**Priority 2:** everything else, only after your Priority 1 work is in review.

## Architecture of the demo

```
frontend/src/
├── app/
│   ├── page.tsx                         landing "/"                       (#6, agent-1)
│   ├── (brain)/brain/
│   │   ├── layout.tsx                   shell, nav, role switcher          (#5, agent-1)
│   │   ├── page.tsx                     role-aware overview                (#5, agent-1)
│   │   ├── graph/page.tsx               compound-of-brains graph           (#7, agent-1)
│   │   ├── chat/page.tsx                chat + voice                       (#8, agent-1)
│   │   ├── meetings/page.tsx            meetings + voice notes             (#9, agent-1)
│   │   └── connectors/page.tsx          connector gallery                  (#10, agent-2)
│   └── api/brain/
│       ├── chat/route.ts                Qwen, streamed                     (#16, agent-3)
│       ├── transcribe/route.ts          speech-to-text                     (#17, agent-3)
│       └── speak/route.ts               ElevenLabs TTS                     (#17, agent-3)
├── demo/                                hard-coded demo org                (#5, agent-1)
│   ├── types.ts                         ← THE data contract
│   ├── org.ts, visibility.ts
│   └── connectors.ts                                                       (#10, agent-2)
├── components/brain/**                                                     (agent-1)
├── components/connectors/**                                                (agent-2)
└── lib/server/**                        server-only helpers                (agent-3)
```

- The legacy founder dashboard (`/login`, `/approvals`, `/tasks`, `/chat`, …) is **left untouched**.
- `/brain` needs **no backend and no login**. On stage it runs from hard-coded data plus three Next route handlers.
- API keys are **server-only** env vars in `frontend/.env.local` (never `NEXT_PUBLIC_*`).
- Styling uses the existing tokens (`docs/context/design.md`, `globals.css`). Light and dark mode must both work.

### Frozen API contracts (full detail in #16 and #17)

```
POST /api/brain/chat        {messages, viewer:{role,personId}, scope:{level,id}} → streamed text/plain
POST /api/brain/transcribe  multipart audio → {text, language}
POST /api/brain/speak       {text, voice?} → audio/mpeg
```

**Stage-safety rule:** every network call in the demo has a fallback. Chat falls back to
scripted answers, voice falls back to the browser's speech APIs, and logos are bundled
locally. A demo that shows an error banner is a failed demo.

## Workflow rules

- **Branch:** `claude-<one|two|three>/<scope>-<short-desc>` (e.g. `claude-two/fe-connector-gallery`)
- **PR → `main`.** The body has `Closes #N`, what changed, how to test, and screenshots for UI.
- **Never merge your own PR.** claude-one reviews, then flags it to Alyan, and Alyan merges.
- **Stay inside the files you own** (see the table above). If you need a change in someone else's file, comment on their issue.
- **CHANGELOG.md:** add a 1–2 line entry in your PR (format in `docs/rules/change-log.md`). If `main` moved, rebase and keep both entries.
- `npm run build` must pass before you request review.
- Blocked? Add the `blocked` label and a comment saying what you tried and what you need. claude-one picks it up.

## Open questions / known gaps

- **Raw meeting transcript** is not in the repo yet. Add it as `docs/context/transcript.md` when available.
- **Slack escalation channel** (`#ai-hacakthon`) isn't connected to the orchestrator session yet, so escalations go through the human operator for now.
- API keys needed in `frontend/.env.local` for live demo: `QWEN_API_KEY`, `QWEN_API_BASE`, `AGENT_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_UR`.
