import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptProposal,
  clearReviewSession,
  getReviewSession,
  rejectProposal,
  reviewKickoff,
  reviewTurn,
  runReviewScript,
  TimelineRevisionConflictError,
  type ReviewMessage,
  type ReviewSession,
} from '../api/client';
import { useReview } from '../state/ReviewContext';
import type { VersionSet } from '../types/version';

export type DeliveryState = 'sending' | 'persisted' | 'failed';
export type ReviewMessageView = ReviewMessage & {
  deliveryState: DeliveryState;
  /** The stale Proposal an unsent Run again replaces, so Retry still supersedes it. */
  rerunOfProposalId?: string;
};

export interface ReviewConversation {
  messages: ReviewMessageView[];
  versionSet: VersionSet | null;
  busy: boolean;
  runningScript: boolean;
  error: string | null;
  send: (text: string, existingMessageId?: string) => Promise<void>;
  runScript: (source: string, rerunOfProposalId?: string, existingMessageId?: string) => Promise<void>;
  resolveProposal: (proposalId: string, accept: boolean) => Promise<void>;
  /** Proposals whose Apply hit a revision conflict: the Timeline moved since they were made. */
  staleProposalIds: ReadonlySet<string>;
  /** The applied Proposal whose single undo step is still the latest edit. */
  undoableProposalId: string | null;
  undoProposal: () => Promise<void>;
  clearHistory: () => Promise<void>;
}

function latestVersionSet(messages: ReviewMessage[]): VersionSet | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const versionSet = messages[index].payload.version_set;
    if (versionSet) return versionSet;
  }
  return null;
}

function persistedMessages(messages: ReviewMessage[]): ReviewMessageView[] {
  return messages.map((message) => ({ ...message, deliveryState: 'persisted' }));
}

