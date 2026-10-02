import type { Role } from './types';

/**
 * Suggested questions per role. Each one has a story answer in the demo data, and
 * one per role is Roman Urdu on purpose: the chat must show it can reply in kind.
 */
export const SUGGESTED_PROMPTS: Record<Role, string[]> = {
  owner: [
    'Which clients are at risk this month?',
    'What did leadership decide on Wednesday?',
    'Indus Freight ka renewal kis haal mein hai?',
    'What is waiting on my approval?',
  ],
  admin: [
    "What's blocking the Kestrel launch?",
    'How loaded is the platform team right now?',
    'Mobile team ne is hafte kya kaam kiya?',
    'Which engineering deadlines are slipping?',
  ],
  member: [
    'What do I owe people this week?',
    "Summarise yesterday's Kestrel call",
    'PSP certification ka kya status hai?',
    'Who else is working on Kestrel v2?',
  ],
};
