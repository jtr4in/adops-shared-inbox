import { useState } from 'react';
import { FALLBACK_FOLDER, MY_FOLDERS, sharedFolders, type Folder } from '../config';
import { saveMyFolders, saveSharedFolders } from '../triage';

function FolderList({ list, onChange }: { list: Folder[]; onChange: (l: Folder[]) => void }) {
  const set = (i: number, patch: Partial<Folder>) => onChange(list.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => {
    const l = [...list];
    [l[i], l[i + d]] = [l[i + d], l[i]];
    onChange(l);
  };
  return (
    <div className="folder-list">
      {list.map((f, i) => (
        <div key={i} className="folder-row">
          <input value={f.name} placeholder="Folder name" onChange={(e) => set(i, { name: e.target.value })} />
          <input value={f.keywords} placeholder="Keywords, comma separated (e.g. invoice, payout, @advertiser.com)" onChange={(e) => set(i, { keywords: e.target.value })} />
          <button disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
          <button disabled={i === list.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
          <button onClick={() => onChange(list.filter((_, j) => j !== i))} title="Delete">✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...list, { name: '', keywords: '' }])}>+ Add folder</button>
    </div>
  );
}

export function FoldersDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const [shared, setShared] = useState<Folder[]>(() => sharedFolders().map((f) => ({ ...f })));
  const [mine, setMine] = useState<Folder[]>(() => MY_FOLDERS.map((f) => ({ ...f })));
  const [saving, setSaving] = useState(false);
  const clean = (l: Folder[]) => l.map((f) => ({ name: f.name.trim(), keywords: f.keywords.trim() })).filter((f) => f.name && f.keywords);

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all([saveSharedFolders(clean(shared)), saveMyFolders(email, clean(mine))]);
      onClose();
    } catch (e) {
      alert(`Couldn't save: ${e}`);
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal folders" onClick={(e) => e.stopPropagation()}>
        <h3>AdOps Smart Folders</h3>
        <p className="muted small">
          Shared with the whole team. Each email goes in the first folder whose keywords match its subject, preview or
          sender; anything else goes to {FALLBACK_FOLDER}.
        </p>
        <FolderList list={shared} onChange={setShared} />
        <h3>My Smart Folders</h3>
        <p className="muted small">Only you see these. An email shows in every one of your folders it matches.</p>
        <FolderList list={mine} onChange={setMine} />
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
