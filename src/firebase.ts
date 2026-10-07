import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.modify');
provider.addScope('https://www.googleapis.com/auth/gmail.send');

// Google access tokens last an hour and Firebase can't refresh them from the
// browser. We keep the token with its expiry (so reopening the tab within the
// hour doesn't ask again) and tell the UI when it needs a one-click reconnect.
const TOKEN_KEY = 'gmailToken';
const TOKEN_LIFETIME_MS = 55 * 60_000;

interface Stored {
  token: string;
  expires: number;
}

function read(): Stored | null {
  try {
    const s = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as Stored | null;
    return s && s.expires > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function getGmailToken(): string | null {
  return read()?.token ?? null;
}

export function tokenExpiresAt(): number {
  return read()?.expires ?? 0;
}

export const AUTH_EXPIRED = 'gmail-auth-expired';
export const AUTH_RENEWED = 'gmail-auth-renewed';

export function markTokenExpired() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_EXPIRED));
}

// Must be called from a click, or the browser blocks the popup.
export async function signIn(): Promise<string> {
  const hint = auth.currentUser?.email;
  provider.setCustomParameters(hint ? { login_hint: hint } : { prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google did not return a Gmail access token');
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expires: Date.now() + TOKEN_LIFETIME_MS }));
  window.dispatchEvent(new Event(AUTH_RENEWED));
  return token;
}

export async function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  await fbSignOut(auth);
}
