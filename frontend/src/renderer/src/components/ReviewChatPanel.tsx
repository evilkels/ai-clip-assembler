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
  getReviewSession,
  rejectProposal,
  reviewKickoff,
  reviewTurn,
  type Proposal,
  type ReviewMessage,
  type ReviewSession,
} from '../api/client';
import { useReview } from '../state/ReviewContext';
import type { Version } from '../types/version';

interface ReviewChatPanelProps {
  onVersionsChange?: (versions: Version[]) => void;
}

function latestVersions(messages: ReviewMessage[]): Version[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const versions = messages[index].payload.versions;
    if (Array.isArray(versions)) return versions as Version[];
  }
  return [];
}

export function ReviewChatPanel({ onVersionsChange }: ReviewChatPanelProps) {
  const { projectId } = useReview();
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const activeProject = useRef<string | null>(null);
  const applySession = useCallback(
    (session: ReviewSession) => {
      setMessages(session.messages);
      onVersionsChange?.(latestVersions(session.messages));
    },
    [onVersionsChange],
  );

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    activeProject.current = projectId;
    getReviewSession(projectId)
      .then((session) =>
        session.messages.length > 0 ? session : reviewKickoff(projectId).then((result) => result.session),
      )
      .then((session) => {
        if (alive && activeProject.current === projectId) applySession(session);
      })
      .catch(() => {
        /* opening turn is best-effort */
      })
      .finally(() => {
        if (alive && activeProject.current === projectId) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, applySession]);

  const send = useCallback(async () => {
    if (!projectId || !input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    setBusy(true);
    try {
      const result = await reviewTurn(projectId, text);
      if (activeProject.current === projectId) applySession(result.session);
    } catch {
      const session = await getReviewSession(projectId).catch(() => null);
      if (session && activeProject.current === projectId) applySession(session);
    } finally {
      if (activeProject.current === projectId) setBusy(false);
    }
  }, [projectId, input, busy, applySession]);

  const resolveProposal = useCallback(
    async (proposalId: string, accept: boolean) => {
      if (!projectId) return;
      try {
        if (accept) await acceptProposal(projectId, proposalId);
        else await rejectProposal(projectId, proposalId);
        const session = await getReviewSession(projectId);
        if (activeProject.current === projectId) applySession(session);
      } catch {
        /* surfaced by the disabled state below; keep the panel resilient */
      }
    },
    [projectId, applySession],
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
          <div
            key={message.message_id}
            className={`chat-msg chat-${message.role}`}
            data-message-id={message.message_id}
          >
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
