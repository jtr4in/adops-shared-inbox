import { getGmailToken, markTokenExpired } from './firebase';
import { GROUP_ADDRESSES } from './config';

export class AuthExpiredError extends Error {
  constructor() {
    super('Your Google session expired. Click Reconnect to keep syncing.');
  }
}

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmail<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const token = getGmailToken();
  if (!token) {
    markTokenExpired();
    throw new AuthExpiredError();
  }
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // "Failed to fetch" = a network blip (Wi-Fi drop, VPN, laptop waking up). Retry quietly.
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      return gmail(path, init, attempt + 1);
    }
    throw new Error("Couldn't reach Gmail. Check your internet connection and try again.");
  }
  if (res.status === 401) {
    markTokenExpired();
    throw new AuthExpiredError();
  }
  if ((res.status === 403 || res.status === 429) && attempt < 4) {
    const body = await res.clone().text();
    if (/rateLimitExceeded|userRateLimitExceeded|Quota exceeded/i.test(body)) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      return gmail(path, init, attempt + 1);
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
  bcc?: string;
  replyTo?: string; // where replies should go (groups put the real sender here)
  subject: string;
  date: number;
  snippet: string;
  unread: boolean;
  html?: string;
  attachments: Attachment[];
}

export interface Attachment {
  messageId: string;
  attachmentId: string;
  name: string;
  mimeType: string;
  size: number;
  contentId?: string; // set for images embedded in the email body (cid:)
  data?: string; // small parts arrive inline instead of by attachmentId
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
  sent: boolean; // last message was sent from this mailbox
  people: number; // distinct addresses across the chain
  firstTo: string[];
  inInbox: boolean;
  // For smart folders: every address in the chain and the first email's preview, so a folder
  // keeps matching after we reply (when the newest sender and preview are ours).
  participants?: string;
  firstSnippet?: string;
  hasFiles?: boolean; // some message has attachments // in this person's Gmail inbox (not archived) // To of the first message, for smart assignment
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

function attachmentsOf(p: Part, messageId: string): Attachment[] {
  const cid = header(p, 'Content-ID').replace(/[<>]/g, '');
  const own: Attachment[] =
    (p.filename || cid) && (p.body?.attachmentId || (cid && p.body?.data))
      ? [
          {
            messageId,
            attachmentId: p.body?.attachmentId ?? '',
            name: p.filename || cid,
            mimeType: p.mimeType,
            size: p.body?.size ?? 0,
            contentId: cid || undefined,
            data: p.body?.data,
          },
        ]
      : [];
  return own.concat(...(p.parts ?? []).map((c) => attachmentsOf(c, messageId)));
}

// Returns standard base64 (not base64url), ready for a MIME part or a data URL.
export async function getAttachmentData(a: Attachment): Promise<string> {
  const raw = a.data ?? (await gmail<{ data: string }>(`/messages/${a.messageId}/attachments/${a.attachmentId}`)).data;
  return raw.replace(/-/g, '+').replace(/_/g, '/');
}

export async function downloadAttachment(a: Attachment) {
  const b64 = await getAttachmentData(a);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: a.mimeType }));
  const link = Object.assign(document.createElement('a'), { href: url, download: a.name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
    bcc: header(p, 'Bcc'), // only present on emails you sent
    // "X via MB_adops" <adops@> mail: Google Groups keeps the real sender in Reply-To or X-Original-Sender.
    replyTo: header(p, 'Reply-To') || header(p, 'X-Original-Sender'),
    subject: header(p, 'Subject'),
    date: Number(m.internalDate),
    snippet: m.snippet,
    unread: m.labelIds?.includes('UNREAD') ?? false,
    html,
    attachments: withBody ? attachmentsOf(p, m.id) : [],
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
// Kept in this browser (localStorage) so reopening the app doesn't re-download every email.
const CACHE_KEY = 'summaryCache:v4';
const summaryCache = new Map<string, { historyId: string; summary: ThreadSummary }>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]');
    } catch {
      return [];
    }
  })(),
);
function saveCache() {
  try {
    // Newest 500 only, to stay well under the browser's storage limit.
    const keep = [...summaryCache].sort((a, b) => b[1].summary.date - a[1].summary.date).slice(0, 500);
    localStorage.setItem(CACHE_KEY, JSON.stringify(keep));
  } catch {
    /* storage full or blocked: the in-memory cache still works */
  }
}

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
    // Gmail labels mail the group relays ("X via adops") as Sent, since adops@ is one of
    // our send-as addresses. Only count it as ours if it isn't from the group itself.
    sent:
      (t.messages[t.messages.length - 1].labelIds?.includes('SENT') ?? false) &&
      !addresses(last.from).some((a) => GROUP_ADDRESSES.includes(a)),
    people: chainPeople(msgs).length,
    participants: chainPeople(msgs).join(', '),
    firstSnippet: first.snippet,
    firstTo: addresses(first.to),
    inInbox: t.messages.some((m) => m.labelIds?.includes('INBOX')),
    hasFiles: t.messages.some((m) => m.payload?.mimeType === 'multipart/mixed'),
  };
}

