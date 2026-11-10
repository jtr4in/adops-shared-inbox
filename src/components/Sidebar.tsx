import { CATEGORIES, MY_FOLDERS, TEAM } from '../config';

export type View =
  | { kind: 'sent' | 'all' | 'unassigned' | 'mine' | 'flagged' | 'done' }
  | { kind: 'member'; email: string }
  | { kind: 'category'; name: string }
  | { kind: 'myfolder'; name: string };

export const viewId = (v: View) =>
  v.kind === 'member' ? `member:${v.email}` : v.kind === 'category' ? `cat:${v.name}` : v.kind === 'myfolder' ? `my:${v.name}` : v.kind;

const VIEWS: { view: View; label: string; icon: string }[] = [
  { view: { kind: 'all' }, label: 'Inbox', icon: '✉' },
  { view: { kind: 'mine' }, label: 'Assigned to me', icon: '☺' },
  { view: { kind: 'unassigned' }, label: 'Unassigned', icon: '◌' },
  { view: { kind: 'flagged' }, label: 'Flagged', icon: '⚑' },
  { view: { kind: 'done' }, label: 'Done', icon: '✓' },
  { view: { kind: 'sent' }, label: 'Sent', icon: '➤' },
];

interface Props {
  view: View;
  onView: (v: View) => void;
  counts: Record<string, number>;
  onCompose: () => void;
  onFolderSettings: () => void;
}

export function Sidebar({ view, onView, counts, onCompose, onFolderSettings }: Props) {
  const item = (v: View, label: string, icon: string) => (
    <button
      key={viewId(v)}
      className={`nav ${viewId(v) === viewId(view) ? 'active' : ''}`}
      onClick={() => onView(v)}
    >
      <span className="icon">{icon}</span>
      <span className="label">{label}</span>
      <span className="count">{(v.kind !== 'sent' && counts[viewId(v)]) || ''}</span>
    </button>
  );
  return (
    <nav className="sidebar">
      <button className="primary wide" onClick={onCompose}>
        + New email
      </button>
      {VIEWS.map((v) => item(v.view, v.label, v.icon))}
      <div className="section with-btn">
        Smart folders
        <button className="section-btn" title="Smart folder settings" onClick={onFolderSettings}>⚙</button>
      </div>
      {CATEGORIES.map((c) => item({ kind: 'category', name: c.name }, c.name, '▭'))}
      {MY_FOLDERS.length > 0 && <div className="section">My folders</div>}
      {MY_FOLDERS.map((f) => item({ kind: 'myfolder', name: f.name }, f.name, '★'))}
      <div className="section">Team members</div>
      {TEAM.map((m) => item({ kind: 'member', email: m.email }, m.name, m.name[0]))}
    </nav>
  );
}
