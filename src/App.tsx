import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, getGmailToken, signIn, signOut } from './firebase';
import { GROUP_ADDRESS, GROUP_QUERY, TEAM } from './config';
import { listThreads, type ThreadSummary } from './gmail';
import { useTriage, type Triage } from './triage';
import { Sidebar, type View } from './components/Sidebar';
import { ThreadList } from './components/ThreadList';
import { ThreadView } from './components/ThreadView';
import { SignatureDialog } from './components/SignatureDialog';

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [hasToken, setHasToken] = useState(!!getGmailToken());
  const [signInError, setSignInError] = useState('');
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (user === undefined) return <div className="center">Loading…</div>;
  const allowed = user?.email && (TEAM.length === 0 || TEAM.some((t) => t.email === user.email!.toLowerCase()));
  if (!user || !hasToken || !allowed) {
    return (
      <div className="center login">
        <h1>AdOps Shared Inbox</h1>
        <p>Shared triage for {GROUP_ADDRESS}</p>
        {user && !allowed && <p className="error">{user.email} is not on the team list.</p>}
        <button className="primary" onClick={() =>
            signIn()
              .then(() => setHasToken(true))
              .catch((e) => setSignInError(`${e?.code ?? ''} ${e?.message ?? e}`))
          }>
          Sign in with Google
        </button>
        {signInError && <p className="error">{signInError}</p>}
        {user && <button onClick={signOut}>Use a different account</button>}
      </div>
    );
  }
  return <Inbox user={user} />;
}

function matches(view: View, t: Triage | undefined, me: string) {
  const done = !!t?.done;
  switch (view.kind) {
    case 'all':
      return !done;
    case 'unassigned':
      return !done && !t?.assignee;
    case 'mine':
      return !done && t?.assignee === me;
    case 'flagged':
      return !done && !!t?.flagged;
    case 'done':
      return done;
    case 'member':
      return !done && t?.assignee === view.email;
  }
}

function Inbox({ user }: { user: User }) {
  const me = user.email!.toLowerCase();
  const triage = useTriage();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [showSig, setShowSig] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await listThreads(search ? `${GROUP_QUERY} ${search}` : GROUP_QUERY, 30);
      setThreads(r.threads);
      setNext(r.next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2 * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    setLoading(true);
    try {
      const r = await listThreads(search ? `${GROUP_QUERY} ${search}` : GROUP_QUERY, 30, next);
      setThreads((cur) => [...cur, ...r.threads.filter((t) => !cur.some((c) => c.threadId === t.threadId))]);
      setNext(r.next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const visible = useMemo(
    () => threads.filter((t) => matches(view, triage[t.key], me)),
    [threads, triage, view, me],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    const views: View[] = [
      { kind: 'all' },
      { kind: 'unassigned' },
      { kind: 'mine' },
      { kind: 'flagged' },
      { kind: 'done' },
      ...TEAM.map((m) => ({ kind: 'member' as const, email: m.email })),
    ];
    for (const v of views) {
      c[viewId(v)] = threads.filter((t) => matches(v, triage[t.key], me)).length;
    }
    return c;
  }, [threads, triage, me]);

  const current = threads.find((t) => t.threadId === selected);

  return (
    <div className="app">
      <header className="topbar">
        <strong>AdOps Shared Inbox</strong>
        <span className="muted">{GROUP_ADDRESS}</span>
        <span className="spacer" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            refresh();
          }}
        >
          <input placeholder="Search (Gmail syntax)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <button onClick={refresh} disabled={loading}>
          {loading ? 'Syncing…' : 'Refresh'}
        </button>
        <button onClick={() => setShowSig(true)}>Signature</button>
        <span className="muted">{me}</span>
        <button onClick={signOut}>Sign out</button>
      </header>
      {error && <div className="error banner">{error}</div>}
      <div className="panes">
        <Sidebar view={view} onView={setView} counts={counts} viewId={viewId} />
        <ThreadList
          threads={visible}
          triage={triage}
          selected={selected}
          onSelect={setSelected}
          onLoadMore={next ? loadMore : undefined}
          loading={loading}
        />
        {current ? (
          <ThreadView key={current.threadId} summary={current} triage={triage[current.key]} me={me} />
        ) : (
          <div className="center muted">Select an email</div>
        )}
      </div>
      {showSig && <SignatureDialog email={me} onClose={() => setShowSig(false)} />}
    </div>
  );
}

export const viewId = (v: View) => (v.kind === 'member' ? `member:${v.email}` : v.kind);
