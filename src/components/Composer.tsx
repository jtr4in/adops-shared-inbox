import { useEffect, useRef, useState } from 'react';
import {
  addresses,
  fileToOutgoing,
  getAttachmentData,
  listSendAs,
  MAX_ATTACH_BYTES,
  rememberRecipients,
  send,
  type Attachment,
  type Message,
  type SendAs,
} from '../gmail';
import { AddressInput } from './AddressInput';
import { saveTemplate, useSignature, useTemplates } from '../triage';

export type ReplyMode = 'reply' | 'replyAll' | 'forward' | 'new';

interface Props {
  mode: ReplyMode;
  messages?: Message[];
  subject?: string;
  me: string;
  onClose: () => void;
  onSent: () => void;
  othersReplying?: string[];
}

const uniq = (xs: string[]) => [...new Set(xs)];

function recipients(mode: ReplyMode, last: Message | undefined, mine: string[]) {
  if (!last || mode === 'forward' || mode === 'new') return { to: [], cc: [] };
  const fromMe = addresses(last.from).some((a) => mine.includes(a));
  // Replying to our own last message goes back to whoever we sent it to.
  const primary = fromMe ? addresses(last.to) : addresses(last.from);
  if (mode === 'reply') return { to: primary, cc: [] };
  const notMe = (a: string) => !mine.includes(a);
  const to = uniq([...primary, ...(fromMe ? [] : addresses(last.to))]).filter(notMe);
  const cc = uniq(addresses(last.cc)).filter((a) => notMe(a) && !to.includes(a));
  return { to, cc };
}

function quote(m: Message, forward: boolean) {
  return `<div style="border-top:1px solid #ccc;padding-top:8px;margin-top:16px">
${forward ? '---------- Forwarded message ---------<br>' : ''}<b>From:</b> ${esc(m.from)}<br><b>Sent:</b> ${new Date(m.date).toLocaleString()}<br>
<b>To:</b> ${esc(m.to)}<br>${m.cc ? `<b>Cc:</b> ${esc(m.cc)}<br>` : ''}<b>Subject:</b> ${esc(m.subject)}<br><br>
${m.html ?? ''}</div>`;
}

const EMAIL_FONT = 'font-family:Calibri,Arial,Helvetica,sans-serif;font-size:11pt;color:#000';

export const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const TOOLS: { cmd: string; label: string; title: string }[] = [
  { cmd: 'bold', label: 'B', title: 'Bold' },
  { cmd: 'italic', label: 'I', title: 'Italic' },
  { cmd: 'underline', label: 'U', title: 'Underline' },
  { cmd: 'strikeThrough', label: 'S', title: 'Strikethrough' },
  { cmd: 'insertUnorderedList', label: '•', title: 'Bullets' },
  { cmd: 'insertOrderedList', label: '1.', title: 'Numbering' },
  { cmd: 'outdent', label: '⇤', title: 'Decrease indent' },
  { cmd: 'indent', label: '⇥', title: 'Increase indent' },
  { cmd: 'createLink', label: '🔗', title: 'Link' },
  { cmd: 'removeFormat', label: '⌫', title: 'Clear formatting' },
  { cmd: 'undo', label: '↶', title: 'Undo' },
  { cmd: 'redo', label: '↷', title: 'Redo' },
];

const TITLES: Record<ReplyMode, string> = {
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
  new: 'New email',
};

