/**
 * In-app Review Agent chat panel (Phase C).
 *
 * The agent runs in propose mode: its edits arrive as Proposal cards the editor
 * Accepts or Rejects. Accepting replays the operations through the backend
 * operations core, so the timeline updates live (via the SSE reconcile in
 * ReviewContext) and the change is undoable. The panel auto-kicks one proactive
 * opening turn when it mounts for a project.
 *
 * The composer's Script mode runs the Editor's Lua Script locally; its Script
 * Run comes back on the Editor's own message with a Proposal to Apply (ADR 0006).
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { ReviewConversation } from '../hooks/useReviewConversation';
import { ProposalCard } from './ProposalCard';
import { ScriptRunCard } from './ScriptRunCard';
import { SegmentedControl } from './SegmentedControl';

interface ReviewChatPanelProps {
  conversation: ReviewConversation;
}

type ComposerMode = 'message' | 'script';

const COMPOSER_MODES = [
  { value: 'message', label: 'Message' },
  { value: 'script', label: 'Script' },
] as const;

const RUN_SHORTCUT = navigator.userAgent.includes('Mac') ? '⌘↩' : 'Ctrl+↩';

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return messageTimeFormatter.format(date);
}

export function ReviewChatPanel({ conversation }: ReviewChatPanelProps) {
  const {
    messages,
    busy,
    runningScript,
    error,
    send,
    runScript,
    resolveProposal,
    staleProposalIds,
    pendingProposalIds,
    undoableProposalId,
    undoProposal,
    clearHistory,
  } = conversation;
  const [mode, setMode] = useState<ComposerMode>('message');
  const [messageDraft, setMessageDraft] = useState('');
  const [scriptDraft, setScriptDraft] = useState('');
  const scriptRef = useRef<HTMLTextAreaElement>(null);
  const focusScript = useRef(false);
  const hintId = useId();
  const logRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);
  // The log follows new messages until the Editor scrolls up. Scroll events
  // from our own smooth scrolling are ignored, so a result that grows the log
  // mid-scroll is still followed.
  const following = useRef(true);
  const autoScrolling = useRef(false);
  useEffect(() => {
    const log = logRef.current;
    if (hydrated.current && !following.current) return;
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight > 1) {
      autoScrolling.current = hydrated.current;
      endRef.current?.scrollIntoView({
        behavior: hydrated.current ? 'smooth' : 'auto',
        block: 'end',
      });
    }
    hydrated.current = true;
  }, [messages, busy, error]);
  useEffect(() => {
    if (mode !== 'script' || !focusScript.current) return;
    focusScript.current = false;
    scriptRef.current?.focus();
  }, [mode]);

  const follow = () => {
    following.current = true;
  };

  const editScript = (source: string) => {
    setScriptDraft(source);
    if (mode === 'script') {
      scriptRef.current?.focus();
      return;
    }
    focusScript.current = true;
    setMode('script');
  };

  const submit = () => {
    if (mode === 'script') {
      if (!scriptDraft.trim()) return;
      follow();
      // Scripts are iterated, so the draft stays; it is sent untrimmed to keep line numbers.
      if (scriptRef.current) scriptRef.current.scrollLeft = 0;
      void runScript(scriptDraft);
      return;
    }
    const text = messageDraft.trim();
    if (!text) return;
    follow();
    setMessageDraft('');
    void send(text);
  };

  const draft = mode === 'script' ? scriptDraft : messageDraft;

  return (
    <aside
      className="review-chat"
      aria-label="Ask the AI"
      data-testid="review-chat-panel"
      data-review-chat-surface
    >
      <div className="review-chat-head">
        <div>
          <strong>Ask the AI</strong>
          <span className="draft-summary">Describe the cut you want</span>
        </div>
        <button
          type="button"
          className="btn subtle review-chat-clear"
          onClick={() => {
            if (busy) return;
            if (messages.length > 0 && !window.confirm('Start a new session and clear this chat history?')) {
              return;
            }
            void clearHistory();
          }}
          disabled={busy}
          title="Clear the chat history and start a new session"
        >
          New session
        </button>
      </div>
      <div
        ref={logRef}
        className="review-chat-log"
        data-testid="review-chat-log"
        aria-busy={busy}
        aria-live={!busy && hydrated.current ? 'polite' : 'off'}
        aria-relevant="additions text"
        role="log"
        onScroll={() => {
          const log = logRef.current;
          if (!log || autoScrolling.current) return;
          following.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
        }}
        onScrollEnd={() => {
          autoScrolling.current = false;
        }}
        onWheel={(event) => {
          if (event.deltaY >= 0) return;
          autoScrolling.current = false;
          following.current = false;
        }}
      >
        {messages.map((message) => {
          const { script, proposal } = message;
          return (
            <article
              key={message.message_id}
              className={`chat-msg chat-${message.role}${script ? ' chat-script' : ''}`}
              data-message-id={message.message_id}
              aria-label={`${message.role === 'agent' ? 'AI' : 'You'} message at ${formatMessageTime(message.created_at)}`}
            >
              <header className="chat-msg-meta">
                <span>{message.role === 'agent' ? 'AI' : 'You'}</span>
                <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
              </header>
              {message.text ? <p className="chat-msg-body">{message.text}</p> : null}
              {script ? (
                <ScriptRunCard
                  script={script}
                  sent={message.deliveryState === 'persisted'}
                  onEdit={script.author === 'editor' ? editScript : undefined}
                />
              ) : null}
              {message.role === 'editor' && message.deliveryState !== 'persisted' ? (
                <p className={`chat-delivery chat-delivery-${message.deliveryState}`}>
                  {message.deliveryState === 'sending' ? (
                    script ? 'Running' : 'Sending'
                  ) : (
                    <>
                      Not sent ·{' '}
                      <button
                        type="button"
                        className="chat-retry"
                        onClick={() => {
                          follow();
                          void (script
                            ? runScript(script.source, message.rerunOfProposalId, message.message_id)
                            : send(message.text, message.message_id));
                        }}
                        disabled={busy}
                      >
                        Retry
                      </button>
                    </>
                  )}
                </p>
              ) : null}
              {proposal ? (
                <ProposalCard
                  proposal={proposal}
                  onResolve={resolveProposal}
                  fromScript={Boolean(script)}
                  stale={staleProposalIds.has(proposal.proposal_id)}
                  onRunAgain={
                    script
                      ? () => {
                          follow();
                          void runScript(script.source, proposal.proposal_id);
                        }
                      : undefined
                  }
                  undoable={undoableProposalId === proposal.proposal_id}
                  onUndo={() => void undoProposal()}
                  disabled={busy || pendingProposalIds.has(proposal.proposal_id)}
                />
              ) : null}
            </article>
          );
        })}
        {error ? (
          <article className="chat-msg chat-agent chat-error" role="alert">
            <header className="chat-msg-meta">
              <span>AI</span>
            </header>
            <p className="chat-msg-body">{error}</p>
          </article>
        ) : null}
        {busy ? (
          <output
            className="chat-busy"
            aria-label={runningScript ? 'Running the script' : 'The AI is thinking'}
          >
            <span />
            <span />
            <span />
          </output>
        ) : null}
        <div ref={endRef} className="chat-log-end" aria-hidden="true" />
      </div>
      <form
        className="review-chat-input"
        data-mode={mode}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <SegmentedControl<ComposerMode>
          value={mode}
          options={COMPOSER_MODES}
          onChange={setMode}
          ariaLabel="Composer mode"
          className="composer-mode"
        />
        {mode === 'script' ? (
          <textarea
            ref={scriptRef}
            className="review-chat-script"
            value={scriptDraft}
            rows={Math.min(12, Math.max(5, scriptDraft.split('\n').length))}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={'-- e.g. library:clips{ decision = "included" }'}
            onChange={(event) => setScriptDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
                return;
              }
              // Tab indents; Shift+Tab keeps moving focus so the field is never a keyboard trap.
              if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                const field = event.currentTarget;
                field.setRangeText('  ', field.selectionStart, field.selectionEnd, 'end');
                setScriptDraft(field.value);
              }
            }}
            aria-label="Lua script"
            aria-describedby={hintId}
          />
        ) : null}
        <div className="review-chat-row">
          {mode === 'message' ? (
            <input
              type="text"
              value={messageDraft}
              placeholder="Ask the AI…"
              onChange={(event) => setMessageDraft(event.target.value)}
              aria-label="Message the AI"
            />
          ) : (
            <span id={hintId} className="review-chat-hint">
              Tab indents · Shift+Tab leaves · {RUN_SHORTCUT} runs
            </span>
          )}
          <button type="submit" className="btn primary" disabled={busy || !draft.trim()}>
            {mode === 'script' ? 'Run' : 'Send'}
          </button>
        </div>
      </form>
    </aside>
  );
}
