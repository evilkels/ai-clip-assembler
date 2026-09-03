import { Navigate, Route, Routes } from 'react-router-dom';
import { ImportPage } from './routes/Import';
import { ReviewPage } from './routes/Review';
import { TimelinePage } from './routes/Timeline';
import { ExportPage } from './routes/Export';
import { PlaywriterQaPage } from './routes/PlaywriterQa';
import { AppShell } from './layouts/AppShell';
import { ReviewProvider } from './state/ReviewContext';
import { StepGateProvider } from './state/StepGateContext';
import { ThemeProvider } from './state/ThemeContext';

function Shell() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/import" replace />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/playwriter" element={<PlaywriterQaPage />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ReviewProvider>
        {/* Routes publish the actions that unblock their step; the shell's
            action bar renders whichever one the derived gate asks for. */}
        <StepGateProvider>
          <Shell />
        </StepGateProvider>
      </ReviewProvider>
    </ThemeProvider>
  );
}
