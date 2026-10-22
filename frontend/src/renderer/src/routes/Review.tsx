import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReviewChatPanel } from '../components/ReviewChatPanel';
import { ResizeHandle } from '../components/ResizeHandle';
import { SourceClipsPanel } from '../components/SourceClipsPanel';
import { PreviewAudioControl } from '../components/PreviewAudioControl';
import { SegmentedControl } from '../components/SegmentedControl';
import { StatusSurface } from '../components/StatusSurface';
import { FinishAiScoring } from '../components/FinishAiScoring';
import { WorkflowHeader } from '../components/WorkflowHeader';
import { VersionGallery } from '../components/VersionGallery';
import { VersionApplyDialog } from '../components/VersionApplyDialog';
import { buildReviewClipRecords, type ReviewFilters } from '../lib/reviewView';
import { useReview } from '../state/ReviewContext';
import { usePanelWidth } from '../hooks/usePanelWidth';
import { useReviewConversation } from '../hooks/useReviewConversation';
import { buildVersionMembership } from '../state/versionState';
import type { ClipCandidate, FormatName } from '../types/clip';
import type { Version } from '../types/version';

const FORMAT_OPTIONS: Array<{ value: FormatName; label: string }> = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
];

export function ReviewPage() {
  const [versionToApply, setVersionToApply] = useState<Version | null>(null);
  const [refreshingVersions, setRefreshingVersions] = useState(false);
  const [switchingFormat, setSwitchingFormat] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const {
    acceptedOrder,
    applyTimelineOperation,
    clips,
    decisions,
    draftFormat,
    error,
    exclude,
    generationStats,
    harnessMetadata,
    include,
    loading,
    projectId,
    regenerateDraft,
    timelineSnapshot,
    uploadedVideos,
  } = useReview();
  const [minOverall, setMinOverall] = useState(0);
  const [minSmoothness, setMinSmoothness] = useState(0);
  const [decisionFilter, setDecisionFilter] = useState<ReviewFilters['decision']>('all');
  const anySourceHasAudio = uploadedVideos.some((video) => video.metadata?.has_audio === true);
  const conversation = useReviewConversation(projectId);
  const [chatWidth, resizeChat] = usePanelWidth('reviewChatWidth', 320, 240, 560);
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
  // The Review header count and the browser rows are the same list, so build
  // it once here and derive both from it during render.
  const reviewRecords = useMemo(
    () =>
      buildReviewClipRecords(clips, decisions, acceptedOrder, versionMembership, {
        minOverall,
        minSmoothness,
        decision: decisionFilter,
      }),
    [acceptedOrder, clips, decisions, decisionFilter, minOverall, minSmoothness, versionMembership],
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

  const fallbackVideos = useMemo(
    () => harnessMetadata?.per_video?.filter((video) => video.failure) ?? [],
    [harnessMetadata],
  );

  const selectFormat = useCallback(
    async (format: FormatName) => {
      setSwitchingFormat(true);
      setFormatError(null);
      try {
        await regenerateDraft({ format });
      } catch (reason: unknown) {
        setFormatError(reason instanceof Error ? reason.message : 'Unable to switch format');
      } finally {
        setSwitchingFormat(false);
      }
    },
    [regenerateDraft],
  );

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
      <WorkflowHeader
        title="Review"
        step="Step 02 / 04"
        description="Let the AI suggest a full cut, or pick clips yourself, then refine."
        meta={(
          <span className="review-header-count">
            <strong data-testid="review-header-count">{reviewRecords.length} / {clips.length}</strong>
            <span>shown</span>
          </span>
        )}
        actions={(
          <div className="controls">
            <PreviewAudioControl anySourceHasAudio={anySourceHasAudio} />
          </div>
        )}
      />

      <div
        className="review-shell-body"
        data-testid="review-three-zone-layout"
        style={{ gridTemplateColumns: `${chatWidth}px 1px minmax(0, 1fr)` }}
      >
        <aside className="review-spine" style={{ width: chatWidth }} data-testid="ask-ai-rail">
          <ReviewChatPanel key={projectId} conversation={conversation} />
        </aside>
        <ResizeHandle ariaLabel="Resize the Ask the AI panel" onResize={resizeChat} />
        <main className="review-main">
          <section className="version-zone" aria-label="Suggested cuts" data-testid="suggested-versions-zone">
            <div className="version-zone-head">
              <div>
                <strong>Suggested cuts</strong>
                <span className="version-zone-description">
                  Complete edits the AI assembles from your clips. Preview one, then apply.
                </span>
              </div>
              <SegmentedControl<FormatName>
                value={draftFormat ?? 'short'}
                options={FORMAT_OPTIONS.map((option) => ({
                  ...option,
                  disabled: switchingFormat || !projectId,
                }))}
                onChange={(format) => void selectFormat(format)}
                ariaLabel="Length format"
                className="format-switcher"
              />
            </div>
            {switchingFormat ? <span className="draft-summary">Rebuilding timeline…</span> : null}
            {formatError ? <span className="empty-state">{formatError}</span> : null}
            {versionSetIsStale ? (
              <div data-testid="version-stale-warning" data-tone="warning" role="status">
                <StatusSurface tone="warning" className="version-stale-banner">
                  <span>Your video or clip choices changed since these suggestions were made.</span>
                  <button
                    type="button"
                    className="btn subtle"
                    aria-label="Ask the AI to refresh suggestions"
                    onClick={() => {
                      setRefreshingVersions(true);
                      void conversation
                        .send('Refresh the three versions using my current Working Timeline and Source Clip decisions.')
                        .finally(() => setRefreshingVersions(false));
                    }}
                    disabled={conversation.busy}
                  >
                    <span className="refresh-suggestions-label">
                      {refreshingVersions ? 'Refreshing…' : 'Refresh suggestions'}
                    </span>
                  </button>
                </StatusSurface>
              </div>
            ) : null}
            {harnessMetadata?.failure ? (
              <output data-testid="harness-fallback-notice" className="harness-fallback-notice">
                <StatusSurface tone="warning" className="harness-fallback-banner">
                  <strong>AI scoring stopped</strong>
                  <p>{harnessMetadata.failure.message}</p>
                  {fallbackVideos.length > 0 ? (
                    <div>
                      <span className="harness-fallback-label">Affected Source Videos</span>
                      <ul>
                        {fallbackVideos.map((video) => (
                          <li key={video.file_id}>{video.file_name ?? video.file_id}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <FinishAiScoring clipsLeft={harnessMetadata.clips_left ?? 0} />
                </StatusSurface>
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
          <section data-testid="candidate-browser-zone" aria-label="Candidate Clips">
            <SourceClipsPanel
              clips={clips}
              totalCount={clips.length}
              projectId={projectId}
              clipsByFile={clipsByFile}
              generationStats={generationStats}
              loading={loading}
              error={error}
              minSmoothness={minSmoothness}
              onMinSmoothnessChange={setMinSmoothness}
              onInclude={include}
              onExclude={exclude}
              records={reviewRecords}
              minOverall={minOverall}
              onMinOverallChange={setMinOverall}
              decisionFilter={decisionFilter}
              onDecisionFilterChange={setDecisionFilter}
            />
          </section>
          <Link className="draft-summary" to="/import">
            Adjust clip settings
          </Link>
        </main>
      </div>
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
