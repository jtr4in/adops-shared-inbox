// Remembers the most recently highlighted text anywhere in the app, including
// inside email bodies (which render in their own iframes).
let last = '';

export function trackSelection(doc: Document) {
  doc.addEventListener('selectionchange', () => {
    const text = doc.getSelection()?.toString().trim() ?? '';
    if (text) last = text;
  });
}

export function highlightedText(): string {
  return last;
}

export const MB_SEARCH_URL = 'https://admin.maxbounty.com/search?searchTerm=';

export function mbSearch() {
  const term = highlightedText() || prompt('MB Search for:')?.trim();
  if (term) window.open(MB_SEARCH_URL + encodeURIComponent(term), '_blank', 'noopener');
}
