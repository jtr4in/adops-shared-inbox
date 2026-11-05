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

export const IR_SEARCH_URL =
  'https://app.impact.com/secure/mediapartner/marketplace/new-campaign-marketplace-flow.ihtml?execution=e2s1&q=';

export function irSearch() {
  const term = highlightedText() || prompt('Impact search for:')?.trim();
  if (term) window.open(IR_SEARCH_URL + encodeURIComponent(term), '_blank', 'noopener');
}