export function Composer({ mode, messages, subject = '', me, onClose, onSent, othersReplying = [] }: Props) {
  const last = messages?.[messages.length - 1];
  const [sendAs, setSendAs] = useState<SendAs[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subj, setSubj] = useState(() => {
    if (mode === 'new') return '';
    const prefix = mode === 'forward' ? 'Fwd: ' : 'Re: ';
    return /^(re|fwd?):/i.test(subject) && mode !== 'forward' ? subject : prefix + subject.replace(/^(re|fwd?):\s*/i, '');
  });
  const [useSig, setUseSig] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [customSig] = useSignature(me);
  const templates = useTemplates();
  // Your saved override wins; otherwise use the signature Gmail has for the chosen From address.
  const signature = customSig || sendAs.find((s) => s.sendAsEmail === from)?.signature || '';
  const editor = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  // Forwarding carries the original attachments along (fetched at send time).
  const [forwarded, setForwarded] = useState<Attachment[]>(mode === 'forward' && last ? last.attachments : []);
  const originalQuote = last ? quote(last, mode === 'forward') : '';

  // The editor holds your text, then your signature, then the original email,
  // all editable (trim the quoted email before sending if you like).
  useEffect(() => {
    if (editor.current && !editor.current.innerHTML) {
      editor.current.innerHTML = `<div><br></div><div data-sig></div>${originalQuote ? `<div data-quote>${originalQuote}</div>` : ''}`;
      const sel = window.getSelection();
      sel?.collapse(editor.current.firstChild, 0);
    }
  }, [originalQuote]);
  useEffect(() => {
    const el = editor.current?.querySelector('[data-sig]');
    if (el) el.innerHTML = useSig && signature ? `<br>${signature}` : '';
  }, [useSig, signature]);

  const resetQuote = () => {
    const el = editor.current?.querySelector('[data-quote]');
    if (el) el.innerHTML = originalQuote;
    else if (editor.current && originalQuote) editor.current.insertAdjacentHTML('beforeend', `<div data-quote>${originalQuote}</div>`);
  };

  const totalBytes = files.reduce((n, f) => n + f.size, 0) + forwarded.reduce((n, a) => n + a.size, 0);
  const addFiles = (list: FileList | null) => list && setFiles((cur) => [...cur, ...Array.from(list)]);

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

  function exec(cmd: string) {
    editor.current?.focus();
    if (cmd === 'createLink') {
      const url = prompt('Link URL');
      if (url) document.execCommand('createLink', false, url);
      return;
    }
    document.execCommand(cmd);
  }

  function insertTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    editor.current?.focus();
    document.execCommand('insertHTML', false, t.html);
  }

  async function saveAsTemplate() {
    const html = editor.current?.innerHTML.trim();
    if (!html) return alert('Write something first, then save it as a template.');
    const name = prompt('Template name');
    if (name) await saveTemplate({ name, html });
  }

  async function submit() {
    if (othersReplying.length && !confirm(`${othersReplying.join(', ')} is also replying to this email right now. Send anyway?`)) return;
    setSending(true);
    setError('');
    try {
      if (totalBytes > MAX_ATTACH_BYTES) throw new Error('Attachments are over 20 MB. Remove some or share a link instead.');
      const sa = sendAs.find((s) => s.sendAsEmail === from);
      // Wrap in the same base font the editor shows, so recipients see what you saw.
      const html = `<div style="${EMAIL_FONT}">${editor.current?.innerHTML ?? ''}</div>`;
      const outgoing = [
        ...(await Promise.all(files.map(fileToOutgoing))),
        ...(await Promise.all(
          forwarded.map(async (a) => ({ name: a.name, mimeType: a.mimeType, base64: await getAttachmentData(a) })),
        )),
      ];
      const isReply = (mode === 'reply' || mode === 'replyAll') && last;
      await send({
        from: sa?.displayName ? `"${sa.displayName}" <${from}>` : from,
        to: addresses(to),
        cc: addresses(cc),
        bcc: addresses(bcc),
        subject: subj,
        html,
        threadId: isReply ? last.threadId : undefined,
        inReplyTo: isReply ? last.messageId : undefined,
        references: isReply ? `${last.references} ${last.messageId}`.trim() : undefined,
        files: outgoing,
      });
      rememberRecipients([...addresses(to), ...addresses(cc), ...addresses(bcc)]);
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
        <strong>{TITLES[mode]}</strong>
        <span className="spacer" />
        <label className="small">
          <input type="checkbox" checked={useSig} onChange={(e) => setUseSig(e.target.checked)} /> Signature
        </label>
        <select value="" onChange={(e) => (e.target.value === '+' ? saveAsTemplate() : insertTemplate(e.target.value))}>
          <option value="">Templates…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
          <option value="+">＋ Save current text as template</option>
        </select>
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
        <AddressInput value={to} onChange={setTo} placeholder="name@example.com, …" />
      </label>
      <label className="field">
        Cc
        <AddressInput value={cc} onChange={setCc} />
      </label>
      <label className="field">
        Bcc
        <AddressInput value={bcc} onChange={setBcc} />
      </label>
      <label className="field">
        Subject
        <input value={subj} onChange={(e) => setSubj(e.target.value)} />
      </label>
      <div className="toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.cmd}
            title={t.title}
            className={`tool tool-${t.cmd}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(t.cmd)}
          >
            {t.label}
          </button>
        ))}
        <button className="tool" title="Attach files" onClick={() => fileInput.current?.click()}>
          📎
        </button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <span className="spacer" />
        {originalQuote && (
          <button className="tool small" onClick={resetQuote} title="Restore the quoted email below">
            Reset original email
          </button>
        )}
      </div>
      <div
        ref={editor}
        className="editor"
        contentEditable
        suppressContentEditableWarning
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }
        }}
      />
      {(files.length > 0 || forwarded.length > 0) && (
        <div className="attach-list">
          {files.map((f, i) => (
            <span key={`f${i}`} className="attach">
              📎 {f.name} <span className="muted">({kb(f.size)})</span>
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {forwarded.map((a) => (
            <span key={a.attachmentId} className="attach">
              📎 {a.name} <span className="muted">({kb(a.size)})</span>
              <button onClick={() => setForwarded(forwarded.filter((x) => x !== a))}>×</button>
            </span>
          ))}
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
