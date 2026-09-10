import { useReview } from '../state/ReviewContext';
import { ReviewModelAccountSection } from './ReviewModelAccountSection';
import { PiRoutingSettings } from './SettingsTabPanel';

const scoringEngines = [
  {
    id: 'manual',
    name: 'Rule-based · local',
    badge: 'DEFAULT',
    description:
      'vidstab and OpenCV motion, blur and exposure thresholds. No semantic understanding, and nothing leaves this Mac.',
    facts: ['seconds per video', 'free', 'works offline'],
    disabled: false,
  },
  {
    id: 'pi_agent',
    name: 'Pi Agent · cloud',
    badge: 'OPT-IN',
    description:
      'Sends up to 4 sampled frames per candidate clip through your own Pi login, and judges visual interest only. Smoothness stays local — vidstab remains authoritative.',
    facts: ['≈4s per clip', 'billed to your provider', 'needs network'],
    disabled: false,
  },
  {
    id: 'local_qwen',
    name: 'Local model · Qwen 3-VL',
    badge: 'POSTPONED',
    description:
      'Semantic scoring with no network, via Ollama or MLX. Disabled in this build — the endpoint is not selectable yet.',
    facts: [],
    disabled: true,
  },
] as const;

const scoringEngineNames = Object.fromEntries(
  scoringEngines.map((engine) => [engine.id, engine.name]),
) as Record<string, string>;

export function AiAssistancePanel() {
  const {
    cloudAiConsent,
    effectiveHarness,
    projectName,
    selectedHarness,
    setSelectedHarness,
  } = useReview();
  const effectiveLabel = effectiveHarness ? scoringEngineNames[effectiveHarness] ?? effectiveHarness : null;
  const selectedLabel = scoringEngineNames[selectedHarness] ?? selectedHarness;
  const selectedFallbackName = selectedLabel.replace(' · cloud', '');

  return (
    <div className="settings-panel ai-assistance-panel">
      <section className="settings-group">
        <h3 className="settings-group-title" id="scoring-engine-title">Scoring engine</h3>
        <div
          className="settings-harness-options"
          role="radiogroup"
          aria-labelledby="scoring-engine-title"
        >
          {scoringEngines.map((engine) => {
            const selected = selectedHarness === engine.id;
            return (
              <div
                key={engine.id}
                className={`settings-harness-card${selected ? ' selected' : ''}${engine.disabled ? ' disabled' : ''}`}
              >
                <label>
                  <input
                    type="radio"
                    name="scoring-engine"
                    value={engine.id}
                    aria-label={engine.name}
                    checked={selected}
                    disabled={engine.disabled}
                    onChange={() => setSelectedHarness(engine.id)}
                  />
                  <span className="settings-harness-radio" aria-hidden="true" />
                  <span className="settings-harness-card-content">
                    <span className="settings-harness-card-title">
                      <strong>{engine.name}</strong>
                      <span className="settings-harness-badge">{engine.badge}</span>
                      {engine.id === 'pi_agent' && (
                        <span className="settings-harness-consent">
                          {cloudAiConsent ? '● consent granted · 1 project' : '● consent not granted · asks on first cloud run'}
                        </span>
                      )}
                    </span>
                    <span className="settings-harness-description">{engine.description}</span>
                    {engine.facts.length > 0 && (
                      <span className="settings-harness-facts">
                        {engine.facts.map((fact) => <span key={fact}>{fact}</span>)}
                      </span>
                    )}
                  </span>
                </label>
                {engine.id === 'pi_agent' && <ReviewModelAccountSection embedded />}
              </div>
            );
          })}
        </div>
        {effectiveLabel && effectiveHarness !== selectedHarness && (
          <p className="settings-effective-harness" data-testid="effective-harness">
            Current clips scored by {effectiveLabel} ({selectedFallbackName} fell back)
          </p>
        )}
      </section>

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
