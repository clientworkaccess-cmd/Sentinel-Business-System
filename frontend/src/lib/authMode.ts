/**
 * Which login the app uses (#25).
 *
 *   demo    — hard-coded demo accounts, no backend needed (default until the API is live)
 *   backend — the original FastAPI login (`/auth/login` → `/auth/me`), unchanged
 *
 * NEXT_PUBLIC_ because the login page and the /brain gate both run in the browser.
 */
export type AuthMode = 'demo' | 'backend';

export const AUTH_MODE: AuthMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'backend' ? 'backend' : 'demo';
