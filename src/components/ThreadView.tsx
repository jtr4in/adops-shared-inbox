import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, TEAM, teammateName } from '../config';
import { chainPeople, displayName, downloadAttachment, getThread, markRead, type Message, type ThreadSummary } from '../gmail';
import { addNote, categoryOf, updateTriage, useNotes, type Triage } from '../triage';
import { formatDate } from './ThreadList';
import { Composer, kb, type ReplyMode } from './Composer';

interface Props {
  summary: ThreadSummary;
  triage: Triage | undefined;
  me: string;
}

export function ThreadView({ summary, triage, me }: Props) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reply, setReply] = useState<ReplyMode | null>(null);
  const notes = useNotes(summary.key);
  const [note, setNote] = useState('');

  const load = () =>
    getThread(summary.threadId)
      .then((m) => {
        setMessages(m);
        setOpen(new Set([m[m.length - 1].id]));
        markRead(m.filter((x) => x.unread).map((x) => x.id)).catch(() => {});
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Reload when a new message lands in this thread during auto-sync.
  }, [summary.threadId, summary.count]);
  const [showPeople, setShowPeople] = useState(false);
  const people = messages ? chainPeople(messages) : [];
  const notesRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<Triage>) => updateTriage(summary.key, summary.subject, patch);

  // Keyboard shortcuts from the inbox.
  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<string>).detail;
      if (a === 'reply' || a === 'replyAll' || a === 'forward') setReply(a);
      if (a === 'done') set({ done: !triage?.done });
      if (a === 'flag') set({ flagged: !triage?.flagged });
      if (a === 'assignMe') set({ assignee: me });
      if (a === 'note') notesRef.current?.focus();
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
            <button className="icon-btn" title="Private note" onClick={() => notesRef.current?.focus()}>
              🔒
            </button>
            <button className={triage?.done ? 'on' : 'done-btn'} onClick={() => set({ done: !triage?.done })}>
              {triage?.done ? 'Reopen' : '✓ Done'}
            </button>
          </div>
        </div>
        {messages && (
          <div className="chain">
            <button className="chip people" onClick={() => setShowPeople(!showPeople)}>
              👥 {people.length} in chain {showPeople ? '▴' : '▾'}
            </button>
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
            {showPeople && (
              <div className="people-list">
                {people.map((p) => (
                  <span key={p} className="person">
                    {p}
                  </span>
                ))}
              </div>
            )}
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
        {messages?.map((m) => (
          <article key={m.id} className="message">
            <header onClick={() => toggle(m.id)}>
              <strong>{displayName(m.from)}</strong>
              <span className="muted"> to {m.to}{m.cc && `, cc ${m.cc}`}</span>
              <span className="date">{formatDate(m.date)}</span>
            </header>
            {open.has(m.id) ? (
              <>
                <MailBody html={m.html ?? ''} />
                {m.attachments.length > 0 && (
                  <div className="attach-list">
                    {m.attachments.map((a) => (
                      <button key={a.attachmentId} className="attach" onClick={() => downloadAttachment(a)} title="Download">
                        📎 {a.name} <span className="muted">({kb(a.size)})</span> ⤓
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="snippet" onClick={() => toggle(m.id)}>{m.snippet}</div>
            )}
          </article>
        ))}

        {reply && messages && (
          <Composer
            key={reply}
            mode={reply}
            messages={messages}
            subject={summary.subject}
            me={me}
            onClose={() => setReply(null)}
            onSent={() => {
              setReply(null);
              load();
            }}
          />
        )}

        <div className="notes">
          <div className="section">Team notes (only visible here, never emailed)</div>
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
        </div>
      </div>
    </section>
  );
}

// Email HTML is rendered in a sandboxed iframe: no scripts, links open in a new tab.
function MailBody({ html }: { html: string }) {
  const [height, setHeight] = useState(100);
  const doc = `<base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;margin:0;word-wrap:break-word}img{max-width:100%}</style>${html}`;
  return (
    <iframe
      className="mail"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      style={{ height }}
      onLoad={(e) => {
        const body = e.currentTarget.contentDocument?.body;
        if (body) setHeight(body.scrollHeight + 16);
      }}
    />
  );
}
