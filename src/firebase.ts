import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseConfig } from './config';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.modify');
provider.addScope('https://www.googleapis.com/auth/gmail.send');
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/calendar.readonly');

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

// --- Staying connected without popups (needs the Cloud Functions in /functions) ---
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const LINKED_KEY = 'gmailLinked';
const fns = getFunctions(app);
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

function store(token: string, expiresInSec: number) {
  const expires = Date.now() + Math.min(expiresInSec * 1000 - 5 * 60_000, TOKEN_LIFETIME_MS);
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expires }));
  window.dispatchEvent(new Event(AUTH_RENEWED));
}

export const canStayConnected = () => !!GOOGLE_CLIENT_ID;
export const isLinked = () => !!GOOGLE_CLIENT_ID && localStorage.getItem(LINKED_KEY) === auth.currentUser?.email;

// Gets a fresh Gmail token from the server, no popup. False if this person isn't linked yet.
let renewing: Promise<boolean> | null = null;
export function silentRenew(): Promise<boolean> {
  if (!isLinked()) return Promise.resolve(false);
  renewing ??= httpsCallable<unknown, { token: string; expiresIn: number }>(fns, 'gmailToken')()
    .then((r) => (store(r.data.token, r.data.expiresIn), true))
    .catch((e) => {
      if (e?.code === 'functions/failed-precondition') localStorage.removeItem(LINKED_KEY);
      return false;
    })
    .finally(() => (renewing = null));
  return renewing;
}

function loadGis(): Promise<void> {
  const w = window as unknown as { google?: { accounts?: unknown } };
  if (w.google?.accounts) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', onload: () => ok(), onerror: fail });
    document.head.appendChild(s);
  });
}
// Preload so the popup can open straight from the click.
if (GOOGLE_CLIENT_ID) loadGis().catch(() => {});

// One-time (from a click): Google's consent popup, after which renewals are silent.
export async function linkGoogle(): Promise<void> {
  await loadGis();
  const code = await new Promise<string>((ok, fail) => {
    type CodeClient = { requestCode: () => void };
    const g = (window as unknown as { google: { accounts: { oauth2: { initCodeClient: (c: object) => CodeClient } } } }).google;
    g.accounts.oauth2
      .initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        ux_mode: 'popup',
        login_hint: auth.currentUser?.email ?? '',
        callback: (r: { code?: string; error?: string }) => (r.code ? ok(r.code) : fail(new Error(r.error ?? 'cancelled'))),
        error_callback: (e: { message?: string }) => fail(new Error(e?.message ?? 'popup closed')),
      })
      .requestCode();
  });
  const r = await httpsCallable<{ code: string }, { token: string; expiresIn: number }>(fns, 'linkGoogle')({ code });
  localStorage.setItem(LINKED_KEY, auth.currentUser?.email ?? '');
  store(r.data.token, r.data.expiresIn);
}

export async function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LINKED_KEY);
  await fbSignOut(auth);
}
