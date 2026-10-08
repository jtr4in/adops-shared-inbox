import { useRef, useState } from 'react';
import { TOOLS } from './Composer';
import { deleteTemplate, saveTemplate, useTemplates, type Template } from '../triage';

// Shared reply templates. Anything saved here shows up in every composer's Templates menu.
export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const templates = useTemplates();
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const exec = (cmd: string) => {
    editor.current?.focus();
    if (cmd === 'createLink') {
      const url = prompt('Link URL');
      if (url) document.execCommand('createLink', false, url);
    } else document.execCommand(cmd);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Team templates</h3>
        {!editing ? (
          <>
            {templates.length === 0 && <p className="muted">No templates yet.</p>}
            {templates.map((t) => (
              <div key={t.id} className="template-row">
                <strong>{t.name}</strong>
                <span className="spacer" />
                <button onClick={() => setEditing(t)}>Edit</button>
                <button onClick={() => confirm(`Delete "${t.name}"?`) && deleteTemplate(t.id)}>Delete</button>
              </div>
            ))}
            <div className="composer-bar">
              <button className="primary" onClick={() => setEditing({ name: '', html: '' })}>
                + New template
              </button>
              <span className="spacer" />
              <button onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <input
              placeholder="Template name"
              value={editing.name ?? ''}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <div className="toolbar">
              {TOOLS.map((t) => (
                <button
                  key={t.cmd}
                  title={t.title}
                  className={`tool tool-${t.cmd}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec(t.cmd)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div
              ref={editor}
              key={editing.id ?? 'new'}
              className="editor"
              contentEditable
              suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: editing.html ?? '' }}
            />
            <div className="composer-bar">
              <span className="spacer" />
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="primary"
                disabled={!editing.name}
                onClick={() =>
                  saveTemplate({ id: editing.id, name: editing.name!, html: editor.current?.innerHTML ?? '' }).then(() =>
                    setEditing(null),
                  )
                }
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
