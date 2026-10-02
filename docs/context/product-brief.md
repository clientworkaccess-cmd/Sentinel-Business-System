# Sentinel Business System — Product Brief

> **"Ask your business out loud."**

## What it is

An AI **second brain for teams**. Sentinel ingests a company's scattered business data
(email, WhatsApp, Slack, meetings, docs, invoices, CRM records) and turns it into a
**searchable, team-shared, role-aware knowledge graph** you can talk to by text or voice.

This is a pivot from legacy Sentinel, which was a founder-only follow-up engine
(extract → approve → delegate → chase). That loop survives as one capability, not the
whole product. See `CLAUDE.md` for the legacy system.

## Core value

- **Memory that persists** across people, time, and teams
- **Context that connects** people, clients, meetings, documents, and decisions
- **Follow-ups that don't slip.** Internal ones go out automatically; external, client-facing ones need **human approval**
- **Role-based visibility:** Owner sees all, Admin sees their team, Member sees self
- **500+ app connectors**, with about 50 showcased in the demo
- **A "compound of brains" graph** at org, department, team, and member level

## Who it's for

| | |
|---|---|
| **Buyer** | The Owner (company or team lead) |
| **Users** | Admins and Members inside teams |
| **Initial vertical** | IT / software houses / B2B service businesses |
| **Not the target** | Local real estate, individual consumers, schools |

Reference org shape: about 1 Owner, 5 Admins, and 50 Members.

## Roles

| Role | Sees | Typical question |
|---|---|---|
| **Owner** | The whole organization, every department, team, and person | "Which client accounts are at risk this month?" |
| **Admin** | Their department and its teams | "What's blocking the mobile team's release?" |
| **Member** | Only their own items | "What did I promise the client in yesterday's call?" |

## Language and voice

- Chat answers in **English, Urdu, and Roman Urdu**, replying in the user's language
- LLM: **Qwen** (OpenAI-compatible endpoint, already wired in the backend)
- Voice out: **ElevenLabs**, natural Pakistani English and Urdu
- Voice in: record → transcribe → send, plus live dictation
- **Accuracy matters more than latency.** Users will wait for a good answer.

## The hackathon deliverable

**The demo is the deliverable.** It has to be clickable, visually premium, and flawless.
Hard-coded frontend data is fine. The chat **must** answer for real.

1. Priority 1: premium frontend (landing, role views, graph, chat, connectors, meetings)
2. Priority 2: production backend (auth/RBAC, real OAuth, graph persistence, hybrid retrieval, approval gate)
