import { useCallback, useMemo, useState } from 'react';
import { ReviewChatPanel } from '../components/ReviewChatPanel';
import { SourceClipsPanel } from '../components/SourceClipsPanel';
import { VersionGallery } from '../components/VersionGallery';
import { WorkingTimelineStrip } from '../components/WorkingTimelineStrip';
import { useReview } from '../state/ReviewContext';
import { proposeVersions } from '../state/mockVersions';
import type { ClipCandidate } from '../types/clip';
import type { Version } from '../types/version';

function rankClips(clips: ClipCandidate[]): ClipCandidate[] {
  return [...clips].sort((a, b) => b.scores.overall - a.scores.overall);
}

export function ReviewPage() {
  const [agentVersions, setAgentVersions] = useState<Version[]>([]);
  const {
    acceptedOrder,
    applyTimelineOperation,
    clips,
    decisions,
    error,
    exclude,
    include,
    loading,
    projectId,
    resetDecision,
    smoothnessThreshold,
    setSmoothnessThreshold,
  } = useReview();

  const ranked = useMemo(() => rankClips(clips), [clips]);
  const filtered = useMemo(
    () => ranked.filter((clip) => clip.scores.smoothness >= smoothnessThreshold),
    [ranked, smoothnessThreshold],
  );
  const versions = useMemo(
    () => (agentVersions.length > 0 ? agentVersions : proposeVersions(filtered)),
    [agentVersions, filtered],
  );
  const draftPositions = useMemo(
    () => new Map(acceptedOrder.map((id, index) => [id, index + 1])),
    [acceptedOrder],
  );
  const clipsByFile = useMemo(() => {
    const result = new Map<string, ClipCandidate[]>();
    for (const clip of clips) {
      const siblings = result.get(clip.file_id) ?? [];
      siblings.push(clip);
      result.set(clip.file_id, siblings);
    }
    return result;
  }, [clips]);

  const adoptVersion = useCallback(
    (version: Version) => {
      if (
        acceptedOrder.length > 0 &&
        !window.confirm('Replace the current timeline with this version?')
      ) {
        return;
      }
      void applyTimelineOperation('replace_timeline', {
        items: version.items.map(
          ({ source_clip_id, start_sec, end_sec, speed, transform }) => ({
            source_clip_id,
            start_sec,
            end_sec,
            speed,
            transform,
          }),
        ),
      });
    },
    [acceptedOrder.length, applyTimelineOperation],
  );

  return (
    <div className="page review-shell">
      <div className="page-header">
        <div>
          <h1>Review</h1>
          <p>Compare complete cuts, then choose one as the working timeline.</p>
        </div>
        <div className="controls">
          <div className="control">
            <label htmlFor="smoothness">Smoothness ≥</label>
            <input
              id="smoothness"
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={smoothnessThreshold}
              onChange={(event) => setSmoothnessThreshold(Number(event.target.value))}
            />
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              value={smoothnessThreshold}
              aria-label="Smoothness threshold value"
              onChange={(event) => setSmoothnessThreshold(Number(event.target.value))}
            />
          </div>
          <span className="draft-summary">
            {filtered.length} / {ranked.length} pass threshold
          </span>
        </div>
      </div>

      <div className="review-shell-body">
        <aside className="review-spine">
          <ReviewChatPanel key={projectId} onVersionsChange={setAgentVersions} />
        </aside>
        <main className="review-main">
          <section className="version-zone" aria-label="Proposed versions">
            <div className="version-zone-head">
              <div>
                <span className="draft-kicker">Creative directions</span>
                <strong>Versions</strong>
              </div>
              <span className="draft-summary">play each cut, focus it, then use one</span>
            </div>
            {loading ? (
              <div className="empty-state">Loading candidates…</div>
            ) : error ? (
              <div className="empty-state">{error}</div>
            ) : (
              <VersionGallery
                versions={versions}
                projectId={projectId}
                onAdopt={adoptVersion}
              />
            )}
          </section>
          <SourceClipsPanel
            clips={filtered}
            totalCount={clips.length}
            projectId={projectId}
            decisions={decisions}
            draftPositions={draftPositions}
            clipsByFile={clipsByFile}
            loading={loading}
            error={error}
            smoothnessThreshold={smoothnessThreshold}
            onInclude={include}
            onExclude={exclude}
            onReset={resetDecision}
          />
        </main>
      </div>
      <WorkingTimelineStrip />
    </div>
  );
}
