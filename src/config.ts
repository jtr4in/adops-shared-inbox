const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const GROUP_ADDRESS: string = env.VITE_GROUP_ADDRESS || 'adops@maxbounty.com';
// Other addresses that land in the same shared inbox (comma-separated in VITE_GROUP_ALIASES).
export const GROUP_ADDRESSES: string[] = [
  GROUP_ADDRESS,
  ...(env.VITE_GROUP_ALIASES ?? 'advertisers@maxbounty.com').split(',').map((a: string) => a.trim().toLowerCase()).filter(Boolean),
];

export interface Teammate {
  email: string; // the Google account they sign in with
  name: string;
  aliases: string[]; // every address that means "this person" (for auto-assign)
}

// "email|alias|alias:Name,email:Name"
export const TEAM: Teammate[] = (env.VITE_TEAM || '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)
  .map((s: string) => {
    const [emails, name] = s.split(':');
    const all = emails.split('|').map((e) => e.trim().toLowerCase());
    return { email: all[0], name: name || all[0], aliases: all };
  });

export const teammateName = (email?: string | null) =>
  TEAM.find((t) => t.email === email)?.name ?? email ?? '';

const G = GROUP_ADDRESS;
// Gmail's {a b c} means "a OR b OR c".
// deliveredto: also catches mail where adops@ was Bcc'd or forwarded in.
const TO_GROUP = `{${GROUP_ADDRESSES.map((g) => `list:${g} to:${g} cc:${g} from:${g} deliveredto:${g}`).join(' ')}}`;

export type Mailbox = 'team' | 'me' | 'all' | 'sent';

export const MAILBOXES: { id: Mailbox; label: string; query: string }[] = [
  { id: 'all', label: 'All combined', query: `{${TO_GROUP.slice(1, -1)} in:inbox}` },
  { id: 'team', label: `Team (${G.split('@')[0]}@)`, query: TO_GROUP },
  { id: 'me', label: 'Just to me', query: `in:inbox -${TO_GROUP}` },
  { id: 'sent', label: 'Sent', query: 'in:sent' },
];

export const DATE_RANGES = [30, 90, 180, 365];

// "Just to me" = addressed To/Cc one of my own addresses (my login + my aliases in VITE_TEAM),
// and not part of the shared inbox.
export const myAddresses = (me: string) => [me, ...(TEAM.find((t) => t.email === me)?.aliases ?? [])];

export function mailboxQuery(id: Mailbox, days: number, me = ''): string {
  if (id === 'me' && me) {
    const mine = [...new Set(myAddresses(me))].map((a) => `to:${a} cc:${a}`).join(' ');
    return `{${mine}} -${TO_GROUP} newer_than:${days}d`;
  }
  return `${MAILBOXES.find((m) => m.id === id)!.query} newer_than:${days}d`;
}

// Smart folders. AdOps folders are shared (first match wins; anything unmatched is General
// Inquiries). "My" folders are per person and just filter: a thread shows in every one it matches.
// Keywords are comma-separated and matched as whole words against subject, preview and sender.
// Anyone can override a thread's AdOps folder from the thread header.
export interface Folder {
  name: string;
  keywords: string;
}

export const FALLBACK_FOLDER = 'General Inquiries';

export const DEFAULT_FOLDERS: Folder[] = [
  { name: 'Contracts & Amendments', keywords: 'contract, amend, amendment, agreement, terms, insertion order, IO, docusign, signed' },
  { name: 'Billing & Invoices', keywords: 'invoice, billing, payment, remit, remittance, statement, accounting, paid, payout' },
  { name: 'Intros & Campaign Setup', keywords: 'intro, introduction, welcome, onboard, onboarding, setup, set up, launch, pixel, postback, tracking, new campaign, creative, creatives, promo' },
  { name: 'Account & Status Updates', keywords: 'status, update, pause, paused, resume, live, account, notification, cap, budget, change, report, caps' },
];

// Live lists, replaced in place when the saved settings load (see useFolders).
export const CATEGORIES: { name: string }[] = [];
let shared: Folder[] = [];
export let MY_FOLDERS: Folder[] = [];

export function setSharedFolders(list: Folder[]) {
  shared = list;
  CATEGORIES.splice(0, CATEGORIES.length, ...list.map((f) => ({ name: f.name })), { name: FALLBACK_FOLDER });
}
export const sharedFolders = () => shared;
export function setMyFolders(list: Folder[]) {
  MY_FOLDERS = list;
}
setSharedFolders(DEFAULT_FOLDERS);

const keywordRe = new Map<string, RegExp | null>();
export function folderMatches(f: Folder, text: string): boolean {
  let re = keywordRe.get(f.keywords);
  if (re === undefined) {
    // Words of 4+ letters match as a prefix ("amend" finds "amendment"); short ones like "IO"
    // only match whole (so not "iOS"). "@brand.com" style keywords match anywhere.
    const parts = f.keywords.split(',').map((w) => w.trim()).filter(Boolean).map((w) => {
      const body = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      const lead = /^[a-z0-9]/i.test(w) ? '(?<![a-z0-9])' : '';
      return lead + body + (w.length >= 4 ? '' : '(?![a-z0-9])');
    });
    re = parts.length ? new RegExp(parts.join('|'), 'i') : null;
    keywordRe.set(f.keywords, re);
  }
  return !!re && re.test(text);
}

// Text a folder's keywords are checked against: subject, latest + first preview, everyone on the chain.
export const folderText = (t: { subject: string; snippet: string; from?: string; firstSnippet?: string; participants?: string }) =>
  `${t.subject} ${t.snippet} ${t.firstSnippet ?? ''} ${t.from ?? ''} ${t.participants ?? ''}`;

export function categorize(text: string): string {
  return shared.find((f) => folderMatches(f, text))?.name ?? FALLBACK_FOLDER;
}

// Smart assignment: an email addressed To exactly one teammate (any of their
// addresses) belongs to that teammate.
// Failing that, an email that opens with "Hi Riley" / "Hey Jason," etc. goes to that person.
export function autoAssignee(to: string[], snippet = ''): string | null {
  const hits = TEAM.filter((t) => t.aliases.some((a) => to.includes(a)));
  if (hits.length === 1) return hits[0].email;
  const greeted = TEAM.filter((t) => {
    const first = t.name.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '');
    return new RegExp(`^\\W*(hi|hey|hello|dear|morning|good (morning|afternoon))?\\W*${first}\\b`, 'i').test(snippet);
  });
  if (greeted.length !== 1) return null;
  // "Hi Jason and Riley" greets both: leave it unassigned.
  const opening = snippet.slice(0, 40).toLowerCase();
  const others = TEAM.filter((t) => t !== greeted[0] && opening.includes(t.name.split(' ')[0].toLowerCase()));
  return others.length ? null : greeted[0].email;
}