export function chainPeople(msgs: Pick<Message, 'from' | 'to' | 'cc'>[]): string[] {
  const out = new Map<string, string>();
  for (const m of msgs) {
    for (const raw of [m.from, m.to, m.cc].join(',').split(',')) {
      const email = addresses(raw)[0];
      if (email && !out.has(email)) out.set(email, raw.trim());
    }
  }
  return [...out.values()];
}

export async function listThreads(
  q: string,
  max = 30,
  pageToken?: string,
): Promise<{ threads: ThreadSummary[]; next?: string }> {
  // List messages (strictly newest first), not threads: Gmail ranks threads oddly, e.g. a
  // reply the group relays in can sort weeks back and fall off the first page.
  const list = await gmail<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(
    `/messages?maxResults=${max * 2}&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ''}`,
  );
  const newest = new Map<string, string>(); // threadId -> newest matching message id
  for (const m of list.messages ?? []) if (!newest.has(m.threadId)) newest.set(m.threadId, m.id);
  // Use every thread on this page: the next page starts after all of these messages, so
  // anything cut here would never load.
  const threads = await mapLimit([...newest], 4, async ([id, latest]) => {
    const hit = summaryCache.get(id);
    if (hit && hit.historyId === latest) return hit.summary;
    const full = await gmail<{ messages: RawMessage[] }>(`/threads/${id}?format=metadata&${META}`);
    const summary = summarize(full);
    summaryCache.set(id, { historyId: latest, summary });
    return summary;
  });
  saveCache();
  // Gmail doesn't strictly order by newest message (a reply the group relays in can sort
  // as old), so order by the latest message ourselves.
  threads.sort((a, b) => b.date - a.date);
  return { threads, next: list.nextPageToken };
}

export async function getThread(threadId: string): Promise<Message[]> {
  const t = await gmail<{ messages: RawMessage[] }>(`/threads/${threadId}?format=full`);
  return t.messages.map((m) => parse(m, true));
}

export async function markRead(messageIds: string[], threadId?: string) {
  if (!messageIds.length) return;
  await gmail('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({ ids: messageIds, removeLabelIds: ['UNREAD'] }),
  });
  const hit = threadId && summaryCache.get(threadId);
  if (hit) hit.summary = { ...hit.summary, unread: false };
  else summaryCache.clear();
  saveCache();
}

// Archive (remove from Inbox) or un-archive a thread in the signed-in person's own Gmail.
export async function setArchived(threadId: string, archived: boolean) {
  await gmail(`/threads/${threadId}/modify`, {
    method: 'POST',
    body: JSON.stringify(archived ? { removeLabelIds: ['INBOX'] } : { addLabelIds: ['INBOX'] }),
  });
  const hit = summaryCache.get(threadId);
  if (hit) hit.summary = { ...hit.summary, inInbox: !archived };
  saveCache();
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
  bcc?: string[];
  subject: string;
  html: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  files?: OutgoingFile[];
}

export interface OutgoingFile {
  name: string;
  mimeType: string;
  base64: string; // standard base64
}

export const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

export function fileToOutgoing(f: File): Promise<OutgoingFile> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () =>
      resolve({
        name: f.name,
        mimeType: f.type || 'application/octet-stream',
        base64: String(r.result).split(',')[1] ?? '',
      });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export async function send(o: Outgoing) {
  const lines = [
    `From: ${o.from}`,
    `To: ${o.to.join(', ')}`,
    o.cc.length ? `Cc: ${o.cc.join(', ')}` : '',
    // Gmail delivers to Bcc and strips the header before anyone else sees it.
    o.bcc?.length ? `Bcc: ${o.bcc.join(', ')}` : '',
    `Subject: ${encodeHeader(o.subject)}`,
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : '',
    o.references ? `References: ${o.references}` : '',
    'MIME-Version: 1.0',
  ].filter(Boolean);
  // Pasted images live in the editor as data: URLs, which mail apps block. Send them as
  // inline parts (cid:) so they show in the email like Gmail/Outlook pasted images do.
  const inline: { cid: string; mimeType: string; base64: string }[] = [];
  const html = o.html.replace(/src="data:([^;"]+);base64,([^"]+)"/g, (_m, type: string, data: string) => {
    const cid = `img${inline.length}_${Math.random().toString(36).slice(2)}@adops`;
    inline.push({ cid, mimeType: type, base64: data });
    return `src="cid:${cid}"`;
  });
  const wrap = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');
  const htmlPart = 'Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n' + html;
  let body = htmlPart;
  if (inline.length) {
    const rb = `=_rel_${Math.random().toString(36).slice(2)}`;
    body =
      `Content-Type: multipart/related; boundary="${rb}"\r\n\r\n` +
      [
        `--${rb}\r\n${htmlPart}`,
        ...inline.map(
          (i) =>
            `--${rb}\r\nContent-Type: ${i.mimeType}\r\nContent-ID: <${i.cid}>\r\n` +
            `Content-Disposition: inline\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(i.base64)}`,
        ),
      ].join('\r\n') +
      `\r\n--${rb}--`;
  }
  let mime: string;
  if (!o.files?.length) {
    mime = `${lines.join('\r\n')}\r\n${body}`;
  } else {
    const b = `=_part_${Math.random().toString(36).slice(2)}`;
    lines.push(`Content-Type: multipart/mixed; boundary="${b}"`);
    const parts = [
      `--${b}\r\n${body}`,
      ...o.files.map(
        (f) =>
          `--${b}\r\nContent-Type: ${f.mimeType}; name="${encodeHeader(f.name)}"\r\n` +
          `Content-Disposition: attachment; filename="${encodeHeader(f.name)}"\r\n` +
          `Content-Transfer-Encoding: base64\r\n\r\n${wrap(f.base64)}`,
      ),
    ];
    mime = `${lines.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${b}--`;
  }
  const raw = base64url(mime);
  return gmail('/messages/send', { method: 'POST', body: JSON.stringify({ raw, threadId: o.threadId }) });
}

