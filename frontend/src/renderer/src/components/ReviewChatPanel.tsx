/**
 * In-app Review Agent chat panel (Phase C).
 *
 * The agent runs in propose mode: its edits arrive as Proposal cards the editor
 * Accepts or Rejects. Accepting replays the operations through the backend
 * operations core, so the timeline updates live (via the SSE reconcile in
 * ReviewContext) and the change is undoable. The panel auto-kicks one proactive
 * opening turn when it mounts for a project.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReviewConversation } from '../hooks/useReviewConversation';
import { ProposalCard } from './ProposalCard';

interface ReviewChatPanelProps {
  conversation: ReviewConversation;
}

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
  const { messages, busy, error, send, resolveProposal, clearHistory } = conversation;
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);
  const nearBottom = useRef(true);
  useEffect(() => {
    if (!hydrated.current || nearBottom.current) {
      endRef.current?.scrollIntoView({
        behavior: hydrated.current ? 'smooth' : 'auto',
        block: 'end',
      });
    }
    hydrated.current = true;
  }, [messages, busy, error]);

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
          if (!log) return;
          nearBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
        }}
      >
        {messages.map((message) => (
          <article
            key={message.message_id}
            className={`chat-msg chat-${message.role}`}
            data-message-id={message.message_id}
            aria-label={`${message.role === 'agent' ? 'AI' : 'You'} message at ${formatMessageTime(message.created_at)}`}
          >
            <header className="chat-msg-meta">
              <span>{message.role === 'agent' ? 'AI' : 'You'}</span>
              <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
            </header>
            <p className="chat-msg-body">{message.text}</p>
            {message.role === 'editor' && message.deliveryState !== 'persisted' ? (
              <p className={`chat-delivery chat-delivery-${message.deliveryState}`}>
                {message.deliveryState === 'sending' ? (
                  'Sending'
                ) : (
                  <>
                    Not sent ·{' '}
                    <button
                      type="button"
                      className="chat-retry"
                      onClick={() => void send(message.text, message.message_id)}
                      disabled={busy}
                    >
                      Retry
                    </button>
                  </>
                )}
              </p>
            ) : null}
            {message.proposal ? (
              <ProposalCard proposal={message.proposal} onResolve={resolveProposal} />
            ) : null}
          </article>
        ))}
        {error ? (
          <article className="chat-msg chat-agent chat-error" role="alert">
            <header className="chat-msg-meta">
              <span>AI</span>
            </header>
            <p className="chat-msg-body">{error}</p>
          </article>
        ) : null}
        {busy ? (
          <output className="chat-busy" aria-label="The AI is thinking">
            <span />
            <span />
            <span />
          </output>
        ) : null}
        <div ref={endRef} className="chat-log-end" aria-hidden="true" />
      </div>
      <form
        className="review-chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          const text = input.trim();
          if (!text) return;
          setInput('');
          void send(text);
        }}
      >
        <input
          type="text"
          value={input}
          placeholder="Ask the AI…"
          onChange={(event) => setInput(event.target.value)}
          aria-label="Message the AI"
        />
        <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
