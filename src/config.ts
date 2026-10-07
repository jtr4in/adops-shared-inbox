const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const GROUP_ADDRESS: string = env.VITE_GROUP_ADDRESS || 'adops@maxbounty.com';

export interface Teammate {
  email: string;
  name: string;
}

// "email:Name,email:Name"
export const TEAM: Teammate[] = (env.VITE_TEAM || '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)
  .map((s: string) => {
    const [email, name] = s.split(':');
    return { email: email.toLowerCase(), name: name || email };
  });

export const teammateName = (email?: string | null) =>
  TEAM.find((t) => t.email === email)?.name ?? email ?? '';

// Gmail search that finds mail sent to the group in each person's own mailbox.
export const GROUP_QUERY = `(list:${GROUP_ADDRESS} OR to:${GROUP_ADDRESS} OR cc:${GROUP_ADDRESS}) newer_than:60d`;