// Address book for autofill: everyone seen in your recent emails, plus people you've sent to.
export interface Contact {
  email: string;
  name: string;
  count: number;
}
const SENT_TO_KEY = 'sentTo:v1';
export function rememberRecipients(emails: string[]) {
  try {
    const cur: string[] = JSON.parse(localStorage.getItem(SENT_TO_KEY) ?? '[]');
    localStorage.setItem(SENT_TO_KEY, JSON.stringify([...emails, ...cur.filter((e) => !emails.includes(e))].slice(0, 300)));
  } catch {
    /* ignore */
  }
}
export function knownContacts(): Contact[] {
  const map = new Map<string, Contact>();
  const add = (raw: string, weight: number) => {
    for (const part of raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      const email = addresses(part)[0];
      if (!email) continue;
      const name = part.includes('<') ? part.split('<')[0].replace(/["']/g, '').replace(/ via .*/, '').trim() : '';
      const c = map.get(email) ?? { email, name: '', count: 0 };
      c.count += weight;
      if (!c.name && name) c.name = name;
      map.set(email, c);
    }
  };
  for (const { summary: s } of summaryCache.values()) [s.from, s.to, s.cc].forEach((r) => add(r ?? '', 1));
  try {
    for (const e of JSON.parse(localStorage.getItem(SENT_TO_KEY) ?? '[]') as string[]) add(e, 5);
  } catch {
    /* ignore */
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// Fill in images pasted into emails (src="cid:..."). Runs after the email is already on
// screen, so text shows instantly and screenshots pop in as they download.
const imageCache = new Map<string, string>();
export async function withInlineImages(msgs: Message[]): Promise<Message[]> {
  const out = msgs.map((m) => ({ ...m }));
  // Images embedded in the email (src="cid:...") live in attachments: swap in the real image.
  await Promise.all(
    out.map(async (m) => {
      const embedded = new Set<Attachment>();
      for (const a of m.attachments) {
        if (!a.contentId || !m.html?.includes(`cid:${a.contentId}`)) continue;
        try {
          const k = `${a.messageId}/${a.attachmentId || a.contentId}`;
          const url = imageCache.get(k) ?? `data:${a.mimeType};base64,${await getAttachmentData(a)}`;
          imageCache.set(k, url);
          m.html = m.html.split(`cid:${a.contentId}`).join(url);
          embedded.add(a);
        } catch {
          /* leave the broken image */
        }
      }
      // Embedded images show in the email itself, so don't list them as attachments too.
      m.attachments = m.attachments.filter((a) => !embedded.has(a));
    }),
  );
  return out;
}

export async function attachmentBytes(a: Attachment): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(atob(await getAttachmentData(a)), (c) => c.charCodeAt(0));
}

// Uploads the file to the user's Drive as a Google Sheet and returns its URL.
export async function openInSheets(a: Attachment): Promise<string> {
  const bytes = await attachmentBytes(a);
  const token = getGmailToken();
  const meta = { name: a.name.replace(/\.[^.]+$/, ''), mimeType: 'application/vnd.google-apps.spreadsheet' };
  const body = new FormData();
  body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  // Emails often label CSVs "application/octet-stream", which Drive won't convert: go by extension.
  const types: Record<string, string> = {
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
  };
  const type = types[a.name.split('.').pop()?.toLowerCase() ?? ''] ?? a.mimeType;
  body.append('file', new Blob([bytes], { type }));
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
  });
  if (res.status === 401 || res.status === 403)
    throw new Error('Google needs one more permission for Sheets. Sign out and back in (or reconnect), then try again.');
  if (!res.ok) {
    const why = (await res.json().catch(() => null))?.error?.message ?? '';
    throw new Error(`Drive upload failed (${res.status}) ${why}`);
  }
  const { id } = await res.json();
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
