import { useEffect, useState } from 'react';
import { pingBackend } from '../api/client';
import { useReview } from '../state/ReviewContext';

export function StatusBar() {
  const { acceptedCount, totalCount, analysisStatus, uploadedVideos } = useReview();
  const [online, setOnline] = useState(false);
  const [version, setVersion] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const status = await pingBackend();
      if (!alive) return;
      setOnline(status.online);
      setVersion(status.version);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  let statusText = 'Not connected';
  if (online) {
    if (analysisStatus.phase === 'analyzing') statusText = 'Analyzing footage…';
    else if (uploadedVideos.length > 0 && analysisStatus.phase === 'idle') statusText = 'Ready to analyze';
    else if (analysisStatus.phase === 'complete') statusText = 'Analysis complete';
    else statusText = 'Ready';
  }

  return (
    <footer className="statusbar" data-surface="status" data-tone={online ? 'success' : 'danger'}>
      <span title={online && version ? `Connected · v${version}` : undefined}>
        <span className={`status-dot ${online ? 'online' : 'offline'}`} />
        {statusText}
      </span>
      {totalCount > 0 && (
        <span>
          {acceptedCount} of {totalCount} clips kept
        </span>
      )}
    </footer>
  );
}
