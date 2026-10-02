/**
 * Builds the grounded system prompt for /api/brain/chat. Server-only by
 * convention: import it from route handlers, never from a component.
 */
import { ORG, getDepartment, getItem, getPerson, getTeam } from '@/demo/org';
import { itemsInScope, peopleInScope, scopeLabel, visiblePeople } from '@/demo/visibility';
import type { BrainItem, Scope, Viewer } from '@/demo/types';
import type { Hit } from '@/demo/answers';

const ROLE_RULE = {
  owner: 'They are the Owner and may see everything in the company.',
  admin: 'They are an Admin and may see only their own team.',
  member: 'They are a Member and may see only their own work.',
} as const;

function itemLine(i: BrainItem): string {
  const owners = i.ownerIds.map((id) => getPerson(id)?.name).filter(Boolean).join(', ');
  const related = (i.relatedIds ?? []).map((id) => getItem(id)?.title).filter(Boolean).join('; ');
  return [
    `[${i.id}] ${i.kind}: ${i.title}`,
    i.status && `status: ${i.status.replace('_', ' ')}`,
    i.date && `date: ${i.date}`,
    owners && `owners: ${owners}`,
    i.source && `source: ${i.source}`,
    i.external && 'involves an external party',
    i.summary && `notes: ${i.summary}`,
    related && `related: ${related}`,
  ]
    .filter(Boolean)
    .join(' | ');
}

export function buildSystemPrompt(viewer: Viewer, scope: Scope, hits: Hit[]): string {
  const me = getPerson(viewer.personId)!;
  const first = me.name.split(' ')[0];
  const items = itemsInScope(ORG, viewer, scope);
  // Most relevant first, so a long context still leads with what the question is about.
  const top = new Set(hits.map((h) => h.item.id));
  const ordered = [...items.filter((i) => top.has(i.id)), ...items.filter((i) => !top.has(i.id))];

  const visible = new Set(visiblePeople(ORG, viewer.role, viewer.personId).map((p) => p.id));
  const people = peopleInScope(ORG, scope)
    .filter((p) => visible.has(p.id))
    .map((p) => {
      const where = [p.departmentId && `${getDepartment(p.departmentId)?.name} team`, p.teamId && getTeam(p.teamId)?.name].filter(Boolean).join(', ');
      return `- ${p.name}: ${p.title}${where ? ` (${where})` : ''}`;
    });

  return `You are Sentinel, the business memory of ${ORG.name} (${ORG.tagline}). Today is Friday, 2 October 2026.

You are talking to ${me.name}, ${me.title}. ${ROLE_RULE[viewer.role]} They are currently looking at: ${scopeLabel(ORG, scope)}.

RULES
- Answer ONLY from the MEMORY and PEOPLE below. If the answer is not there, say plainly that you don't have it in what ${first} can see. Never guess, and never invent people, numbers, dates or events.
- If asked about something outside what this person may see, say it is outside their view. Do not hint at its contents.
- Lead with the answer. Be concise and specific: name people, dates and amounts. Use **bold** for key facts and short bullet or numbered lists. Stay under about 180 words unless asked for detail.
- When useful, say where something came from (e.g. "from the Zoom call", "in the #kestrel-v2 Slack thread"). Refer to items by title, never by their [id].
- Anything going to a client or other outside party needs human approval. Say so when relevant; never claim something was sent if it is pending approval.
- Reply in the user's language and style: English, Urdu script, or Roman Urdu. Keep names and numbers as written.
- Do not show your reasoning.

PEOPLE
${people.join('\n')}

MEMORY (most relevant first)
${ordered.map(itemLine).join('\n')}`;
}
