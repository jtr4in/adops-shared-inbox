import { CATEGORIES, MAILBOXES, TEAM, type Mailbox } from '../config';

export type View =
  | { kind: 'all' | 'unassigned' | 'mine' | 'flagged' | 'done' }
  | { kind: 'member'; email: string }
  | { kind: 'category'; name: string };

export const viewId = (v: View) =>
  v.kind === 'member' ? `member:${v.email}` : v.kind === 'category' ? `cat:${v.name}` : v.kind;

const VIEWS: { view: View; label: string; icon: string }[] = [
  { view: { kind: 'all' }, label: 'All open', icon: '✉' },
  { view: { kind: 'unassigned' }, label: 'Unassigned', icon: '◌' },
  { view: { kind: 'mine' }, label: 'Assigned to me', icon: '☺' },
  { view: { kind: 'flagged' }, label: 'Flagged for help', icon: '⚑' },
  { view: { kind: 'done' }, label: 'Done', icon: '✓' },
];

interface Props {
  mailbox: Mailbox;
  onMailbox: (m: Mailbox) => void;
  view: View;
  onView: (v: View) => void;
  counts: Record<string, number>;
  mailboxCounts?: Partial<Record<Mailbox, number>>;
  onCompose: () => void;
}

export function Sidebar({ mailbox, onMailbox, view, onView, counts, mailboxCounts = {}, onCompose }: Props) {
  const item = (v: View, label: string, icon: string) => (
    <button
      key={viewId(v)}
      className={`nav ${viewId(v) === viewId(view) ? 'active' : ''}`}
      onClick={() => onView(v)}
    >
      <span className="icon">{icon}</span>
      <span className="label">{label}</span>
      <span className="count">{counts[viewId(v)] || ''}</span>
    </button>
  );
  return (
    <nav className="sidebar">
      <button className="primary wide" onClick={onCompose}>
        + New email
      </button>
      <div className="section">Mailbox</div>
      {MAILBOXES.map((m) => (
        <button
          key={m.id}
          className={`nav ${mailbox === m.id ? 'active-soft' : ''}`}
          onClick={() => onMailbox(m.id)}
        >
          <span className="icon">{m.id === 'sent' ? '➤' : m.id === 'me' ? '☺' : '☰'}</span>
          <span className="label">
            {m.label}
            {mailboxCounts[m.id] !== undefined && ` (${mailboxCounts[m.id]})`}
          </span>
        </button>
      ))}
      <div className="section">Inbox views</div>
      {VIEWS.map((v) => item(v.view, v.label, v.icon))}
      <div className="section">Smart folders</div>
      {CATEGORIES.map((c) => item({ kind: 'category', name: c.name }, c.name, '▭'))}
      <div className="section">Team members</div>
      {TEAM.map((m) => item({ kind: 'member', email: m.email }, m.name, m.name[0]))}
    </nav>
  );
}
