import { useEffect, useRef, useState } from 'react';
import { addresses, listSendAs, send, type Message, type SendAs } from '../gmail';
import { useSignature } from '../triage';

export type ReplyMode = 'reply' | 'replyAll' | 'forward';

interface Props {
  mode: ReplyMode;
  messages: Message[];
  subject: string;
  me: string;
  onClose: () => void;
  onSent: () => void;
}

const uniq = (xs: string[]) => [...new Set(xs)];

function recipients(mode: ReplyMode, last: Message, mine: string[]) {
  if (mode === 'forward') return { to: [], cc: [] };
  const fromMe = addresses(last.from).some((a) => mine.includes(a));
  // Replying to our own last message goes back to whoever we sent it to.
  const primary = fromMe ? addresses(last.to) : addresses(last.from);
  if (mode === 'reply') return { to: primary, cc: [] };
  const notMe = (a: string) => !mine.includes(a);
  const to = uniq([...primary, ...(fromMe ? [] : addresses(last.to))]).filter(notMe);
  const cc = uniq(addresses(last.cc)).filter((a) => notMe(a) && !to.includes(a));
  return { to, cc };
}

function quote(m: Message) {
  return `<br><div style="border-top:1px solid #ccc;padding-top:8px;margin-top:16px">
<b>From:</b> ${esc(m.from)}<br><b>Sent:</b> ${new Date(m.date).toLocaleString()}<br>
<b>To:</b> ${esc(m.to)}<br>${m.cc ? `<b>Cc:</b> ${esc(m.cc)}<br>` : ''}<b>Subject:</b> ${esc(m.subject)}<br><br>
${m.html ?? ''}</div>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function Composer({ mode, messages, subject, me, onClose, onSent }: Props) {
  const last = messages[messages.length - 1];
  const [sendAs, setSendAs] = useState<SendAs[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [useSig, setUseSig] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [customSig] = useSignature(me);
  // Your saved override wins; otherwise use the signature Gmail has for the chosen From address.
  const signature = customSig || sendAs.find((s) => s.sendAsEmail === from)?.signature || '';
  const editor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listSendAs()
      .then((list) => {
        setSendAs(list);
        setFrom((list.find((s) => s.isDefault) ?? list[0])?.sendAsEmail ?? me);
        const mine = [me, ...list.map((s) => s.sendAsEmail.toLowerCase())];
        const r = recipients(mode, last, mine);
        setTo(r.to.join(', '));
        setCc(r.cc.join(', '));
      })
      .catch((e) => setError(String(e)));
    editor.current?.focus();
  }, [mode, last, me]);

  const prefix = mode === 'forward' ? 'Fwd: ' : 'Re: ';
  const fullSubject = /^(re|fwd?):/i.test(subject) ? subject : prefix + subject;

  async function submit() {
    setSending(true);
    setError('');
    try {
      const sa = sendAs.find((s) => s.sendAsEmail === from);
      const body = editor.current?.innerHTML ?? '';
      const html = `<div>${body}</div>${useSig && signature ? `<br>${signature}` : ''}${quote(last)}`;
      const isReply = mode !== 'forward';
      await send({
        from: sa?.displayName ? `"${sa.displayName}" <${from}>` : from,
        to: addresses(to),
        cc: addresses(cc),
        subject: fullSubject,
        html,
        threadId: isReply ? last.threadId : undefined,
        inReplyTo: isReply ? last.messageId : undefined,
        references: isReply ? `${last.references} ${last.messageId}`.trim() : undefined,
      });
      onSent();
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer">
      <div className="composer-bar">
        <button className="primary" disabled={sending || !addresses(to).length} onClick={submit}>
          {sending ? 'Sending…' : 'Send'}
        </button>
        <strong>{{ reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' }[mode]}</strong>
        <span className="spacer" />
        <label>
          <input type="checkbox" checked={useSig} onChange={(e) => setUseSig(e.target.checked)} /> Signature
        </label>
        <button onClick={onClose}>Discard</button>
      </div>
      <label className="field">
        From
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          {sendAs.map((s) => (
            <option key={s.sendAsEmail} value={s.sendAsEmail}>
              {s.displayName ? `${s.displayName} <${s.sendAsEmail}>` : s.sendAsEmail}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        To
        <input value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="field">
        Cc
        <input value={cc} onChange={(e) => setCc(e.target.value)} />
      </label>
      <div className="muted small">Subject: {fullSubject}</div>
      <div ref={editor} className="editor" contentEditable suppressContentEditableWarning />
      {useSig && signature && <div className="sig-preview" dangerouslySetInnerHTML={{ __html: signature }} />}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
