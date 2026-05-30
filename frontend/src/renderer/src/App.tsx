import { Navigate, Route, Routes } from 'react-router-dom';
import { ImportPage } from './routes/Import';
import { ReviewPage } from './routes/Review';
import { TimelinePage } from './routes/Timeline';
import { ExportPage } from './routes/Export';
import { AppShell } from './layouts/AppShell';
import { ReviewProvider } from './state/ReviewContext';

function Shell() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/import" replace />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/export" element={<ExportPage />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <ReviewProvider>
      <Shell />
    </ReviewProvider>
  );
}
