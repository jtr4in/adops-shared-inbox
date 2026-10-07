import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

// Shared triage state for one email thread, keyed by its first Message-ID so
// Jason's and Riley's mailboxes land on the same document.
export interface Triage {
  assignee?: string | null;
  flagged?: boolean;
  done?: boolean;
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
