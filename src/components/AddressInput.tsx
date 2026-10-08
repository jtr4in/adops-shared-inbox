import { useMemo, useState } from 'react';
import { knownContacts } from '../gmail';

// To/Cc box with Gmail-style suggestions for the address you're typing (after the last comma).
export function AddressInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const contacts = useMemo(knownContacts, []);
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const parts = value.split(',');
  const term = parts[parts.length - 1].trim().toLowerCase();
  const already = new Set(parts.slice(0, -1).map((p) => (p.match(/<([^>]+)>/)?.[1] ?? p).trim().toLowerCase()));
  const matches =
    term.length < 1
      ? []
      : contacts
          .filter((c) => !already.has(c.email) && (c.email.includes(term) || c.name.toLowerCase().includes(term)))
          .slice(0, 8);
  const pick = (email: string) => {
    onChange([...parts.slice(0, -1).map((p) => p.trim()), email].filter(Boolean).join(', ') + ', ');
    setHi(0);
  };
  return (
    <div className="addr">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setHi(0);
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (!focus || !matches.length) return;
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, matches.length - 1));
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0));
          else if (e.key === 'Enter' || e.key === 'Tab') pick(matches[hi].email);
          else return;
          e.preventDefault();
        }}
      />
      {focus && matches.length > 0 && (
        <ul className="addr-menu">
          {matches.map((c, i) => (
            <li key={c.email} className={i === hi ? 'on' : ''} onMouseDown={(e) => (e.preventDefault(), pick(c.email))}>
              {c.name && <strong>{c.name} </strong>}
              <span className="muted">{c.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
