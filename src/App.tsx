import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { AUTH_EXPIRED, AUTH_RENEWED, auth, getGmailToken, signIn, signOut, tokenExpiresAt } from './firebase';
import { CATEGORIES, GROUP_ADDRESS, MAILBOXES, TEAM, type Mailbox } from './config';
import { AuthExpiredError, listThreads, type ThreadSummary } from './gmail';
import { categoryOf, updateTriage, useTriage, type Triage } from './triage';
import { Sidebar, viewId, type View } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ThreadView } from './components/ThreadView';
import { SignatureDialog } from './components/SignatureDialog';
import { TemplatesDialog } from './components/TemplatesDialog';
import { Composer } from './components/Composer';

const SYNC_EVERY_MS = 60_000;

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
  const [dialog, setDialog] = useState<'sig' | 'templates' | 'compose' | null>(null);
  const [now, setNow] = useState(Date.now());

  const query = useMemo(() => {
    const base = MAILBOXES.find((m) => m.id === mailbox)!.query;
    return search ? `${base} ${search}` : base;
  }, [mailbox, search]);

  // Keep the newest page fresh without throwing away "Load older" pages.
  const busy = useRef(false);
  const refresh = useCallback(
    async (reset = false) => {
      if (busy.current || !getGmailToken()) return;
      busy.current = true;
      setLoading(true);
      setError('');
      try {
        const r = await listThreads(query, 30);
        setThreads((cur) => {
          const oldest = r.threads.at(-1)?.date ?? 0;
          if (reset || !oldest) return r.threads;
          const fresh = new Set(r.threads.map((t) => t.threadId));
          return [...r.threads, ...cur.filter((t) => !fresh.has(t.threadId) && t.date < oldest)];
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
    [query],
  );

  // New mailbox or search: start over.
  useEffect(() => {
    setThreads([]);
    setChecked(new Set());
    refresh(true);
  }, [refresh]);

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
      const r = await listThreads(query, 30, next);
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
    () => threads.filter((t) => matches(view, t, triage[t.key], me)),
    [threads, triage, view, me],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of ALL_VIEWS) c[viewId(v)] = threads.filter((t) => matches(v, t, triage[t.key], me)).length;
    return c;
  }, [threads, triage, me]);

  const bulk = (patch: Partial<Triage>) => {
    for (const t of threads.filter((x) => checked.has(x.threadId))) updateTriage(t.key, t.subject, patch);
    setChecked(new Set());
  };

  const current = threads.find((t) => t.threadId === selected);
  const minutesLeft = Math.round((tokenExpiresAt() - now) / 60_000);
  const mailboxLabel = MAILBOXES.find((m) => m.id === mailbox)!.label;

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">AO</div>
        <div>
          <strong>AdOps Shared Inbox</strong>
          <div className="muted small">{TEAM.map((t) => t.name).join(' · ')}</div>
        </div>
        <span className="spacer" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            refresh(true);
          }}
        >
          <input placeholder="Search mail (Gmail syntax)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <span className={`sync ${expired ? 'off' : ''}`}>
          ● {expired ? 'Paused' : lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Syncing…'}
        </span>
        <button onClick={() => refresh()} disabled={loading} title="Refresh now">
          ⟳
        </button>
        <button onClick={() => setDialog('templates')}>Templates</button>
        <button onClick={() => setDialog('sig')}>Signature</button>
        <button onClick={signOut} title={me}>
          Sign out
        </button>
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
      <div className="panes">
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
        />
        {current ? (
          <ThreadView key={current.threadId} summary={current} triage={triage[current.key]} me={me} />
        ) : (
          <div className="center muted">Select an email</div>
        )}
      </div>
      {dialog === 'sig' && <SignatureDialog email={me} onClose={() => setDialog(null)} />}
      {dialog === 'templates' && <TemplatesDialog onClose={() => setDialog(null)} />}
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
