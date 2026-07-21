import { useEffect, useRef, useState } from 'react';
import {
  cancelReviewModelSignIn,
  getDiagnostics,
  getReviewModelAccountStatus,
  signInReviewModel,
  type ReviewModelAccountStatus,
} from '../api/client';
import { REVIEW_MODEL_PROVIDER } from '../../../shared/reviewModelAuth';

const accountStateLabels: Record<ReviewModelAccountStatus['state'], string> = {
  connected: 'Connected',
  expired: 'Expired',
  disconnected: 'Disconnected',
  waiting: 'Waiting',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

type DiagnosticState = 'checking' | 'reachable' | 'unreachable';

function useReviewModelAccount() {
  const [account, setAccount] = useState<ReviewModelAccountStatus | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [diagnosticState, setDiagnosticState] = useState<DiagnosticState | null>(null);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  // A response is applied only while mounted and not superseded by a newer request.
  const isCurrent = (requestId: number) => mountedRef.current && requestId === requestIdRef.current;

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++requestIdRef.current;
    getReviewModelAccountStatus()
      .then((status) => {
        if (isCurrent(requestId)) setAccount(status);
      })
      .catch(() => {
        if (isCurrent(requestId)) {
          setAccount({
            provider: REVIEW_MODEL_PROVIDER,
            state: 'failed',
            detail: 'Review model account status could not be loaded.',
            pi: { state: 'incompatible', detail: 'Pi could not be inspected.' },
          });
        }
      });
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const runDiagnostics = async (requestId: number) => {
    if (!isCurrent(requestId)) return;
    setDiagnosticState('checking');
    try {
      const result = await getDiagnostics();
      if (isCurrent(requestId)) {
        setDiagnosticState(result.review_model.reachable ? 'reachable' : 'unreachable');
      }
    } catch {
      if (isCurrent(requestId)) setDiagnosticState('unreachable');
    }
  };

  const handleAccountAction = async () => {
    if (!account) return;
    const requestId = ++requestIdRef.current;
    setActionPending(true);
    setDiagnosticState(null);
    if (account.state !== 'waiting') {
      setAccount({ ...account, state: 'waiting', detail: 'Waiting for OpenAI sign-in.' });
      setActionPending(false);
    }

    try {
      const status = account.state === 'waiting'
        ? await cancelReviewModelSignIn()
        : await signInReviewModel();
      if (!isCurrent(requestId)) return;
      setAccount(status);
      setActionPending(false);
      if (status.state === 'connected') await runDiagnostics(requestId);
    } catch {
      if (!isCurrent(requestId)) return;
      setAccount({ ...account, state: 'failed', detail: 'OpenAI sign-in failed. Try again.' });
      setActionPending(false);
    }
  };

  return { account, actionPending, diagnosticState, handleAccountAction };
}

export function ReviewModelAccountSection() {
  const { account, actionPending, diagnosticState, handleAccountAction } = useReviewModelAccount();

  if (!account) {
    return (
      <section className="settings-group">
        <h3 className="settings-group-title">Review model account</h3>
        <p className="settings-muted" role="status" aria-live="polite">Checking account…</p>
      </section>
    );
  }

  const waiting = account.state === 'waiting';
  const actionLabel = waiting ? 'Cancel' : account.state === 'disconnected' ? 'Sign in' : 'Reconnect';
  const actionDisabled = actionPending || (!waiting && account.pi.state !== 'ready');

  return (
    <section className="settings-group">
      <h3 className="settings-group-title">Review model account</h3>
      <div className={`review-model-account state-${account.state}`}>
        <div className="review-model-account-main">
          <div>
            <span className={`diagnostics-badge ${account.state === 'connected' ? 'ok' : account.state === 'failed' ? 'fail' : ''}`}>
              {accountStateLabels[account.state]}
            </span>
            <p
              className={account.state === 'failed' ? 'settings-error' : 'settings-muted'}
              role={account.state === 'failed' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {account.detail}
            </p>
          </div>
          <button type="button" className="btn" onClick={handleAccountAction} disabled={actionDisabled}>
            {actionLabel}
          </button>
        </div>
        <p className="review-model-pi-detail">
          Pi{account.pi.version ? ` ${account.pi.version}` : ''}: {account.pi.detail}
        </p>
        {diagnosticState === 'checking' && <p className="settings-muted">Checking configured model…</p>}
        {diagnosticState === 'reachable' && <p className="settings-saved">Configured model is reachable.</p>}
        {diagnosticState === 'unreachable' && (
          <p className="settings-error" role="alert">
            Account is connected, but the configured model is not reachable.
          </p>
        )}
      </div>
    </section>
  );
}
