// Keeps Gmail signed in without popups. Google browser tokens last an hour; a refresh
// token can mint new ones, but it needs a client secret, so it has to live on a server.
//  - linkGoogle: one-time, swaps the code from Google's consent popup for a refresh token
//    (stored server-side only) and returns a fresh access token.
//  - gmailToken: returns a fresh access token from the stored refresh token. No popup.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();
const CLIENT_ID = defineString('GOOGLE_CLIENT_ID');
const CLIENT_SECRET = defineSecret('GOOGLE_CLIENT_SECRET');
const TEAM = defineString('TEAM_EMAILS'); // comma-separated sign-in emails

type TokenReply = { access_token: string; expires_in: number; refresh_token?: string; error?: string };

async function google(params: Record<string, string>): Promise<TokenReply> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID.value(), client_secret: CLIENT_SECRET.value(), ...params }),
  });
  const body = (await res.json()) as TokenReply;
  if (!res.ok) throw new HttpsError('failed-precondition', body.error ?? `google ${res.status}`);
  return body;
}

function who(auth: { token: { email?: string } } | undefined): string {
  const email = auth?.token.email?.toLowerCase();
  const team = TEAM.value().toLowerCase().split(',').map((s) => s.trim());
  if (!email || !team.includes(email)) throw new HttpsError('permission-denied', 'not on the team');
  return email;
}

const opts = { secrets: [CLIENT_SECRET], cors: true, maxInstances: 2 };

export const linkGoogle = onCall<{ code: string }>(opts, async (req) => {
  const email = who(req.auth);
  const t = await google({ code: req.data.code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });
  // Make sure the Google account that consented is the one signed in here.
  const info = (await (await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${t.access_token}`)).json()) as { email?: string };
  if (info.email?.toLowerCase() !== email) throw new HttpsError('permission-denied', `signed in to Google as ${info.email}`);
  if (t.refresh_token) await db.doc(`private/${email}`).set({ refreshToken: t.refresh_token, linkedAt: new Date() });
  return { token: t.access_token, expiresIn: t.expires_in };
});

export const gmailToken = onCall(opts, async (req) => {
  const email = who(req.auth);
  const refresh = (await db.doc(`private/${email}`).get()).data()?.refreshToken as string | undefined;
  if (!refresh) throw new HttpsError('failed-precondition', 'not linked');
  try {
    const t = await google({ refresh_token: refresh, grant_type: 'refresh_token' });
    return { token: t.access_token, expiresIn: t.expires_in };
  } catch (e) {
    // Revoked or expired: forget it so the app asks once more.
    await db.doc(`private/${email}`).delete();
    throw e;
  }
});
