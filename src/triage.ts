import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { categorize } from './config';

// Shared triage state for one email thread, keyed by its first Message-ID so
// Jason's and Riley's mailboxes land on the same document.
export interface Triage {
  assignee?: string | null;
  flagged?: boolean;
  done?: boolean;
  category?: string; // manual smart-folder override
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
  return setDoc(
    doc(db, 'threads', key),
    { ...patch, subject, updatedBy: auth.currentUser?.email ?? '', updatedAt: serverTimestamp() },
    { merge: true },
  );
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

export const categoryOf = (t: { subject: string; snippet: string }, tr: Triage | undefined) =>
  tr?.category || categorize(t.subject, t.snippet);
