import { TEAM } from '../config';

export type View =
  | { kind: 'all' | 'unassigned' | 'mine' | 'flagged' | 'done' }
  | { kind: 'member'; email: string };

const VIEWS: { view: View; label: string }[] = [
  { view: { kind: 'all' }, label: 'All open' },
  { view: { kind: 'unassigned' }, label: 'Unassigned' },
  { view: { kind: 'mine' }, label: 'Assigned to me' },
  { view: { kind: 'flagged' }, label: 'Flagged' },
  { view: { kind: 'done' }, label: 'Done' },
];

interface Props {
  view: View;
  onView: (v: View) => void;
  counts: Record<string, number>;
  viewId: (v: View) => string;
}

export function Sidebar({ view, onView, counts, viewId }: Props) {
  const item = (v: View, label: string) => (
    <button
      key={viewId(v)}
      className={`nav ${viewId(v) === viewId(view) ? 'active' : ''}`}
      onClick={() => onView(v)}
    >
      <span>{label}</span>
      <span className="count">{counts[viewId(v)] ?? 0}</span>
    </button>
  );
  return (
    <nav className="sidebar">
      <div className="section">Inbox</div>
      {VIEWS.map((v) => item(v.view, v.label))}
      <div className="section">Team</div>
      {TEAM.map((m) => item({ kind: 'member', email: m.email }, m.name))}
    </nav>
  );
}
