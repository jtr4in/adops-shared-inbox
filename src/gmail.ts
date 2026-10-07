import { getGmailToken, signIn } from './firebase';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmail<T>(path: string, init?: RequestInit, retried = false, attempt = 0): Promise<T> {
  const token = getGmailToken() ?? (await signIn());
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 401 && !retried) {
    await signIn();
    return gmail(path, init, true);
  }
  if ((res.status === 403 || res.status === 429) && attempt < 4) {
    const body = await res.clone().text();
    if (/rateLimitExceeded|userRateLimitExceeded|Quota exceeded/i.test(body)) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      return gmail(path, init, retried, attempt + 1);
    }
  }
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`);
  return res.json();
}

interface Header {
  name: string;
  value: string;
}
interface Part {
  mimeType: string;
  filename?: string;
  headers?: Header[];
  body?: { data?: string; size: number; attachmentId?: string };
  parts?: Part[];
}
interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: Part;
}

export interface Message {
  id: string;
  threadId: string;
  messageId: string; // RFC 822 Message-ID, identical in every mailbox
  references: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: number;
  snippet: string;
  unread: boolean;
  html?: string;
  attachments: string[];
}

export interface ThreadSummary {
  threadId: string;
  key: string; // shared Firestore key, from the first message's Message-ID
  subject: string;
  from: string;
  to: string;
  cc: string;
  snippet: string;
  date: number;
  count: number;
  unread: boolean;
}

const header = (p: Part, name: string) =>
  p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

function decode(data: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function findPart(p: Part, mime: string): Part | undefined {
  if (p.mimeType === mime && p.body?.data && !p.filename) return p;
  for (const child of p.parts ?? []) {
    const hit = findPart(child, mime);
    if (hit) return hit;
  }
}

function attachmentNames(p: Part): string[] {
  const own = p.filename ? [p.filename] : [];
  return own.concat(...(p.parts ?? []).map(attachmentNames));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parse(m: RawMessage, withBody: boolean): Message {
  const p = m.payload;
  let html: string | undefined;
  if (withBody) {
    const h = findPart(p, 'text/html');
    const t = findPart(p, 'text/plain');
    html = h?.body?.data
      ? decode(h.body.data)
      : t?.body?.data
        ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(decode(t.body.data))}</pre>`
        : '';
  }
  return {
    id: m.id,
    threadId: m.threadId,
    messageId: header(p, 'Message-ID'),
    references: header(p, 'References'),
    from: header(p, 'From'),
    to: header(p, 'To'),
    cc: header(p, 'Cc'),
    subject: header(p, 'Subject'),
    date: Number(m.internalDate),
    snippet: m.snippet,
    unread: m.labelIds?.includes('UNREAD') ?? false,
    html,
    attachments: withBody ? attachmentNames(p) : [],
  };
}

export const threadKey = (messageId: string) =>
  messageId.replace(/[<>]/g, '').replace(/\//g, '_') || 'unknown';

const META = ['Subject', 'From', 'To', 'Cc', 'Date', 'Message-ID', 'References']
  .map((h) => `metadataHeaders=${h}`)
  .join('&');

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// Thread summaries cached by threadId + historyId, so a refresh only
// re-fetches threads that actually changed.
const summaryCache = new Map<string, { historyId: string; summary: ThreadSummary }>();

function summarize(t: { messages: RawMessage[] }): ThreadSummary {
  const msgs = t.messages.map((m) => parse(m, false));
  const first = msgs[0];
  const last = msgs[msgs.length - 1];
  return {
    threadId: first.threadId,
    key: threadKey(first.messageId),
    subject: first.subject || '(no subject)',
    from: last.from,
    to: last.to,
    cc: last.cc,
    snippet: last.snippet,
    date: last.date,
    count: msgs.length,
    unread: msgs.some((m) => m.unread),
  };
}

export async function listThreads(
  q: string,
  max = 30,
  pageToken?: string,
): Promise<{ threads: ThreadSummary[]; next?: string }> {
  const list = await gmail<{ threads?: { id: string; historyId: string }[]; nextPageToken?: string }>(
    `/threads?maxResults=${max}&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ''}`,
  );
  const threads = await mapLimit(list.threads ?? [], 4, async (t) => {
    const hit = summaryCache.get(t.id);
    if (hit && hit.historyId === t.historyId) return hit.summary;
    const full = await gmail<{ messages: RawMessage[] }>(`/threads/${t.id}?format=metadata&${META}`);
    const summary = summarize(full);
    summaryCache.set(t.id, { historyId: t.historyId, summary });
    return summary;
  });
  return { threads, next: list.nextPageToken };
}

export async function getThread(threadId: string): Promise<Message[]> {
  const t = await gmail<{ messages: RawMessage[] }>(`/threads/${threadId}?format=full`);
  return t.messages.map((m) => parse(m, true));
}

export interface SendAs {
  sendAsEmail: string;
  displayName: string;
  signature?: string;
  isDefault?: boolean;
}

export async function listSendAs(): Promise<SendAs[]> {
  const r = await gmail<{ sendAs: SendAs[] }>('/settings/sendAs');
  return r.sendAs;
}

// "Name <a@b.com>, c@d.com" -> ["a@b.com", "c@d.com"]
export function addresses(list: string): string[] {
  return list
    .split(',')
    .map((s) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

export const displayName = (addr: string) =>
  addr.replace(/<.*>/, '').replace(/"/g, '').trim() || addr.replace(/[<>]/g, '');

function encodeHeader(s: string) {
  // RFC 2047 so non-ASCII subjects survive
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

function base64url(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Outgoing {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

export async function send(o: Outgoing) {
  const lines = [
    `From: ${o.from}`,
    `To: ${o.to.join(', ')}`,
    o.cc.length ? `Cc: ${o.cc.join(', ')}` : '',
    `Subject: ${encodeHeader(o.subject)}`,
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : '',
    o.references ? `References: ${o.references}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ].filter(Boolean);
  const raw = base64url(`${lines.join('\r\n')}\r\n\r\n${o.html}`);
  return gmail('/messages/send', { method: 'POST', body: JSON.stringify({ raw, threadId: o.threadId }) });
}
