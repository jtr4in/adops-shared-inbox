// Unsent emails, kept in this browser so clicking away never loses what you wrote.
// One draft per thread (or "new" for a fresh email).
export interface Draft {
  mode: string;
  to: string;
  cc: string;
  bcc: string;
  subj: string;
  html: string;
  at: number;
}
const key = (id: string) => `draft:${id}`;

export function loadDraft(id: string): Draft | null {
  try {
    return JSON.parse(localStorage.getItem(key(id)) ?? 'null');
  } catch {
    return null;
  }
}
export function saveDraft(id: string, d: Omit<Draft, 'at'>) {
  try {
    localStorage.setItem(key(id), JSON.stringify({ ...d, at: Date.now() }));
  } catch {
    /* storage full (big pasted images): skip */
  }
  window.dispatchEvent(new Event('drafts-changed'));
}
export function clearDraft(id: string) {
  localStorage.removeItem(key(id));
  window.dispatchEvent(new Event('drafts-changed'));
}
export const hasDraft = (id: string) => localStorage.getItem(key(id)) !== null;
