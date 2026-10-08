import { useEffect, useState } from 'react';
import { attachmentBytes, downloadAttachment, openInSheets, type Attachment } from '../gmail';

const ext = (n: string) => n.split('.').pop()?.toLowerCase() ?? '';
export const isSheet = (a: Attachment) => ['csv', 'tsv', 'xlsx', 'xls', 'ods'].includes(ext(a.name));
export const canPreview = (a: Attachment) =>
  isSheet(a) || ext(a.name) === 'pdf' || ext(a.name) === 'txt' || a.mimeType.startsWith('image/');

type Content = { sheets: { name: string; rows: string[][] }[] } | { url: string; kind: 'pdf' | 'img' } | { text: string };

export function AttachmentPreview({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const [content, setContent] = useState<Content | null>(null);
  const [tab, setTab] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let url = '';
    (async () => {
      const bytes = await attachmentBytes(a);
      const e = ext(a.name);
      if (isSheet(a)) {
        const XLSX = await import('xlsx');
        const wb = e === 'csv' || e === 'tsv'
          ? XLSX.read(new TextDecoder().decode(bytes), { type: 'string', raw: true })
          : XLSX.read(bytes, { type: 'array' });
        setContent({
          sheets: wb.SheetNames.map((name) => ({
            name,
            rows: (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }) as string[][]).slice(0, 1000),
          })),
        });
      } else if (e === 'txt') setContent({ text: new TextDecoder().decode(bytes) });
      else {
        url = URL.createObjectURL(new Blob([bytes], { type: e === 'pdf' ? 'application/pdf' : a.mimeType }));
        setContent({ url, kind: e === 'pdf' ? 'pdf' : 'img' });
      }
    })().catch((x) => setErr(String(x?.message ?? x)));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [a]);

  const sheets = async () => {
    const w = window.open('', '_blank'); // open now, or the popup gets blocked after the upload
    setBusy(true);
    try {
      const url = await openInSheets(a);
      if (w) w.location.href = url; else window.open(url, '_blank');
    } catch (x) {
      w?.close();
      alert((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lightbox preview-bg" onClick={onClose}>
      <div className="preview" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>{a.name}</strong>
          <span className="spacer" />
          <button onClick={() => downloadAttachment(a)}>⤓ Save</button>
          {isSheet(a) && <button onClick={sheets} disabled={busy}>{busy ? 'Opening…' : 'Open with Sheets'}</button>}
          <button onClick={onClose}>✕</button>
        </header>
        {err && <p className="error">Couldn't preview: {err}</p>}
        {!content && !err && <p className="muted">Loading…</p>}
        {content && 'sheets' in content && (
          <>
            {content.sheets.length > 1 && (
              <div className="sheet-tabs">
                {content.sheets.map((s, i) => (
                  <button key={s.name} className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>{s.name}</button>
                ))}
              </div>
            )}
            <div className="preview-body">
              <table className="sheet">
                <tbody>
                  {content.sheets[tab]?.rows.map((r, i) => (
                    <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {content && 'text' in content && <pre className="preview-body">{content.text}</pre>}
        {content && 'url' in content && (content.kind === 'pdf'
          ? <iframe className="preview-body" src={content.url} title={a.name} />
          : <div className="preview-body"><img src={content.url} alt={a.name} /></div>)}
      </div>
    </div>
  );
}
