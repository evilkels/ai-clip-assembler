import { useCallback, useMemo, useState } from 'react';
import { ReviewChatPanel } from '../components/ReviewChatPanel';
import { SourceClipsPanel } from '../components/SourceClipsPanel';
import { VersionGallery } from '../components/VersionGallery';
import { WorkingTimelineStrip } from '../components/WorkingTimelineStrip';
import { VersionApplyDialog } from '../components/VersionApplyDialog';
import { useReview } from '../state/ReviewContext';
import { useReviewConversation } from '../hooks/useReviewConversation';
import { buildVersionMembership } from '../state/versionState';
import type { ClipCandidate } from '../types/clip';
import type { Version } from '../types/version';

function rankClips(clips: ClipCandidate[]): ClipCandidate[] {
  // The project targets a pre-ES2023 TS lib, so toSorted() does not compile;
  // spreading first keeps the prop immutable on the supported toolchain.
  // react-doctor-disable-next-line react-doctor/js-tosorted-immutable
  return [...clips].sort((a, b) => b.scores.overall - a.scores.overall);
}

export function ReviewPage() {
  const [versionToApply, setVersionToApply] = useState<Version | null>(null);
  const [refreshingVersions, setRefreshingVersions] = useState(false);
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
    smoothnessThreshold,
    setSmoothnessThreshold,
    timelineSnapshot,
  } = useReview();
  const conversation = useReviewConversation(projectId);

  const ranked = useMemo(() => rankClips(clips), [clips]);
  const filtered = useMemo(
    () => ranked.filter((clip) => clip.scores.smoothness >= smoothnessThreshold),
    [ranked, smoothnessThreshold],
  );
  const availableClipIds = useMemo(
    () => new Set(clips.map((clip) => clip.clip_id)),
    [clips],
  );
  const versionSetIsStale = Boolean(
    conversation.versionSet &&
      timelineSnapshot &&
      conversation.versionSet.based_on_review_context_fingerprint !==
        timelineSnapshot.review_context_fingerprint &&
      !conversation.versionSet.versions.some(
        (version) => version.sequence_fingerprint === timelineSnapshot.sequence_fingerprint,
      ),
  );
  const versionMembership = useMemo(
    () =>
      conversation.versionSet &&
      timelineSnapshot &&
      conversation.versionSet.based_on_review_context_fingerprint ===
        timelineSnapshot.review_context_fingerprint
        ? buildVersionMembership(conversation.versionSet)
        : new Map<string, string[]>(),
    [conversation.versionSet, timelineSnapshot],
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

  const applyVersion = useCallback(
    async (version: Version, expectedRevision: number) => {
      await applyTimelineOperation('replace_timeline', {
        items: version.items.map(
          ({ source_clip_id, start_sec, end_sec, speed, transform }) => ({
            source_clip_id,
            start_sec,
            end_sec,
            speed,
            transform,
          }),
        ),
      }, expectedRevision);
    },
    [applyTimelineOperation],
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
          <ReviewChatPanel key={projectId} conversation={conversation} />
        </aside>
        <main className="review-main">
          <section className="version-zone" aria-label="Proposed versions">
            <div className="version-zone-head">
              <div>
                <span className="review-zone-label">2 · Compare</span>
                <strong>Versions</strong>
              </div>
              <span className="draft-summary">
                {refreshingVersions ? 'Updating' : 'Preview complete proposed cuts'}
              </span>
            </div>
            <p className="review-pipeline-helper">
              Versions are snapshots. Source Clip edits change the Working Timeline, not these previews.
            </p>
            {versionSetIsStale ? (
              <output className="version-stale-banner">
                <span>Working Timeline or Source Clips changed since these Versions were created.</span>
                <button
                  type="button"
                  className="btn subtle"
                  onClick={() => {
                    setRefreshingVersions(true);
                    void conversation
                      .send('Refresh the three versions using my current Working Timeline and Source Clip decisions.')
                      .finally(() => setRefreshingVersions(false));
                  }}
                  disabled={conversation.busy}
                >
                  Ask agent to refresh versions
                </button>
              </output>
            ) : null}
            {loading ? (
              <div className="empty-state">Loading candidates…</div>
            ) : error ? (
              <div className="empty-state">{error}</div>
            ) : (
              <VersionGallery
                versionSet={conversation.versionSet}
                snapshot={timelineSnapshot}
                availableClipIds={availableClipIds}
                projectId={projectId}
                onApply={setVersionToApply}
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
            versionMembership={versionMembership}
            loading={loading}
            error={error}
            smoothnessThreshold={smoothnessThreshold}
            onInclude={include}
            onExclude={exclude}
          />
        </main>
      </div>
      <WorkingTimelineStrip />
      {versionToApply && timelineSnapshot ? (
        <VersionApplyDialog
          key={versionToApply.version_id}
          version={versionToApply}
          snapshot={timelineSnapshot}
          onApply={applyVersion}
          onClose={() => setVersionToApply(null)}
        />
      ) : null}
    </div>
  );
}
