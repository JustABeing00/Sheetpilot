import { apiUrl } from './client.js';

export interface SessionUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export interface Session {
  user: SessionUser;
  expires: string;
}

function isSession(value: unknown): value is Session {
  return (
    typeof value === 'object' &&
    value !== null &&
    'user' in value &&
    typeof (value as { user?: unknown }).user === 'object' &&
    (value as { user?: unknown }).user !== null
  );
}

/** Reads the Auth.js session (`GET /api/auth/session`). Returns null when signed out. */
export async function fetchSession(): Promise<Session | null> {
  const response = await fetch(apiUrl('/api/auth/session'), {
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    return null;
  }
  const body: unknown = await response.json();
  return isSession(body) ? body : null;
}

async function csrfToken(): Promise<string> {
  const response = await fetch(apiUrl('/api/auth/csrf'), {
    headers: { accept: 'application/json' },
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Could not start the sign-in flow.');
  }
  const body = (await response.json()) as { csrfToken?: string };
  return body.csrfToken ?? '';
}

/** Sends a magic-link email through the configured email provider. */
export async function signInWithEmail(email: string, callbackUrl: string): Promise<void> {
  const token = await csrfToken();
  const body = new URLSearchParams({ email, csrfToken: token, callbackUrl });
  const response = await fetch(apiUrl('/api/auth/signin/resend'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error('Could not send the sign-in link. Check the address and try again.');
  }
}

/** Starts an OAuth sign-in by navigating to the provider. */
export function signInWithProvider(provider: 'google' | 'github', callbackUrl: string): void {
  const target = new URL(apiUrl(`/api/auth/signin/${provider}`), window.location.origin);
  target.searchParams.set('callbackUrl', callbackUrl);
  window.location.href = target.toString();
}

/** Signs out and clears the session cookie. */
export async function signOut(callbackUrl: string): Promise<void> {
  const token = await csrfToken();
  const body = new URLSearchParams({ csrfToken: token, callbackUrl });
  await fetch(apiUrl('/api/auth/signout'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}
