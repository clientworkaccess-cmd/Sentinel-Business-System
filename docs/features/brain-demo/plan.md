# Brain Demo — Plan

## Context

The hackathon pivots Sentinel from a founder-only follow-up engine to a **role-aware business
second brain**. The demo is the deliverable: it has to be clickable, premium, and flawless on
stage, with a chat that answers for real. Product context is in `docs/context/product-brief.md`,
and the team split and issue map are in `docs/context/current-plan.md`.

## Scope

A self-contained experience under `/brain` plus a new landing page at `/`:

| Route | What | Issue |
|---|---|---|
| `/` | Landing, "Ask your business out loud" | #6 |
| `/brain` | Shell (nav, role switcher, scope breadcrumb) + role-aware overview | #5 |
| `/brain/graph` | Compound-of-brains d3-force graph, 4 levels | #7 |
| `/brain/chat` | Chat: text, voice record, dictation, voice reply | #8 |
| `/brain/meetings` | Meetings, decisions, action items, voice notes, approval gate | #9 |
| `/brain/connectors` | ~50-app gallery with Connect Now modal | #10 |
| `/api/brain/*` | Qwen chat, STT, ElevenLabs TTS | #16, #17 |

Out of scope for the demo: login, persistence, real OAuth, wake word.

## Decisions

1. **New route group, legacy untouched.** The founder dashboard keeps working, and the demo can't regress it.
2. **Hard-coded demo org in `src/demo/`.** A fictional Lahore software house with 1 Owner, 5 Admins
   (department heads), and about 50 Members, plus clients, projects, meetings, docs, and decisions.
   `src/demo/types.ts` is the contract the production graph API (#20) must return later.
3. **Role is client state** (`useBrainStore`). Switching role is instant, and visibility is computed
   by one helper (`visibleItems`) shared by the UI and the chat route, so the graph and the chat
   never disagree about what a viewer can see.
4. **AI calls go through Next route handlers**, not FastAPI. They need no DB and no auth, the keys
   stay server-side, and the demo stays a single deployable.
5. **Stage-safety.** Every external call has a fallback (scripted chat, browser speech, bundled logos).
6. **Graph layout is computed, then simulated.** Cluster centres are laid out deterministically
   (grid/circle-pack per level) and d3-force only settles nodes *within* their cluster
   (`forceX`/`forceY` to the centre, plus collide). This guarantees the separation the old demo lacked.
7. **Existing design tokens** (`design.md`, Seline style: warm stone + cyan) with light and dark mode.
   The graph canvas may use the darker `soot` surface for contrast.

## Constraints

- Next 15 / React 19 / Tailwind 3 / Zustand / d3-force are already in the repo. No new UI framework.
- Must look right on a 1280–1920px projector. Tablet degrades gracefully.
- `npm run build` must stay green on every PR.
