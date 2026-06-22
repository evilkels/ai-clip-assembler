import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceptProposal,
  getReviewSession,
  rejectProposal,
  reviewKickoff,
  reviewTurn,
  type ReviewMessage,
  type ReviewSession,
} from '../api/client';
import type { VersionSet } from '../types/version';

export type DeliveryState = 'sending' | 'persisted' | 'failed';
export type ReviewMessageView = ReviewMessage & { deliveryState: DeliveryState };

export interface ReviewConversation {
  messages: ReviewMessageView[];
  versionSet: VersionSet | null;
  busy: boolean;
  error: string | null;
  send: (text: string, existingMessageId?: string) => Promise<void>;
  resolveProposal: (proposalId: string, accept: boolean) => Promise<void>;
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
  const [messages, setMessages] = useState<ReviewMessageView[]>([]);
  const [versionSet, setVersionSet] = useState<VersionSet | null>(null);
  const [busy, setBusy] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
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

  const send = useCallback(
    async (text: string, existingMessageId?: string) => {
      const trimmed = text.trim();
      if (!projectId || !trimmed || busy) return;
      const messageId = existingMessageId ?? crypto.randomUUID();
      const optimistic: ReviewMessageView = {
        message_id: messageId,
        role: 'editor',
        text: trimmed,
        created_at: new Date().toISOString(),
        reply_to_message_id: null,
        proposal: null,
        payload: {},
        deliveryState: 'sending',
      };
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
        const result = await reviewTurn(projectId, trimmed, messageId);
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
          setError('The review agent could not complete that turn.');
        }
      } finally {
        if (activeProject.current === projectId) setBusy(false);
      }
    },
    [projectId, busy, applySession],
  );

  const resolveProposal = useCallback(
    async (proposalId: string, accept: boolean) => {
      if (!projectId) return;
      setError(null);
      try {
        if (accept) await acceptProposal(projectId, proposalId);
        else await rejectProposal(projectId, proposalId);
        const session = await getReviewSession(projectId);
        if (activeProject.current === projectId) applySession(session);
      } catch {
        if (activeProject.current === projectId) {
          setError('The Working Timeline changed. Refresh before applying this proposal.');
        }
      }
    },
    [projectId, applySession],
  );

  return { messages, versionSet, busy, error, send, resolveProposal };
}
