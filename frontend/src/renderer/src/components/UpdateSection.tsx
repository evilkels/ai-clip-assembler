import { useCallback, useEffect, useState } from 'react';
import { checkForAppUpdate, openAppReleasePage, type UpdateStatus } from '../api/client';

/**
 * Always-visible version and update state. The banner in the app shell only
 * appears when an update exists, which leaves no way to see the installed
 * version, confirm you are current, or re-check on demand — this is that place.
 */
export function UpdateSection() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const runCheck = useCallback(async (force: boolean) => {
    setChecking(true);
    setActionError(null);
    try {
      setStatus(await checkForAppUpdate(force));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void runCheck(false);
  }, [runCheck]);

  const openReleases = async () => {
    setActionError(null);
    const opened = await openAppReleasePage().catch(() => false);
    if (!opened) {
      setActionError('The release page could not be opened. Visit github.com/evilkels/ai-clip-assembler/releases.');
    }
  };

  let stateText = 'Checking for updates…';
  if (!checking && status) {
    if (status.state === 'update-available') stateText = `Version ${status.latestVersion} is available`;
    else if (status.state === 'up-to-date') stateText = 'Up to date';
    else if (status.state === 'dismissed') stateText = `Version ${status.latestVersion} is available (notice hidden)`;
    else stateText = `Latest release unknown — ${status.detail}`;
  }

  const updateWaiting = status?.state === 'update-available' || status?.state === 'dismissed';

  return (
    <section className="settings-group" data-testid="update-section">
      <h3 className="settings-group-title">Updates</h3>
      <p className="settings-hint">
        Updates are installed manually: the download is not signed yet, so macOS has to be told to
        trust it once. Use <code>scripts/app-wizard.sh update</code> to install one.
      </p>
      <div className="settings-row">
        <span className="settings-label">Installed version</span>
        <span className="settings-readonly" data-testid="update-current-version">
          {status?.currentVersion ?? '…'}
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-label">Status</span>
        <span
          className={updateWaiting ? 'settings-readonly update-status-available' : 'settings-readonly'}
          data-testid="update-state"
        >
          {stateText}
        </span>
      </div>
      {actionError && (
        <p className="settings-error" role="alert">
          {actionError}
        </p>
      )}
      <div className="settings-actions">
        <button
          type="button"
          className="btn"
          onClick={() => void runCheck(true)}
          disabled={checking}
          data-testid="update-check-now"
        >
          {checking ? 'Checking…' : 'Check now'}
        </button>
        <button
          type="button"
          className={updateWaiting ? 'btn primary' : 'btn'}
          onClick={() => void openReleases()}
          data-testid="update-open-releases"
        >
          {updateWaiting ? 'See what’s new' : 'View releases'}
        </button>
      </div>
    </section>
  );
}
