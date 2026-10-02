import { useId, useState } from 'react';
import type { ScriptRun, ScriptRunError } from '../types/generated';

const COLLAPSED_LINES = 12;

const ERROR_KIND_LABELS: Record<ScriptRunError['kind'], string> = {
  syntax: 'Syntax error',
  runtime: 'Runtime error',
  operation: 'Invalid change',
  limit: 'Limit reached',
};

/** `Syntax error · line 4: …`; the backend prefixes `line N: ` to the message, so it is moved into place. */
function describeError({ kind, line, message }: ScriptRunError): string {
  if (line == null) return `${ERROR_KIND_LABELS[kind]}: ${message}`;
  const prefix = `line ${line}: `;
  const detail = message.startsWith(prefix) ? message.slice(prefix.length) : message;
  return `${ERROR_KIND_LABELS[kind]} · line ${line}: ${detail}`;
}

function changeCount(count: number): string {
  if (count === 0) return 'No changes';
  return count === 1 ? '1 change' : `${count} changes`;
}

/** One Script Run on a Review chat message: its source, log and error (ADR 0006). */
export function ScriptRunCard({
  script,
  sent,
  onEdit,
}: {
  script: ScriptRun;
  /** False while the run has not come back, so there is no change count yet. */
  sent: boolean;
  /** Loads the source back into the Script composer; offered on the Editor's own scripts. */
  onEdit?: (source: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const logLabelId = useId();
  const lines = script.source.split('\n');
  const collapsible = lines.length > COLLAPSED_LINES;
  const shownSource =
    collapsible && !expanded ? lines.slice(0, COLLAPSED_LINES).join('\n') : script.source;
  const log = script.log ?? [];
  const { error } = script;

  return (
    <section className="script-run-card" data-testid="script-run-card" aria-label="Script run">
      <header className="script-run-head">
        <strong>{script.author === 'agent' ? 'Agent script' : 'Script'}</strong>
        {sent ? (
          <span className="script-run-count">{changeCount(script.operation_count ?? 0)}</span>
        ) : null}
        {onEdit ? (
          <button
            type="button"
            className="script-run-link"
            onClick={() => onEdit(script.source)}
          >
            Edit
          </button>
        ) : null}
      </header>
      <pre className="script-run-code">
        <code>{shownSource}</code>
      </pre>
      {collapsible ? (
        <button
          type="button"
          className="script-run-link"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show fewer lines' : `Show all ${lines.length} lines`}
        </button>
      ) : null}
      {log.length > 0 ? (
        <div className="script-run-log">
          <span id={logLabelId} className="script-run-label">
            Log
          </span>
          <pre aria-labelledby={logLabelId}>{log.join('\n')}</pre>
        </div>
      ) : null}
      {error ? <p className="script-run-error">{describeError(error)}</p> : null}
    </section>
  );
}
