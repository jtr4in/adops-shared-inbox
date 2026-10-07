import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AUTH_EXPIRED, AUTH_RENEWED, auth, getGmailToken, signIn, signOut, tokenExpiresAt } from './firebase';
import { CATEGORIES, DATE_RANGES, GROUP_ADDRESS, MAILBOXES, mailboxQuery, TEAM, teammateName, autoAssignee, type Mailbox } from './config';
import { AuthExpiredError, displayName, listThreads, setArchived, type ThreadSummary } from './gmail';
import { categoryOf, updateTriage, usePresence, useReportPresence, useTriage, type Triage } from './triage';
import { Sidebar, viewId, type View } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ThreadView } from './components/ThreadView';
import { SignatureDialog } from './components/SignatureDialog';
import { TemplatesDialog } from './components/TemplatesDialog';
import { Composer } from './components/Composer';
import { mbSearch } from './selection';

const SYNC_EVERY_MS = 60_000;

const SHORTCUTS: [string, string][] = [
  ['j / ↓', 'Next email'],
  ['k / ↑', 'Previous email'],
  ['a', 'Reply all'],
  ['r', 'Reply'],
  ['f', 'Forward'],
  ['m', 'Assign to me'],
  ['!', 'Flag / unflag'],
  ['e', 'Mark done / reopen'],
  ['n', 'Private note'],
  ['c', 'New email'],
  ['s', 'MB Search highlighted text'],
  ['/', 'Search'],
  ['?', 'This list'],
];

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [signInError, setSignInError] = useState('');
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (user === undefined) return <div className="center">Loading…</div>;
  const allowed = user?.email && (TEAM.length === 0 || TEAM.some((t) => t.email === user.email!.toLowerCase()));
  // Signed in to Firebase but the Gmail token lapsed (e.g. reopened next day): go straight to the inbox,
  // which shows a Reconnect banner instead of the full login page.
  if (!user || !allowed) {
    return (
      <div className="center login">
        <h1>AdOps Shared Inbox</h1>
        <p>Shared triage for {GROUP_ADDRESS}</p>
        {user && !allowed && <p className="error">{user.email} is not on the team list.</p>}
        <button
          className="primary"
          onClick={() =>
            signIn().catch((e) => setSignInError(`${e?.code ?? ''} ${e?.message ?? e}`))
          }
        >
          Sign in with Google
        </button>
        {signInError && <p className="error">{signInError}</p>}
        {user && <button onClick={signOut}>Use a different account</button>}
      </div>
    );
  }
  return <Inbox user={user} />;
}

function matches(view: View, t: ThreadSummary, tr: Triage | undefined, me: string) {
  const done = !!tr?.done;
  switch (view.kind) {
    case 'all':
      return !done;
    case 'unassigned':
      return !done && !tr?.assignee;
    case 'mine':
      return !done && tr?.assignee === me;
    case 'flagged':
      return !done && !!tr?.flagged;
    case 'done':
      return done;
    case 'member':
      return !done && tr?.assignee === view.email;
    case 'category':
      return !done && categoryOf(t, tr) === view.name;
  }
}

const ALL_VIEWS: View[] = [
  { kind: 'all' },
  { kind: 'unassigned' },
  { kind: 'mine' },
  { kind: 'flagged' },
  { kind: 'done' },
  ...CATEGORIES.map((c) => ({ kind: 'category' as const, name: c.name })),
  ...TEAM.map((m) => ({ kind: 'member' as const, email: m.email })),
];

