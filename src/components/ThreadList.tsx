import { useRef } from 'react';
import { GROUP_ADDRESS, TEAM, teammateName } from '../config';
import { addresses, displayName, type ThreadSummary } from '../gmail';
import { categoryOf, type Presence, type Triage } from '../triage';

interface Props {
  threads: ThreadSummary[];
  triage: Record<string, Triage>;
  selected: string | null;
  onSelect: (threadId: string) => void;
  checked: Set<string>;
  onChecked: (ids: Set<string>) => void;
  onBulk: (patch: Partial<Triage>) => void;
  onLoadMore?: () => void;
  loading?: boolean;
  caption: string;
  presence: Presence[];
}

export function formatDate(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const short = (s: string) => s.replace(/ & .*/, '');

function groupChip(t: ThreadSummary) {
  if (addresses(t.to).includes(GROUP_ADDRESS)) return 'To: ' + GROUP_ADDRESS.split('@')[0] + '@';
  if (addresses(t.cc).includes(GROUP_ADDRESS)) return 'Cc: ' + GROUP_ADDRESS.split('@')[0] + '@';
  return null;
}

export function ThreadList(p: Props) {
  const { threads, triage, selected, onSelect, checked, onChecked, onBulk } = p;
  const allChecked = threads.length > 0 && threads.every((t) => checked.has(t.threadId));
  const lastClicked = useRef<number | null>(null);
  // Click toggles one; shift+click selects the whole range since the last click.
  const toggle = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const n = new Set(checked);
    const id = threads[idx].threadId;
    const on = !n.has(id);
    if (e.shiftKey && lastClicked.current !== null) {
      const [a, b] = [lastClicked.current, idx].sort((x, y) => x - y);
      for (const t of threads.slice(a, b + 1)) {
        if (on) n.add(t.threadId);
        else n.delete(t.threadId);
      }
    } else if (on) n.add(id);
    else n.delete(id);
    lastClicked.current = idx;
    onChecked(n);
  };

  return (
    <div className="list">
      <div className="list-head">
        <label>
          <input
            type="checkbox"
            checked={allChecked}
            onChange={() => onChecked(allChecked ? new Set() : new Set(threads.map((t) => t.threadId)))}
          />{' '}
          {checked.size ? `${checked.size} selected` : `Select all (${threads.length})`}
        </label>
        {checked.size > 0 ? (
          <div className="bulk">
            <select value="" onChange={(e) => onBulk({ assignee: e.target.value === '-' ? null : e.target.value })}>
              <option value="">Assign…</option>
              <option value="-">Unassigned</option>
              {TEAM.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name}
                </option>
              ))}
            </select>
            <button onClick={() => onBulk({ flagged: true })}>⚑</button>
            <button onClick={() => onBulk({ done: true })}>✓ Done</button>
          </div>
        ) : (
          <span className="muted small">{p.caption}</span>
        )}
      </div>
      {!threads.length && !p.loading && <div className="center muted">Nothing here</div>}
      <ul>
        {threads.map((t, i) => {
          const tr = triage[t.key];
          const chip = groupChip(t);
          return (
            <li
              key={t.threadId}
              className={`row ${t.threadId === selected ? 'selected' : ''} ${t.unread ? 'unread' : ''} ${tr?.assignee ? 'owned' : ''}`}
              onClick={(e) => {
                // Shift+click selects a range, Ctrl/Cmd+click adds or removes one; a plain click opens it.
                if (e.shiftKey || e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  if (e.shiftKey && lastClicked.current === null && selected) {
                    lastClicked.current = threads.findIndex((x) => x.threadId === selected);
                  }
                  toggle(i, e);
                } else {
                  lastClicked.current = i;
                  onSelect(t.threadId);
                }
              }}
            >
              <input
                type="checkbox"
                checked={checked.has(t.threadId)}
                onClick={(e) => toggle(i, e)}
                readOnly
              />
              <div className="row-main">
                <div className="row-top">
                  <span className="from">{t.sent ? `To: ${displayName(t.to)}` : displayName(t.from)}</span>
                  {p.presence
                    .filter((x) => x.threadKey === t.key)
                    .map((x) => (
                      <span key={x.email} className={`chip live ${x.composing ? 'hot' : ''}`}>
                        {x.composing ? '✍' : '👀'} {teammateName(x.email).split(' ')[0]}
                      </span>
                    ))}
                  {t.people > 2 && <span className="chip people">👥 {t.people} in chain</span>}
                  <span className="date">{formatDate(t.date)}</span>
                </div>
                <div className="subject">
                  {tr?.flagged && <span className="flag">⚑ </span>}
                  {t.subject}
                  {t.count > 1 && <span className="muted small"> ({t.count})</span>}
                </div>
                <div className="snippet">{t.snippet}</div>
                <div className="tags">
                  {t.sent && <span className="chip sent">Sent</span>}
                  {chip && <span className="chip">{chip}</span>}
                  {tr?.assignee ? (
                    <span className="chip assigned">{teammateName(tr.assignee)}</span>
                  ) : (
                    <span className="chip">Unassigned</span>
                  )}
                  {tr?.done && <span className="chip done">Done</span>}
                  <span className="cat">{short(categoryOf(t, tr))}</span>
                </div>
              </div>
            </li>
          );
        })}
        {p.onLoadMore && (
          <li className="more">
            <button onClick={p.onLoadMore} disabled={p.loading}>
              {p.loading ? 'Loading…' : 'Load older emails'}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
