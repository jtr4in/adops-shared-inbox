import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './config';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
provider.addScope('https://www.googleapis.com/auth/gmail.send');

// Firebase does not refresh Google access tokens, so we keep the one from the
// last popup and ask again when Gmail rejects it (tokens last about an hour).
const TOKEN_KEY = 'gmailToken';

export function getGmailToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export async function signIn(): Promise<string> {
  const hint = auth.currentUser?.email;
  provider.setCustomParameters(hint ? { login_hint: hint } : { prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google did not return a Gmail access token');
  sessionStorage.setItem(TOKEN_KEY, token);
  return token;
}

export async function signOut() {
  sessionStorage.removeItem(TOKEN_KEY);
  await fbSignOut(auth);
}
