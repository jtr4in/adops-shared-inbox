import { useEffect, useState } from 'react';
import { useSignature } from '../triage';

// Signature is stored as HTML on users/{email}. Paste the HTML of your existing
// Gmail/Outlook signature (images need to be hosted URLs).
export function SignatureDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const [saved, save] = useSignature(email);
  const [html, setHtml] = useState(saved);
  useEffect(() => setHtml(saved), [saved]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Your signature (HTML)</h3>
        <textarea rows={10} value={html} onChange={(e) => setHtml(e.target.value)} />
        <div className="section">Preview</div>
        <div className="sig-preview" dangerouslySetInnerHTML={{ __html: html }} />
        <div className="composer-bar">
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => save(html).then(onClose)}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
