import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, TEAM, teammateName } from '../config';
import { setArchived, displayName, downloadAttachment, getThread, markRead, withInlineImages, type Attachment, type Message, type ThreadSummary } from '../gmail';
import { AttachmentPreview, canPreview } from './AttachmentPreview';
import { addNote, categoryOf, updateTriage, useNotes, type Presence, type Triage } from '../triage';
import { formatDate } from './ThreadList';
import { trackSelection } from '../selection';
import { Composer, kb, type ReplyMode } from './Composer';

interface Props {
  summary: ThreadSummary;
  triage: Triage | undefined;
  me: string;
  others: Presence[]; // teammates on this same thread right now
  onComposing: (composing: boolean) => void;
}

export function ThreadView({ summary, triage, me, others, onComposing }: Props) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reply, setReply] = useState<ReplyMode | null>(null);
  const notes = useNotes(summary.key);
  const [note, setNote] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const openNotes = () => {
    setNotesOpen(true);
    setTimeout(() => notesRef.current?.focus(), 0);
  };

  const load = () =>
    getThread(summary.threadId)
      .then((m) => {
        setMessages(m);
        withInlineImages(m).then(setMessages).catch(() => {});
        setOpen(new Set([m[m.length - 1].id]));
        markRead(m.filter((x) => x.unread).map((x) => x.id), summary.threadId).catch(() => {});
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Reload when a new message lands in this thread during auto-sync.
  }, [summary.threadId, summary.count]);
  const notesRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Triage>) => updateTriage(summary.key, summary.subject, patch);
  useEffect(() => {
    onComposing(reply !== null);
    return () => onComposing(false);
  }, [reply, onComposing]);
  const replying = others.filter((o) => o.composing);
  // Done also archives the thread in your own Gmail; Reopen moves it back to your inbox.
  const toggleDone = () => {
    const done = !triage?.done;
    set({ done });
    setArchived(summary.threadId, done).catch((e) => setError(String(e)));
  };

  // Keyboard shortcuts from the inbox.
  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<string>).detail;
      if (a === 'reply' || a === 'replyAll' || a === 'forward') setReply(a);
      if (a === 'done') toggleDone();
      if (a === 'flag') set({ flagged: !triage?.flagged });
      if (a === 'assignMe') set({ assignee: me });
      if (a === 'note') openNotes();
    };
    window.addEventListener('thread-action', on);
    return () => window.removeEventListener('thread-action', on);
  });
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="thread">
      <div className="thread-head">
        <h2>{summary.subject}</h2>
        <div className="actions">
          <div className="group">
            <button className="primary" onClick={() => setReply('replyAll')}>↩ Reply all</button>
            <button onClick={() => setReply('reply')}>Reply</button>
            <button onClick={() => setReply('forward')}>Forward</button>
          </div>
          <span className="spacer" />
          <div className="group">
            <select
              className={`assignee ${triage?.assignee ? 'set' : ''}`}
              value={triage?.assignee ?? ''}
              onChange={(e) => set({ assignee: e.target.value || null })}
              title="Assigned to"
            >
              <option value="">👤 Unassigned</option>
              {TEAM.map((t) => (
                <option key={t.email} value={t.email}>
                  👤 {t.email === me ? `${t.name} (me)` : t.name}
                </option>
              ))}
            </select>
            <button
              className={`icon-btn ${triage?.flagged ? 'on flagged' : ''}`}
              title={triage?.flagged ? 'Unflag' : 'Flag for help'}
              onClick={() => set({ flagged: !triage?.flagged })}
            >
              ⚑
            </button>
            <button className="icon-btn" title="Private note" onClick={() => openNotes()}>
              🔒
            </button>
            <button className={triage?.done ? 'on' : 'done-btn'} onClick={toggleDone}>
              {triage?.done ? 'Reopen' : '✓ Done'}
            </button>
          </div>
        </div>
        {messages && (
          <div className="chain">
            <select
              className="cat-select"
              value={categoryOf(summary, triage)}
              onChange={(e) => set({ category: e.target.value })}
              title="Smart folder"
            >
              {CATEGORIES.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
            <span className="muted small">
              {messages.length} message{messages.length > 1 ? 's' : ''}
            </span>
          </div>
        )}
        {others.length > 0 && (
          <div className={`presence-bar ${replying.length ? 'hot' : ''}`}>
            {replying.length
              ? `✍ ${replying.map((o) => teammateName(o.email)).join(', ')} is writing a reply to this right now. Check with them before you send.`
              : `👀 ${others.map((o) => teammateName(o.email)).join(', ')} is looking at this email`}
          </div>
        )}
        {triage?.updatedBy && (
          <div className="muted small">
            Last change by {teammateName(triage.updatedBy)}
            {triage.updatedAt && ` · ${formatDate(triage.updatedAt.toMillis())}`}
          </div>
        )}
      </div>

      <div className="thread-body">
        {error && <div className="error">{error}</div>}
        {!messages && !error && <div className="muted">Loading…</div>}
        <div className={`notes ${notesOpen ? 'open' : ''}`}>
          <button className="notes-toggle" onClick={() => setNotesOpen(!notesOpen)}>
            🔒 Team notes{notes.length ? ` (${notes.length})` : ''} <span className="muted small">only visible here, never emailed</span>
            <span className="spacer" />
            {notesOpen ? '▴' : '▾'}
          </button>
          {notesOpen && (
          <>
          {notes.map((n) => (
            <div key={n.id} className="note">
              <strong>{teammateName(n.author)}</strong>
              <span className="muted small"> {n.createdAt && formatDate(n.createdAt.toMillis())}</span>
              <div>{n.text}</div>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              addNote(summary.key, note.trim());
              setNote('');
            }}
          >
            <input ref={notesRef} placeholder="Add a private note for the team…" value={note} onChange={(e) => setNote(e.target.value)} />
          </form>
          </>
          )}
        </div>
        {reply && messages && (
          <Composer
            key={reply}
            mode={reply}
            messages={messages}
            subject={summary.subject}
            me={me}
            onClose={() => setReply(null)}
            othersReplying={replying.map((o) => teammateName(o.email))}
            onSent={() => {
              setReply(null);
              load();
            }}
          />
        )}

        {messages?.slice().reverse().map((m) => (
          <article key={m.id} className="message">
            <header onClick={() => toggle(m.id)}>
              <strong>{displayName(m.from)}</strong>
              {files(m).length > 0 && <span className="clip" title="Has attachments">📎</span>}
              <span className="date">{formatDate(m.date)}</span>
            </header>
            <div className="recips">
              <div><b>To:</b> {m.to}</div>
              {m.cc && <div><b>Cc:</b> {m.cc}</div>}
              {m.bcc && <div><b>Bcc:</b> {m.bcc}</div>}
            </div>
            {open.has(m.id) ? (
              <MailBody html={m.html ?? ''} />
            ) : (
              <div className="snippet" onClick={() => toggle(m.id)}>{m.snippet}</div>
            )}
            {files(m).length > 0 && (
              <div className="attach-list">
                {files(m).map((a) => (
                  <span key={a.attachmentId} className="attach">
                    <button onClick={() => (canPreview(a) ? setPreview(a) : downloadAttachment(a))} title={canPreview(a) ? 'Preview' : 'Download'}>
                      📎 {a.name} <span className="muted">({kb(a.size)})</span>
                    </button>
                    <button onClick={() => downloadAttachment(a)} title="Save">⤓</button>
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}

      </div>
      {preview && <AttachmentPreview a={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

// Real attachments (not images pasted into the body, which show inside the email).
const files = (m: Message) => m.attachments.filter((a) => !(a.contentId && m.html?.includes(`cid:${a.contentId}`)));

// Email HTML is rendered in a sandboxed iframe: no scripts, links open in a new tab.
function MailBody({ html }: { html: string }) {
  const [height, setHeight] = useState(100);
  const [zoom, setZoom] = useState<string | null>(null);
  const doc = `<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;margin:0;word-wrap:break-word}img{max-width:100%}</style>${html}`;
  return (
    <>
    {zoom && (
      <div className="lightbox" onClick={() => setZoom(null)} title="Click to close">
        <img src={zoom} alt="" />
      </div>
    )}
    <iframe
      className="mail"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height }}
      onLoad={(e) => {
        const d = e.currentTarget.contentDocument;
        if (d?.body) setHeight(d.body.scrollHeight + 16);
        if (d) trackSelection(d);
        // Click an image (that isn't a link) to see it full size.
        d?.querySelectorAll('img').forEach((img) => {
          if (img.closest('a') || img.naturalWidth < 40) return;
          img.style.cursor = 'zoom-in';
          img.addEventListener('click', () => setZoom(img.src));
        });
      }}
    />
    </>
  );
}
