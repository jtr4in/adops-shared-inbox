import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  increment,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { CATEGORIES, categorize, folderText, DEFAULT_FOLDERS, setMyFolders, setSharedFolders, type Folder } from './config';

// Shared triage state for one email thread, keyed by its first Message-ID so
// Jason's and Riley's mailboxes land on the same document.
export interface Triage {
  assignee?: string | null;
  flagged?: boolean;
  done?: boolean;
  category?: string; // manual smart-folder override
  noteCount?: number; // team notes on this thread (for the list icon)
  autoAssigned?: boolean; // smart assignment already ran (don't redo after a manual unassign)
  subject?: string;
  updatedBy?: string;
  updatedAt?: Timestamp;
}

export interface Note {
  id: string;
  text: string;
  author: string;
  createdAt?: Timestamp;
}

export function useTriage(): Record<string, Triage> {
  const [state, setState] = useState<Record<string, Triage>>({});
  useEffect(
    () =>
      onSnapshot(collection(db, 'threads'), (snap) => {
        const next: Record<string, Triage> = {};
        snap.forEach((d) => (next[d.id] = d.data() as Triage));
        setState(next);
      }),
    [],
  );
  return state;
}

export function updateTriage(key: string, subject: string, patch: Partial<Triage>) {
  const p = setDoc(
    doc(db, 'threads', key),
    { ...patch, subject, updatedBy: auth.currentUser?.email ?? '', updatedAt: serverTimestamp() },
    { merge: true },
  );
  // Never fail silently: tell the person why a Done/assign/flag didn't save.
  p.catch((e) => alert(`Couldn't save that change (signed in as ${auth.currentUser?.email}).\n\n${e}`));
  return p;
}

export function useNotes(key: string | undefined): Note[] {
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    if (!key) return setNotes([]);
    return onSnapshot(query(collection(db, 'threads', key, 'notes'), orderBy('createdAt')), (snap) =>
      setNotes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Note, 'id'>) }))),
    );
  }, [key]);
  return notes;
}

export function addNote(key: string, text: string) {
  setDoc(doc(db, 'threads', key), { noteCount: increment(1) }, { merge: true }).catch(() => {});
  return addDoc(collection(db, 'threads', key, 'notes'), {
    text,
    author: auth.currentUser?.email ?? '',
    createdAt: serverTimestamp(),
  });
}

export function useSignature(email: string | null | undefined): [string, (html: string) => Promise<void>] {
  const [sig, setSig] = useState('');
  useEffect(() => {
    if (!email) return;
    return onSnapshot(doc(db, 'users', email), (d) => setSig((d.data()?.signature as string) ?? ''));
  }, [email]);
  const save = (html: string) => setDoc(doc(db, 'users', email!), { signature: html }, { merge: true });
  return [sig, save];
}

// Shared reply templates everyone on the team can use.
export interface Template {
  id: string;
  name: string;
  html: string;
  createdBy?: string;
}

export function useTemplates(): Template[] {
  const [list, setList] = useState<Template[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'templates'), orderBy('name')), (snap) =>
        setList(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Template, 'id'>) }))),
      ),
    [],
  );
  return list;
}

export function saveTemplate(t: { id?: string; name: string; html: string }) {
  const data = { name: t.name, html: t.html, createdBy: auth.currentUser?.email ?? '' };
  return t.id ? setDoc(doc(db, 'templates', t.id), data, { merge: true }) : addDoc(collection(db, 'templates'), data);
}

export function deleteTemplate(id: string) {
  return deleteDoc(doc(db, 'templates', id));
}

export const categoryOf = (t: Parameters<typeof folderText>[0], tr: Triage | undefined) =>
  (tr?.category && CATEGORIES.some((c) => c.name === tr.category) ? tr.category : null) ?? categorize(folderText(t));

// Smart folder settings: AdOps folders are shared (config/folders), "My" folders live on the user's own doc.
export function useFolders(email: string) {
  const [version, bump] = useState(0);
  useEffect(() => {
    const a = onSnapshot(doc(db, 'config', 'folders'), (d) => {
      const list = d.data()?.folders as Folder[] | undefined;
      setSharedFolders(list ?? DEFAULT_FOLDERS);
      bump((n) => n + 1);
    }, () => {});
    const b = onSnapshot(doc(db, 'users', email), (d) => {
      setMyFolders((d.data()?.folders as Folder[] | undefined) ?? []);
      bump((n) => n + 1);
    });
    return () => (a(), b());
  }, [email]);
  return version;
}

export const saveSharedFolders = (folders: Folder[]) =>
  setDoc(doc(db, 'config', 'folders'), { folders, updatedBy: auth.currentUser?.email ?? '' });
export const saveMyFolders = (email: string, folders: Folder[]) =>
  setDoc(doc(db, 'users', email), { folders }, { merge: true });

// Live presence: one doc per teammate saying which thread they have open and
// whether they're writing a reply. Heartbeat keeps it fresh; stale = gone.
export interface Presence {
  email: string;
  threadKey: string | null;
  composing: boolean;
  at?: Timestamp;
}

const PRESENCE_STALE_MS = 60_000;

export function usePresence(): Presence[] {
  const [list, setList] = useState<Presence[]>([]);
  const [, tick] = useState(0);
  useEffect(() => {
    const off = onSnapshot(collection(db, 'presence'), (snap) =>
      setList(snap.docs.map((d) => ({ email: d.id, ...(d.data() as Omit<Presence, 'email'>) }))),
    );
    const id = setInterval(() => tick((n) => n + 1), 15_000); // re-evaluate staleness
    return () => {
      off();
      clearInterval(id);
    };
  }, []);
  const me = auth.currentUser?.email;
  return list.filter(
    (p) => p.email !== me && p.threadKey && p.at && Date.now() - p.at.toMillis() < PRESENCE_STALE_MS,
  );
}

export function useReportPresence(threadKey: string | null, composing: boolean) {
  useEffect(() => {
    const me = auth.currentUser?.email;
    if (!me) return;
    const write = (key: string | null) =>
      setDoc(doc(db, 'presence', me), { threadKey: key, composing: !!key && composing, at: serverTimestamp() }).catch(
        () => {},
      );
    write(threadKey);
    const id = setInterval(() => write(threadKey), 20_000);
    const leave = () => write(null);
    window.addEventListener('beforeunload', leave);
    return () => {
      clearInterval(id);
      window.removeEventListener('beforeunload', leave);
    };
  }, [threadKey, composing]);
}
