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

  let statusText = 'Offline';
  if (online) {
    if (analysisStatus.phase === 'analyzing') statusText = 'Analyzing';
    else if (uploadedVideos.length > 0 && analysisStatus.phase === 'idle') statusText = 'Ready to analyze';
    else if (analysisStatus.phase === 'complete') statusText = 'Analysis complete';
    else statusText = `Online · v${version ?? ''}`;
  }

  return (
    <footer className="statusbar">
      <span>
        <span className={`status-dot ${online ? 'online' : 'offline'}`} />
        Backend {statusText}
      </span>
      <span>ffmpeg ready</span>
      <span>pi ready</span>
      <span>
        {acceptedCount} accepted / {totalCount} candidates
      </span>
    </footer>
  );
}