export function useReviewConversation(projectId: string | null): ReviewConversation {
  const { reconcileTimelineSnapshot, timelineSnapshot, undo } = useReview();
  const [messages, setMessages] = useState<ReviewMessageView[]>([]);
  const [versionSet, setVersionSet] = useState<VersionSet | null>(null);
  const [busy, setBusy] = useState(Boolean(projectId));
  const [runningScript, setRunningScript] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleProposalIds, setStaleProposalIds] = useState<ReadonlySet<string>>(() => new Set());
  const [applied, setApplied] = useState<{ proposalId: string; revision: number } | null>(null);
  const activeProject = useRef<string | null>(projectId);

  const applySession = useCallback((session: ReviewSession) => {
    const persisted = persistedMessages(session.messages);
    const persistedIds = new Set(persisted.map((message) => message.message_id));
    setMessages((current) => [
      ...persisted,
      ...current.filter(
        (message) => message.deliveryState !== 'persisted' && !persistedIds.has(message.message_id),
      ),
    ]);
    setVersionSet(latestVersionSet(session.messages));
  }, []);

  useEffect(() => {
    activeProject.current = projectId;
    setMessages([]);
    setVersionSet(null);
    setError(null);
    setStaleProposalIds(new Set());
    setApplied(null);
    if (!projectId) {
      setBusy(false);
      return;
    }
    let alive = true;
    setBusy(true);
    getReviewSession(projectId)
      .then((session) =>
        session.messages.length > 0
          ? session
          : reviewKickoff(projectId).then((result) => result.session),
      )
      .then((session) => {
        if (alive && activeProject.current === projectId) applySession(session);
      })
      .catch(() => {
        // The proactive opening turn is best-effort; sending remains available.
      })
      .finally(() => {
        if (alive && activeProject.current === projectId) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, applySession]);

  /**
   * Shared optimistic-delivery loop for messages and Scripts: show the Editor's
   * message as sending, call the backend with a stable client message id (so a
   * Retry is idempotent), then adopt the persisted session or mark it unsent.
   */
  const deliver = useCallback(
    async (
      optimistic: ReviewMessageView,
      request: (projectId: string) => Promise<{ session: ReviewSession }>,
      failure: string,
    ) => {
      if (!projectId) return;
      const messageId = optimistic.message_id;
      setMessages((current) => {
        const exists = current.some((message) => message.message_id === messageId);
        return exists
          ? current.map((message) =>
              message.message_id === messageId
                ? { ...message, deliveryState: 'sending' as const }
                : message,
            )
          : [...current, optimistic];
      });
      setError(null);
      setBusy(true);
      try {
        const result = await request(projectId);
        if (activeProject.current === projectId) applySession(result.session);
      } catch {
        if (activeProject.current === projectId) {
          setMessages((current) =>
            current.map((message) =>
              message.message_id === messageId
                ? { ...message, deliveryState: 'failed' as const }
                : message,
            ),
          );
          setError(failure);
        }
      } finally {
        if (activeProject.current === projectId) setBusy(false);
      }
    },
    [projectId, applySession],
  );

  const send = useCallback(
    async (text: string, existingMessageId?: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      const messageId = existingMessageId ?? crypto.randomUUID();
      await deliver(
        {
          message_id: messageId,
          role: 'editor',
          text: trimmed,
          created_at: new Date().toISOString(),
          reply_to_message_id: null,
          proposal: null,
          payload: {},
          deliveryState: 'sending',
        },
        (id) => reviewTurn(id, trimmed, messageId),
        'The review agent could not complete that turn.',
      );
    },
    [busy, deliver],
  );

  const runScript = useCallback(
    async (source: string, rerunOfProposalId?: string, existingMessageId?: string) => {
      if (!source.trim() || busy) return;
      const messageId = existingMessageId ?? crypto.randomUUID();
      const now = new Date().toISOString();
      setRunningScript(true);
      try {
        await deliver(
          {
            message_id: messageId,
            role: 'editor',
            text: '',
            created_at: now,
            reply_to_message_id: null,
            proposal: null,
            script: {
              source,
              author: 'editor',
              based_on_timeline_revision: timelineSnapshot?.document.revision ?? 0,
              ran_at: now,
            },
            payload: {},
            deliveryState: 'sending',
            rerunOfProposalId,
          },
          (id) => runReviewScript(id, source, messageId, rerunOfProposalId),
          'The script could not be run.',
        );
      } finally {
        setRunningScript(false);
      }
    },
    [busy, deliver, timelineSnapshot],
  );

  const resolveProposal = useCallback(
    async (proposalId: string, accept: boolean) => {
      if (!projectId) return;
      setError(null);
      try {
        if (accept) {
          const document = await acceptProposal(projectId, proposalId);
          if (activeProject.current === projectId) {
            setApplied({ proposalId, revision: document.revision });
          }
        } else {
          await rejectProposal(projectId, proposalId);
        }
        const session = await getReviewSession(projectId);
        if (activeProject.current === projectId) applySession(session);
      } catch (reason: unknown) {
        if (activeProject.current !== projectId) return;
        if (reason instanceof TimelineRevisionConflictError) {
          reconcileTimelineSnapshot(reason.detail.current_snapshot);
          setStaleProposalIds((current) => new Set(current).add(proposalId));
          return;
        }
        setError('The Working Timeline changed. Refresh before applying this proposal.');
      }
    },
    [projectId, applySession, reconcileTimelineSnapshot],
  );

  // An applied Proposal stays undoable from its card until any later edit
  // (revisions only advance, undo included) moves the Timeline past it.
  const currentRevision = timelineSnapshot?.document.revision;
  const undoableProposalId =
    applied && currentRevision !== undefined && currentRevision <= applied.revision
      ? applied.proposalId
      : null;

  const undoProposal = useCallback(async () => {
    setApplied(null);
    try {
      await undo();
    } catch {
      setError('Could not undo that change.');
    }
  }, [undo]);

  const clearHistory = useCallback(async () => {
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await clearReviewSession(projectId);
      if (activeProject.current !== projectId) return;
      setMessages([]);
      setVersionSet(null);
      // Re-kick a fresh opening turn so the new session isn't left empty.
      const result = await reviewKickoff(projectId);
      if (activeProject.current === projectId) applySession(result.session);
    } catch {
      if (activeProject.current === projectId) {
        setError('Could not start a new session.');
      }
    } finally {
      if (activeProject.current === projectId) setBusy(false);
    }
  }, [projectId, busy, applySession]);

  return {
    messages,
    versionSet,
    busy,
    runningScript,
    error,
    send,
    runScript,
    resolveProposal,
    staleProposalIds,
    undoableProposalId,
    undoProposal,
    clearHistory,
  };
}
