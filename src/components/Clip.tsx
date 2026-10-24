// Plain paperclip (the 📎 emoji draws as a cartoon on some systems).
export const Clip = () => (
  <svg className="clip-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

// Sticky note, for team notes.
export const NoteIcon = () => (
  <svg className="clip-svg note-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" />
    <path d="M15 3v6h6" />
  </svg>
);

// Small toolbar icons (Gmail-style outline).
const paths: Record<string, string> = {
  done: 'M20 6 9 17l-5-5',
  flag: 'M4 22V4m0 0h13l-2 4 2 4H4',
  read: 'M3 9l9 6 9-6M3 9l9-6 9 6v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Z',
  unread: 'M3 6h18v12H3zM3 6l9 7 9-7',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
};
export const Icon = ({ name }: { name: keyof typeof paths }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={paths[name]} />
  </svg>
);