function Inbox({ user }: { user: User }) {
  const me = user.email!.toLowerCase();
  const triage = useTriage();
  const [mailbox, setMailbox] = useState<Mailbox>('team');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(!getGmailToken());
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'sig' | 'templates' | 'compose' | 'keys' | null>(null);
  const [now, setNow] = useState(Date.now());
  const [menuOpen, setMenuOpen] = useState(false);

  const [days, setDays] = useState(() => Number(localStorage.getItem('days')) || 90);
  const query = useMemo(() => {
    const base = mailboxQuery(mailbox, days);
    // "all:" searches your whole Gmail, ignoring the mailbox filter.
    if (search.startsWith('all:')) return search.slice(4).trim() || base;
    return search ? `${base} ${search}` : base;
  }, [mailbox, search, days]);

  // Desktop alerts for new mail and for things assigned to you by a teammate.
  const [alertsOn, setAlertsOn] = useState(() => 'Notification' in window && Notification.permission === 'granted');
  const notify = useCallback(
    (title: string, body: string, threadId?: string) => {
      if (!alertsOn || document.hasFocus()) return;
      const n = new Notification(title, { body, tag: threadId });
      n.onclick = () => {
        window.focus();
        if (threadId) setSelected(threadId);
        n.close();
      };
    },
    [alertsOn],
  );
  const seen = useRef<Set<string> | null>(null);
  const prevTriage = useRef(triage);
  useEffect(() => {
    for (const [key, tr] of Object.entries(triage)) {
      const before = prevTriage.current[key];
      if (prevTriage.current !== triage && Object.keys(prevTriage.current).length && tr.assignee === me && before?.assignee !== me && tr.updatedBy && tr.updatedBy !== me) {
        const t = threads.find((x) => x.key === key);
        notify(`${teammateName(tr.updatedBy)} assigned you an email`, tr.subject ?? '', t?.threadId);
      }
    }
    prevTriage.current = triage;
  }, [triage, threads, me, notify]);

  // Keep the newest page fresh without throwing away "Load older" pages.
  const busy = useRef(false);
  const refresh = useCallback(
    async (reset = false) => {
      if (busy.current || !getGmailToken()) return;
      busy.current = true;
      setLoading(true);
      setError('');
      try {
        const r = await listThreads(query, 75);
        if (mailbox !== 'sent' && !search) {
          if (seen.current) {
            const fresh = r.threads.filter((t) => !seen.current!.has(t.threadId) && !t.sent);
            if (fresh.length === 1) notify(`New: ${fresh[0].subject}`, displayName(fresh[0].from), fresh[0].threadId);
            else if (fresh.length > 1) notify(`${fresh.length} new emails`, fresh.map((t) => t.subject).join('\n'));
          }
          seen.current = new Set([...(seen.current ?? []), ...r.threads.map((t) => t.threadId)]);
        }
        setThreads((cur) => {
          const oldest = r.threads.at(-1)?.date ?? 0;
          if (reset || !oldest) return r.threads;
          const fresh = new Set(r.threads.map((t) => t.threadId));
          return [...r.threads, ...cur.filter((t) => !fresh.has(t.threadId) && t.date < oldest)].sort((a, b) => b.date - a.date);
        });
        if (reset) setNext(r.next);
        setLastSync(Date.now());
      } catch (e) {
        if (!(e instanceof AuthExpiredError)) setError(String(e));
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [query, mailbox, search, notify],
  );

  // New mailbox or search: start over.
  useEffect(() => {
    setThreads([]);
    setChecked(new Set());
    seen.current = null;
    refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Smart assignment: claim new emails sent To a teammate's own address.
  useEffect(() => {
    for (const t of threads) {
      const tr = triage[t.key];
      if (tr?.assignee || tr?.autoAssigned || tr?.done) continue;
      const who = autoAssignee(t.firstTo);
      if (who) updateTriage(t.key, t.subject, { assignee: who, autoAssigned: true });
    }
  }, [threads, triage]);

  // A new reply on a Done email reopens it, so it can't hide from the team.
  useEffect(() => {
    for (const t of threads) {
      const tr = triage[t.key];
      if (tr?.done && !t.sent && tr.updatedAt && t.date > tr.updatedAt.toMillis()) {
        updateTriage(t.key, t.subject, { done: false });
      }
    }
  }, [threads, triage]);

  // Unread count in the browser tab title.
  useEffect(() => {
    const n = threads.filter((t) => t.unread && !triage[t.key]?.done).length;
    document.title = n ? `(${n}) AdOps Inbox` : 'AdOps Inbox';
  }, [threads, triage]);

  // Auto-sync every minute while the tab is visible, and right away when you come back to it.
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && refresh();
    const id = setInterval(tick, SYNC_EVERY_MS);
    const onFocus = () => tick();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  // Gmail session: show Reconnect when it lapses, resume syncing when renewed.
  useEffect(() => {
    const off = () => setExpired(true);
    const on = () => {
      setExpired(false);
      refresh();
    };
    window.addEventListener(AUTH_EXPIRED, off);
    window.addEventListener(AUTH_RENEWED, on);
    const clock = setInterval(() => {
      setNow(Date.now());
      if (!getGmailToken()) setExpired(true);
    }, 30_000);
    return () => {
      window.removeEventListener(AUTH_EXPIRED, off);
      window.removeEventListener(AUTH_RENEWED, on);
      clearInterval(clock);
    };
  }, [refresh]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const r = await listThreads(query, 75, next);
      setThreads((cur) => [...cur, ...r.threads.filter((t) => !cur.some((c) => c.threadId === t.threadId))]);
      setNext(r.next);
    } catch (e) {
      if (!(e instanceof AuthExpiredError)) setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const reconnect = () => signIn().catch((e) => setError(String(e?.message ?? e)));

  const visible = useMemo(
    // When searching, show Done emails too so a search always finds them.
    () => threads.filter((t) => (search && view.kind === 'all') || matches(view, t, triage[t.key], me)),
    [threads, triage, view, me, search],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of ALL_VIEWS) c[viewId(v)] = threads.filter((t) => matches(v, t, triage[t.key], me)).length;
    return c;
  }, [threads, triage, me]);

  const bulk = (patch: Partial<Triage>) => {
    for (const t of threads.filter((x) => checked.has(x.threadId))) {
      updateTriage(t.key, t.subject, patch);
      if (patch.done) setArchived(t.threadId, true).catch((e) => setError(String(e)));
    }
    setChecked(new Set());
  };

  const current = threads.find((t) => t.threadId === selected);
  const [composing, setComposing] = useState(false);
  useReportPresence(current?.key ?? null, composing);
  const presence = usePresence();

  // Draggable divider between the email list and the reading pane.
  const [listW, setListW] = useState(() => Number(localStorage.getItem('listW')) || 560);
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listW;
    let w = startW;
    const move = (ev: MouseEvent) => {
      w = Math.min(Math.max(startW + ev.clientX - startX, 260), window.innerWidth - 230 - 360);
      setListW(w);
    };
    const up = () => {
      localStorage.setItem('listW', String(w));
      document.body.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    document.body.classList.add('dragging');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || el.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
      const idx = visible.findIndex((t) => t.threadId === selected);
      const move = (d: number) => {
        const t = visible[Math.min(Math.max(idx + d, 0), visible.length - 1)];
        if (t) setSelected(t.threadId);
      };
      const act = (action: string) => window.dispatchEvent(new CustomEvent('thread-action', { detail: action }));
      const map: Record<string, () => void> = {
        j: () => move(1),
        ArrowDown: () => move(1),
        k: () => move(-1),
        ArrowUp: () => move(-1),
        r: () => act('reply'),
        a: () => act('replyAll'),
        f: () => act('forward'),
        e: () => act('done'),
        '!': () => act('flag'),
        m: () => act('assignMe'),
        n: () => act('note'),
        c: () => setDialog('compose'),
        s: mbSearch,
        '/': () => document.querySelector<HTMLInputElement>('.topbar input')?.focus(),
        '?': () => setDialog('keys'),
        Escape: () => setDialog(null),
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selected]);
  const minutesLeft = Math.round((tokenExpiresAt() - now) / 60_000);
  const mailboxLabel = MAILBOXES.find((m) => m.id === mailbox)!.label;

  const searchBox = (
        <div className="searchbox">
          <select
            value={days}
            title="How far back to load"
            onChange={(e) => {
              setDays(Number(e.target.value));
              localStorage.setItem('days', e.target.value);
            }}
          >
            {DATE_RANGES.map((d) => (
              <option key={d} value={d}>
                {d}d
              </option>
            ))}
          </select>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              refresh(true);
            }}
          >
            <input placeholder="Search mail (Gmail syntax)" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
        </div>
  );

  return (
    <div className="app">
      {/* Troubleshooting: open the app with ?debug in the address to list every email loaded. */}
      {location.search.includes('debug') && (
        <pre style={{ position: 'fixed', bottom: 0, right: 0, zIndex: 99, maxHeight: '50vh', overflow: 'auto', background: '#fff', border: '1px solid #ccc', padding: 8, fontSize: 11 }}>
          {`query: ${query}\nloaded: ${threads.length}\n` +
            threads
              .map((t) => `${new Date(t.date).toLocaleString()} | ${triage[t.key]?.done ? 'DONE' : 'open'} | ${t.sent ? 'sent' : 'in'} | ${t.subject.slice(0, 50)}`)
              .join('\n')}
        </pre>
      )}
      <header className="topbar">
        <div className="logo">AO</div>
        <div>
          <strong>AdOps Shared Inbox</strong>
          <div className="muted small">{TEAM.map((t) => t.name).join(' · ')}</div>
        </div>
        <span className="spacer" />
        <button
          className="mb-search"
          title="Highlight text anywhere (even inside an email), then click to search MaxBounty admin"
          onMouseDown={(e) => e.preventDefault()}
          onClick={mbSearch}
        >
          🔍 MB
        </button>
        <span className={`sync ${expired ? 'off' : ''}`}>
          ● {expired ? 'Paused' : lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Syncing…'}
        </span>
        <button onClick={() => refresh()} disabled={loading} title="Refresh now">
          ⟳
        </button>
        <div className="menu-wrap">
          <button className={menuOpen ? 'on' : ''} onClick={() => setMenuOpen(!menuOpen)}>
            ⚙ Settings
          </button>
          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu" onClick={() => setMenuOpen(false)}>
                <div className="menu-who muted small">{me}</div>
                <button onClick={() => setDialog('templates')}>📝 Templates</button>
                <button onClick={() => setDialog('sig')}>✍ Signature</button>
                {'Notification' in window && (
                  <button
                    onClick={() =>
                      alertsOn
                        ? setAlertsOn(false)
                        : Notification.requestPermission().then((p) => setAlertsOn(p === 'granted'))
                    }
                  >
                    {alertsOn ? '🔔 Desktop alerts: on' : '🔕 Desktop alerts: off'}
                  </button>
                )}
                <button onClick={() => setDialog('keys')}>⌨ Keyboard shortcuts</button>
                <hr />
                <button onClick={signOut}>↩ Sign out</button>
              </div>
            </>
          )}
        </div>
      </header>
      {expired ? (
        <div className="banner warn">
          Gmail sync paused because your Google session expired (Google limits these to an hour).{' '}
          <button className="primary" onClick={reconnect}>
            Reconnect
          </button>
        </div>
      ) : (
        minutesLeft <= 5 && (
          <div className="banner warn">
            Your Google session ends in {Math.max(minutesLeft, 0)} min.{' '}
            <button onClick={reconnect}>Stay synced</button>
          </div>
        )
      )}
      {error && <div className="error banner">{error}</div>}
      <div className="panes" style={{ gridTemplateColumns: `230px ${listW}px 6px 1fr` }}>
        <Sidebar
          mailbox={mailbox}
          onMailbox={(m) => {
            setMailbox(m);
            setSelected(null);
          }}
          view={view}
          onView={setView}
          counts={counts}
          onCompose={() => setDialog('compose')}
        />
        <ThreadList
            top={searchBox}
          threads={visible}
          triage={triage}
          selected={selected}
          onSelect={setSelected}
          checked={checked}
          onChecked={setChecked}
          onBulk={bulk}
          onLoadMore={next ? loadMore : undefined}
          loading={loading}
          caption={`Showing ${mailboxLabel}`}
          presence={presence}
        />
        <div
          className="splitter"
          title="Drag to resize · double-click to reset"
          onMouseDown={startDrag}
          onDoubleClick={() => {
            setListW(400);
            localStorage.setItem('listW', '560');
          }}
        />
        {current ? (
          <ThreadView
            key={current.threadId}
            summary={current}
            triage={triage[current.key]}
            me={me}
            others={presence.filter((p) => p.threadKey === current.key)}
            onComposing={setComposing}
          />
        ) : (
          <div className="center muted">Select an email</div>
        )}
      </div>
      {dialog === 'sig' && <SignatureDialog email={me} onClose={() => setDialog(null)} />}
      {dialog === 'templates' && <TemplatesDialog onClose={() => setDialog(null)} />}
      {dialog === 'keys' && (
        <div className="modal-backdrop" onClick={() => setDialog(null)}>
          <div className="modal keys">
            <h3>Keyboard shortcuts</h3>
            {SHORTCUTS.map(([k, label]) => (
              <div key={k}>
                <kbd>{k}</kbd> {label}
              </div>
            ))}
          </div>
        </div>
      )}
      {dialog === 'compose' && (
        <div className="modal-backdrop">
          <div className="modal wide">
            <Composer
              mode="new"
              me={me}
              onClose={() => setDialog(null)}
              onSent={() => {
                setDialog(null);
                refresh();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
