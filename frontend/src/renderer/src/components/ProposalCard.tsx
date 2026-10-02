import { useState } from 'react';
import { type Proposal } from '../api/client';

const COLLAPSED_SUMMARY_LINES = 8;

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

type ProposalActionsProps = {
  proposal: Proposal;
  onResolve: (proposalId: string, accept: boolean) => void;
  /** A Script Run's Proposal reads Apply / Discard instead of Accept / Reject. */
  fromScript?: boolean;
  /** Apply hit a revision conflict: the Timeline changed since the Proposal was made. */
  stale?: boolean;
  onRunAgain?: () => void;
  undoable?: boolean;
  onUndo?: () => void;
  /** A request for this card is queued or in flight, or the chat is busy. */
  disabled?: boolean;
};

function ProposalActions({
  proposal,
  onResolve,
  fromScript = false,
  stale = false,
  onRunAgain,
  undoable = false,
  onUndo,
  disabled = false,
}: ProposalActionsProps) {
  const reject = (
    <button
      type="button"
      className="btn subtle"
      onClick={() => onResolve(proposal.proposal_id, false)}
      disabled={disabled}
      data-testid="proposal-reject"
    >
      {fromScript ? 'Discard' : 'Reject'}
    </button>
  );

  if (proposal.status !== 'pending') {
    return (
      <div className="proposal-actions">
        <p className={`proposal-status proposal-${proposal.status}`}>
          {proposal.status === 'superseded' ? 'Superseded by a newer run' : proposal.status}
        </p>
        {undoable && onUndo ? (
          <button type="button" className="btn subtle" onClick={onUndo} disabled={disabled}>
            Undo
          </button>
        ) : null}
      </div>
    );
  }
  if (stale) {
    return (
      <div className="proposal-actions">
        <p className="proposal-stale">
          {onRunAgain ? 'The Timeline changed since this run.' : 'The Timeline changed since this proposal.'}
        </p>
        {onRunAgain ? (
          <button type="button" className="btn primary" onClick={onRunAgain} disabled={disabled}>
            Run again
          </button>
        ) : (
          reject
        )}
      </div>
    );
  }
  return (
    <div className="proposal-actions">
      <button
        type="button"
        className="btn primary"
        onClick={() => onResolve(proposal.proposal_id, true)}
        disabled={disabled}
        data-testid="proposal-accept"
      >
        {fromScript ? 'Apply' : 'Accept'}
      </button>
      {reject}
    </div>
  );
}

export function ProposalCard(props: ProposalActionsProps) {
  const { proposal } = props;
  const [showAll, setShowAll] = useState(false);
  const hiddenCount = Math.max(0, proposal.summary.length - COLLAPSED_SUMMARY_LINES);
  const summary = showAll ? proposal.summary : proposal.summary.slice(0, COLLAPSED_SUMMARY_LINES);
  const { before_duration_sec: beforeDuration, after_duration_sec: afterDuration } = proposal;

  return (
    <div className="proposal-card" data-testid="proposal-card" data-proposal-id={proposal.proposal_id}>
      <ul className="proposal-summary">
        {summary.map((line, index) => (
          // Summary lines repeat (e.g. two identical trims), so the index is part of the key.
          <li key={`${index}:${line}`}>{line}</li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="proposal-more"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? 'Show fewer' : `Show ${hiddenCount} more`}
        </button>
      ) : null}
      <p className="proposal-delta">
        <span>
          Timeline items: {proposal.before_item_count} → {proposal.after_item_count}
        </span>
        {beforeDuration !== undefined && afterDuration !== undefined ? (
          <span>
            Duration: {formatSeconds(beforeDuration)} → {formatSeconds(afterDuration)}
          </span>
        ) : null}
      </p>
      <ProposalActions {...props} />
    </div>
  );
}
