import { useReview } from '../state/ReviewContext';
import { ReviewModelAccountSection } from './ReviewModelAccountSection';
import { PiRoutingSettings } from './SettingsTabPanel';

export function AiAssistancePanel() {
  const { cloudAiConsent, projectName } = useReview();

  return (
    <div className="settings-panel ai-assistance-panel">
      <section className="settings-group">
        <h3 className="settings-group-title">Scoring engine</h3>
        <div className="settings-deferred" data-testid="scoring-engine-placeholder">
          <strong>Selected Harness controls</strong>
          <p>Scoring engine choices will appear here when project selection persistence is available.</p>
        </div>
      </section>

      <ReviewModelAccountSection />

      <section className="settings-group settings-consent-group">
        <div className="settings-section-heading">
          <h3 className="settings-group-title">Cloud consent by project</h3>
          <span>Granted once per project, revocable here.</span>
        </div>
        <div className="settings-consent-row">
          <span className={cloudAiConsent ? 'settings-consent-dot granted' : 'settings-consent-dot'} aria-hidden="true" />
          <span>{projectName ?? 'Current project'}</span>
          <span className="settings-consent-state">
            {cloudAiConsent ? 'allowed' : 'local only — will ask on first cloud run'}
          </span>
        </div>
      </section>

      <PiRoutingSettings />
    </div>
  );
}
