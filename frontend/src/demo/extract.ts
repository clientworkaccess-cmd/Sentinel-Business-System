/**
 * Pulls action items out of a voice-note transcript (#9). A deliberately small,
 * readable heuristic for the demo — the production path is the backend Extractor
 * agent. It never guesses an owner: everything belongs to whoever recorded it.
 */
import { ORG } from './org';
import type { ActionItem } from './meetings';

/** The demo's fixed "today": Friday, 2 October 2026. */
const TODAY = Date.UTC(2026, 9, 2);
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

// "call" alone is too common ("after the Kestrel call"); only "call him/them/back" commits anyone.
const COMMITMENT =
  /\b(will|i'll|we'll|need to|needs to|have to|has to|must|should|follow up|remind|send|share|email|call (?:him|her|them|back)|karna|karni|bhejna|bhej|dena|batana)\b/i;

/** Abbreviations whose full stop is not the end of a sentence. */
const ABBREVIATIONS = /\b(Dr|Mr|Mrs|Ms|St|vs|etc|e\.g|i\.e)\./g;
const HOLD = '․'; // one-dot leader: looks like a full stop, doesn't split.

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "by Monday", "tomorrow", "kal tak", "next week" → an ISO date. */
export function dueFrom(sentence: string): string | undefined {
  const s = sentence.toLowerCase();
  if (/\b(tomorrow|kal)\b/.test(s)) return iso(TODAY + DAY);
  if (/\b(today|aaj)\b/.test(s)) return iso(TODAY);
  if (/\bnext week\b|\bagle hafte\b/.test(s)) return iso(TODAY + 7 * DAY);
  const today = new Date(TODAY).getUTCDay();
  for (let d = 0; d < 7; d++) {
    if (new RegExp(`\\b${WEEKDAYS[d]}\\b`).test(s)) {
      const ahead = (d - today + 7) % 7 || 7;
      return iso(TODAY + ahead * DAY);
    }
  }
  return undefined;
}

/** Clients mentioned by name make an action external, which means it needs approval. */
const CLIENTS = ORG.items
  .filter((i) => i.kind === 'client')
  .map((i) => ({ title: i.title, key: i.title.split(' ')[0].toLowerCase() }));

export function clientIn(sentence: string): string | undefined {
  const s = sentence.toLowerCase();
  return CLIENTS.find((c) => s.includes(c.key))?.title;
}

const tidy = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ').replace(/^(and|also|aur|so|then)\s+/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function extractActions(transcript: string, ownerId: string, idPrefix: string): ActionItem[] {
  return transcript
    .replace(ABBREVIATIONS, `$1${HOLD}`)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.split(HOLD).join('.').trim())
    .filter((s) => s.length > 8 && COMMITMENT.test(s))
    .map((sentence, i) => {
      const client = clientIn(sentence);
      const text = tidy(sentence.replace(/[.!?]+$/, ''));
      const action: ActionItem = { id: `${idPrefix}-${i}`, text, ownerId, due: dueFrom(sentence), status: 'open' };
      if (client) {
        action.status = 'pending_approval';
        action.externalTo = client;
        // A starting point for a human to edit before approving, not a finished email.
        action.draft = `Hi team at ${client},\n\nA quick follow-up from our side, from today's notes:\n\n• ${text}\n\nBest regards,\nArcline Technologies`;
      }
      return action;
    });
}

/** Used when there is no microphone (or nothing was heard), so the flow can still be shown. */
export const SAMPLE_VOICE_NOTE =
  "Quick note after the Kestrel call. I need to send Kestrel's Dr. Nadia the 3-D Secure test logs by Monday. " +
  'Hira will retry the PSP sandbox tomorrow morning. ' +
  'Aur PSP walon ko kal tak escalation email karni hai.';
