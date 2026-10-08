import { useEffect, useState } from 'react';
import { getGmailToken } from '../firebase';

type Person = { email: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean };
type Ev = {
  id: string; summary?: string; htmlLink: string; hangoutLink?: string; location?: string;
  start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string };
  attendees?: Person[];
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string; label?: string; pin?: string }[] };
};

const RSVP: Record<string, string> = { accepted: '✓', declined: '✕', tentative: '?', needsAction: '…' };
const when = (s: Ev['start']) => (s.dateTime ? new Date(s.dateTime) : new Date(s.date + 'T00:00'));
const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function Agenda() {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + 14 * 864e5);
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
      const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
        headers: { Authorization: `Bearer ${getGmailToken()}` },
      });
      if (res.status === 401 || res.status === 403)
        return setErr('Calendar needs one more Google permission. Sign out and back in, then reopen this panel.');
      if (!res.ok) return setErr(`Couldn't load calendar (${res.status})`);
      const data = await res.json();
      setEvents((data.items as Ev[]).filter((e) => !e.attendees?.some((a) => a.self && a.responseStatus === 'declined')));
    };
    load().catch((e) => setErr(String(e)));
    const t = setInterval(() => load().catch(() => {}), 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  if (err) return <p className="error cal-msg">{err}</p>;
  if (!events) return <p className="muted cal-msg">Loading…</p>;
  if (!events.length) return <p className="muted cal-msg">Nothing in the next two weeks.</p>;

  let lastDay = '';
  return (
    <div className="agenda">
      {events.map((e) => {
        const s = when(e.start);
        const day = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        const showDay = day !== lastDay; lastDay = day;
        const now = Date.now(), live = s.getTime() - 10 * 60_000 < now && when(e.end).getTime() > now;
        const meet = e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
        const phone = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'phone');
        const people = e.attendees ?? [];
        const yes = people.filter((p) => p.responseStatus === 'accepted').length;
        return (
          <div key={e.id}>
            {showDay && <div className="ag-day">{day}</div>}
            <div className={`ag-ev${live ? ' live' : ''}`}>
              <div className="ag-row" onClick={() => setOpen(open === e.id ? null : e.id)}>
                <span className="ag-time">{e.start.dateTime ? `${time(s)}–${time(when(e.end))}` : 'All day'}</span>
                <span className="ag-title">{e.summary ?? '(no title)'}</span>
              </div>
              {meet && <a className="ag-join" href={meet} target="_blank" rel="noreferrer">Join with Google Meet</a>}
              {open === e.id && (
                <div className="ag-detail">
                  {phone && <div>📞 <a href={phone.uri}>{phone.label ?? phone.uri.replace('tel:', '')}</a>{phone.pin && ` PIN: ${phone.pin}#`}</div>}
                  {e.location && <div>📍 {e.location}</div>}
                  {people.length > 0 && (
                    <>
                      <div className="muted">{people.length} guests · {yes} yes · {people.filter((p) => p.responseStatus === 'needsAction').length} awaiting</div>
                      {people.map((p) => (
                        <div key={p.email} className="ag-guest">
                          <span title={p.responseStatus}>{RSVP[p.responseStatus ?? 'needsAction']}</span> {p.displayName ?? p.email}
                          {p.organizer && <span className="muted"> (organizer)</span>}
                        </div>
                      ))}
                    </>
                  )}
                  <a href={e.htmlLink} target="_blank" rel="noreferrer">Open in Calendar ↗</a>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
