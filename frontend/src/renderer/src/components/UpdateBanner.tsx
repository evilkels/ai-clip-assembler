import { useEffect, useState } from 'react';
import { checkForAppUpdate, dismissAppUpdate, openAppReleasePage } from '../api/client';
import type { UpdateStatus } from '../api/client';

/**
 * Notice that a newer release exists. The install itself stays manual — the
 * DMGs are unsigned, so the button opens the release page rather than pretending
 * an in-place upgrade happened.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    checkForAppUpdate()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => {
        // A failed check must never block the app.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (status?.state !== 'update-available') return null;

  const handleDismiss = async () => {
    const next = await dismissAppUpdate(status.latestVersion).catch(() => null);
    setStatus(next ?? { state: 'dismissed', currentVersion: status.currentVersion, latestVersion: status.latestVersion });
  };

  const handleOpen = async () => {
    setOpenError(null);
    const opened = await openAppReleasePage().catch(() => false);
    if (!opened) setOpenError('The release page could not be opened. Visit github.com/evilkels/ai-clip-assembler/releases.');
  };

  return (
    <output className="update-banner" data-testid="update-banner">
      <span className="update-banner-text">
        Version {status.latestVersion} is available — you have {status.currentVersion}.
        {openError ? <span className="update-banner-error"> {openError}</span> : null}
      </span>
      <span className="update-banner-actions">
        <button type="button" className="update-banner-primary" onClick={handleOpen} data-testid="update-banner-download">
          See what&apos;s new
        </button>
        <button type="button" className="update-banner-dismiss" onClick={handleDismiss} data-testid="update-banner-dismiss">
          Not now
        </button>
      </span>
    </output>
  );
}
