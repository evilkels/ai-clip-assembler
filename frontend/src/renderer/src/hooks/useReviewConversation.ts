import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
  /** Proposals with an Apply, Discard or Undo request queued or in flight. */
  pendingProposalIds: ReadonlySet<string>;
  /** The applied Proposal whose undo step is still exactly the latest edit. */
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

function toggled(ids: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
  const next = new Set(ids);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}

const SETTLED: Promise<unknown> = Promise.resolve();

export function useReviewConversation(projectId: string | null): ReviewConversation {
  const { reconcileTimelineSnapshot, timelineSnapshot, undo } = useReview();
  const [messages, setMessages] = useState<ReviewMessageView[]>([]);
  const [versionSet, setVersionSet] = useState<VersionSet | null>(null);
  const [busy, setBusy] = useState(Boolean(projectId));
  const [runningScript, setRunningScript] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleProposalIds, setStaleProposalIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingProposalIds, setPendingProposalIds] = useState<ReadonlySet<string>>(() => new Set());
  const [applied, setApplied] = useState<{ proposalId: string; revision: number } | null>(null);
  const [sessionProjectId, setSessionProjectId] = useState(projectId);
  const activeProject = useRef<string | null>(projectId);
  // Every conversation mutation runs after the previous one settles, so a
  // slower response can never apply an older session over a newer one.
  const mutations = useRef<Promise<unknown>>(SETTLED);

  const serialize = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = mutations.current.then(task);
    mutations.current = run.catch(() => undefined);
    return run;
  }, []);

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

  if (sessionProjectId !== projectId) {
    setSessionProjectId(projectId);
    setMessages([]);
    setVersionSet(null);
    setError(null);
    setStaleProposalIds(new Set());
    setPendingProposalIds(new Set());
    setApplied(null);
    setBusy(Boolean(projectId));
  }

  // Updated at commit, not in the passive fetch effect, so a response that lands
  // between the commit and its passive effects is already seen as stale.
  useLayoutEffect(() => {
    activeProject.current = projectId;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void serialize(() =>
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
        }),
    );
    return () => {
      alive = false;
    };
  }, [projectId, applySession, serialize]);

  /**
   * Shared optimistic-delivery loop for messages and Scripts: show the Editor's
   * message as sending, call the backend with a stable client message id (so a
   * Retry is idempotent), then adopt the persisted session or mark it unsent.
   */
  const deliver = useCallback(
    (
      optimistic: ReviewMessageView,
      request: (projectId: string) => Promise<{ session: ReviewSession }>,
      failure: string,
    ) =>
      serialize(async () => {
        // The Editor left this project while the message waited in the queue.
        if (!projectId || activeProject.current !== projectId) return;
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
      }),
    [projectId, applySession, serialize],
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

  /** Queue a request that acts on one Proposal, disabling its card actions until it settles. */
  const actOnProposal = useCallback(
    async (proposalId: string, task: (projectId: string) => Promise<void>) => {
      if (!projectId) return;
      setPendingProposalIds((current) => toggled(current, proposalId, true));
      try {
        await serialize(() => task(projectId));
      } finally {
        setPendingProposalIds((current) => toggled(current, proposalId, false));
      }
    },
    [projectId, serialize],
  );

  const resolveProposal = useCallback(
    (proposalId: string, accept: boolean) =>
      actOnProposal(proposalId, async (id) => {
        setError(null);
        try {
          if (accept) {
            const snapshot = await acceptProposal(id, proposalId);
            if (activeProject.current !== id) return;
            reconcileTimelineSnapshot(snapshot);
            setApplied({ proposalId, revision: snapshot.document.revision });
          } else {
            await rejectProposal(id, proposalId);
          }
          const session = await getReviewSession(id);
          if (activeProject.current === id) applySession(session);
        } catch (reason: unknown) {
          if (activeProject.current !== id) return;
          if (reason instanceof TimelineRevisionConflictError) {
            reconcileTimelineSnapshot(reason.detail.current_snapshot);
            setStaleProposalIds((current) => toggled(current, proposalId, true));
            return;
          }
          setError('The Working Timeline changed. Refresh before applying this proposal.');
        }
      }),
    [actOnProposal, applySession, reconcileTimelineSnapshot],
  );

  // A card's Undo is offered only while the Timeline is still exactly at the
  // revision its Apply produced; any later edit (or undo) advances it.
  const undoableProposalId =
    applied && timelineSnapshot?.document.revision === applied.revision ? applied.proposalId : null;

  const undoProposal = useCallback(async () => {
    if (!applied) return;
    await actOnProposal(applied.proposalId, async (id) => {
      try {
        await undo(applied.revision);
        if (activeProject.current !== id) return;
        setApplied(null);
      } catch (reason: unknown) {
        if (activeProject.current !== id) return;
        // A newer edit landed first: the backend refused, so this Undo is spent.
        if (reason instanceof TimelineRevisionConflictError) setApplied(null);
        else setError('Could not undo that change.');
      }
    });
  }, [applied, actOnProposal, undo]);

  const clearHistory = useCallback(async () => {
    if (!projectId || busy) return;
    setBusy(true);
    setError(null);
    await serialize(async () => {
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
    });
  }, [projectId, busy, applySession, serialize]);

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
    pendingProposalIds,
    undoableProposalId,
    undoProposal,
    clearHistory,
  };
}
