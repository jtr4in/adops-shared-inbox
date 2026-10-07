import { teammateName } from '../config';
import { displayName, type ThreadSummary } from '../gmail';
import type { Triage } from '../triage';

interface Props {
  threads: ThreadSummary[];
  triage: Record<string, Triage>;
  selected: string | null;
  onSelect: (threadId: string) => void;
}

export function formatDate(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ThreadList({ threads, triage, selected, onSelect }: Props) {
  if (!threads.length) return <div className="list center muted">Nothing here</div>;
  return (
    <ul className="list">
      {threads.map((t) => {
        const tr = triage[t.key];
        return (
          <li
            key={t.threadId}
            className={`row ${t.threadId === selected ? 'selected' : ''} ${t.unread ? 'unread' : ''}`}
            onClick={() => onSelect(t.threadId)}
          >
            <div className="row-top">
              <span className="from">{displayName(t.from)}</span>
              {t.count > 1 && <span className="chip">{t.count}</span>}
              <span className="date">{formatDate(t.date)}</span>
            </div>
            <div className="subject">
              {tr?.flagged && <span className="flag">⚑ </span>}
              {t.subject}
            </div>
            <div className="snippet">{t.snippet}</div>
            <div className="tags">
              {tr?.assignee ? (
                <span className="chip assigned">{teammateName(tr.assignee)}</span>
              ) : (
                <span className="chip">Unassigned</span>
              )}
              {tr?.done && <span className="chip done">Done</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
