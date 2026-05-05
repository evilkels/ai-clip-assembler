import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ImportPage } from './routes/Import';
import { ReviewPage } from './routes/Review';
import { ExportPage } from './routes/Export';
import { ReviewProvider, useReview } from './state/ReviewContext';
import { pingBackend } from './api/client';

function StatusBar() {
  const { acceptedCount, totalCount } = useReview();
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

  return (
    <div className="statusbar">
      <span>
        <span className={`status-dot ${online ? 'online' : 'offline'}`} />
        Backend {online ? `online${version ? ` · v${version}` : ''}` : 'offline (mock data)'}
      </span>
      <span style={{ marginLeft: 'auto' }}>
        {acceptedCount} accepted / {totalCount} candidates
      </span>
    </div>
  );
}

function Shell() {
  return (
    <div className="app">
      <header className="titlebar">
        <span className="titlebar-title">AI Clip Assembler</span>
        <nav className="titlebar-nav">
          <NavLink to="/import" className={({ isActive }) => (isActive ? 'active' : '')}>
            Import
          </NavLink>
          <NavLink to="/review" className={({ isActive }) => (isActive ? 'active' : '')}>
            Review
          </NavLink>
          <NavLink to="/export" className={({ isActive }) => (isActive ? 'active' : '')}>
            Export
          </NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/review" replace />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/export" element={<ExportPage />} />
        </Routes>
      </main>
      <StatusBar />
    </div>
  );
}

export default function App() {
  return (
    <ReviewProvider>
      <Shell />
    </ReviewProvider>
  );
}
