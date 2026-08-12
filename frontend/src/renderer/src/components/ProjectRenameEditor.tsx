import { useEffect, useRef, useState, type FormEvent } from 'react';

type ProjectRenameEditorProps = {
  initialName: string;
  inputId: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
};

export function ProjectRenameEditor({
  initialName,
  inputId,
  onSave,
  onCancel,
}: ProjectRenameEditorProps) {
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      await onSave(draft);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to rename this project');
    }
  };

  return (
    <form className="project-rename-editor" onSubmit={handleSubmit}>
      <label className="project-rename-label" htmlFor={inputId}>
        Project name
      </label>
      <input
        ref={inputRef}
        id={inputId}
        className="project-rename-input"
        type="text"
        value={draft}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="project-rename-actions">
        <button className="btn primary" type="submit">Save</button>
        <button className="btn subtle" type="button" onClick={onCancel}>Cancel</button>
      </div>
      {error && (
        <p className="project-rename-error" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
