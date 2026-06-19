/**
 * In-app Review Agent chat panel (Phase C).
 *
 * The agent runs in propose mode: its edits arrive as Proposal cards the editor
 * Accepts or Rejects. Accepting replays the operations through the backend
 * operations core, so the timeline updates live (via the SSE reconcile in
 * ReviewContext) and the change is undoable. The panel auto-kicks one proactive
 * opening turn when it mounts for a project.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptProposal,
  rejectProposal,
  reviewKickoff,
  reviewTurn,
  type Proposal,
} from '../api/client';
import { useReview } from '../state/ReviewContext';

interface ChatMessage {
  id: number;
  role: 'agent' | 'editor';
  text: string;
  proposal?: Proposal | null;
}

export function ReviewChatPanel() {
  const { projectId } = useReview();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const kickedFor = useRef<string | null>(null);
  const nextId = useRef(0);
  const makeMessage = (message: Omit<ChatMessage, 'id'>): ChatMessage => {
    nextId.current += 1;
    return { id: nextId.current, ...message };
  };

  useEffect(() => {
    if (!projectId || kickedFor.current === projectId) return;
    kickedFor.current = projectId;
    setMessages([]);
    setBusy(true);
    reviewKickoff(projectId)
      .then((result) =>
        setMessages([makeMessage({ role: 'agent', text: result.message, proposal: result.proposal })]),
      )
      .catch(() => {
        /* opening turn is best-effort */
      })
      .finally(() => setBusy(false));
  }, [projectId]);

  const send = useCallback(async () => {
    if (!projectId || !input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    setMessages((prev) => [...prev, makeMessage({ role: 'editor', text })]);
    setBusy(true);
    try {
      const result = await reviewTurn(projectId, text);
      setMessages((prev) => [...prev, makeMessage({ role: 'agent', text: result.message, proposal: result.proposal })]);
    } catch {
      setMessages((prev) => [...prev, makeMessage({ role: 'agent', text: 'Sorry — I could not complete that turn.' })]);
    } finally {
      setBusy(false);
    }
  }, [projectId, input, busy]);

  const resolveProposal = useCallback(
    async (proposalId: string, accept: boolean) => {
      if (!projectId) return;
      try {
        if (accept) await acceptProposal(projectId, proposalId);
        else await rejectProposal(projectId, proposalId);
      } catch {
        /* surfaced by the disabled state below; keep the panel resilient */
      }
      setMessages((prev) =>
        prev.map((message) =>
          message.proposal?.proposal_id === proposalId
            ? { ...message, proposal: { ...message.proposal, status: accept ? 'accepted' : 'rejected' } }
            : message,
        ),
      );
    },
    [projectId],
  );

  if (!projectId) return null;

  return (
    <aside className="review-chat" aria-label="Review agent" data-testid="review-chat-panel">
      <div className="review-chat-head">
        <strong>Review agent</strong>
        <span className="draft-summary">proposes edits you accept or reject</span>
      </div>
      <div className="review-chat-log" data-testid="review-chat-log">
        {messages.map((message) => (
          <div key={message.id} className={`chat-msg chat-${message.role}`}>
            <p>{message.text}</p>
            {message.proposal ? (
              <ProposalCard proposal={message.proposal} onResolve={resolveProposal} />
            ) : null}
          </div>
        ))}
        {busy ? <p className="chat-busy">Thinking…</p> : null}
      </div>
      <form
        className="review-chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          value={input}
          placeholder="Ask the review agent…"
          onChange={(event) => setInput(event.target.value)}
          aria-label="Message the review agent"
        />
        <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}

function ProposalCard({
  proposal,
  onResolve,
}: {
  proposal: Proposal;
  onResolve: (proposalId: string, accept: boolean) => void;
}) {
  const pending = proposal.status === 'pending';
  return (
    <div className="proposal-card" data-testid="proposal-card">
      <ul className="proposal-summary">
        {proposal.summary.map((line, index) => (
          <li key={`${proposal.proposal_id}:${index}`}>{line}</li>
        ))}
      </ul>
      <p className="proposal-delta">
        Timeline items: {proposal.before_item_count} → {proposal.after_item_count}
      </p>
      {pending ? (
        <div className="proposal-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => onResolve(proposal.proposal_id, true)}
            data-testid="proposal-accept"
          >
            Accept
          </button>
          <button
            type="button"
            className="btn subtle"
            onClick={() => onResolve(proposal.proposal_id, false)}
            data-testid="proposal-reject"
          >
            Reject
          </button>
        </div>
      ) : (
        <p className={`proposal-status proposal-${proposal.status}`}>{proposal.status}</p>
      )}
    </div>
  );
}
