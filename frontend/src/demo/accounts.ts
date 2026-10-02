/**
 * Demo sign-in accounts (#25). Fictional people from the demo org, with a shared
 * demo password — these exist only so the demo can sign in without a backend,
 * and are ignored entirely when NEXT_PUBLIC_AUTH_MODE=backend.
 */
import { DEMO_PERSONAS, getPerson } from './org';
import type { Person, Role } from './types';

export const DEMO_PASSWORD = 'demo1234';

export interface DemoAccount {
  role: Role;
  person: Person;
  email: string;
  /** What this role can see, in the words the presenter will use. */
  sees: string;
}

const SEES: Record<Role, string> = {
  owner: 'the whole business, every team and person',
  admin: 'their team (Engineering, 16 people)',
  member: 'only their own work',
};

export const DEMO_ACCOUNTS: DemoAccount[] = (['owner', 'admin', 'member'] as const).map((role) => {
  const person = getPerson(DEMO_PERSONAS[role])!;
  return { role, person, email: person.email!, sees: SEES[role] };
});

/** The account for an email/password pair, or null. Email is case-insensitive. */
export function findDemoAccount(email: string, password: string): DemoAccount | null {
  if (password !== DEMO_PASSWORD) return null;
  return DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === email.trim().toLowerCase()) ?? null;
}
