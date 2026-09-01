import { useMemo, useState } from 'react';
import { buildVideoMediaUrl } from '../api/client';
import type { ClipCandidate, ClipDecision, ClipGenerationStats } from '../types/clip';
import { buildReviewClipRecords, type ReviewFilters, type ReviewViewMode } from '../lib/reviewView';
import { ClipCard } from './ClipCard';
import { ClipFilmstripItem } from './ClipFilmstripItem';
import { ClipListRow } from './ClipListRow';
import { ViewModeSwitcher } from './ViewModeSwitcher';

interface LookGroup {
  key: string;
  lead: ReturnType<typeof buildReviewClipRecords>[number];
  siblings: ReturnType<typeof buildReviewClipRecords>[number][];
}

interface SourceClipsPanelProps {
  clips: ClipCandidate[];
  totalCount: number;
  projectId: string | null;
  decisions: Record<string, ClipDecision>;
  acceptedOrder: string[];
  clipsByFile: Map<string, ClipCandidate[]>;
  versionMembership: Map<string, string[]>;
  generationStats: ClipGenerationStats | null;
  loading: boolean;
  error: string | null;
  smoothnessThreshold: number;
  onSmoothnessThresholdChange: (value: number) => void;
  onInclude: (clipId: string) => void;
  onExclude: (clipId: string) => void;
}

const VIEW_OPTIONS: Array<{ value: ReviewViewMode; label: string }> = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
  { value: 'filmstrip', label: 'Filmstrip' },
];

function groupByLook(records: ReturnType<typeof buildReviewClipRecords>): LookGroup[] {
  const membersByKey = new Map<string, ReturnType<typeof buildReviewClipRecords>[number][]>();
  const order: string[] = [];
  for (const record of records) {
    const key = record.clip.look_group != null
      ? `look-${record.clip.look_group}`
      : `solo-${record.clip.clip_id}`;
    const members = membersByKey.get(key);
    if (members) members.push(record);
    else {
      membersByKey.set(key, [record]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const members = membersByKey.get(key)!;
    return { key, lead: members[0], siblings: members.slice(1) };
  });
}

export function SourceClipsPanel({
  clips,
  totalCount,
  projectId,
  decisions,
  acceptedOrder,
  clipsByFile,
  versionMembership,
  generationStats,
  loading,
  error,
  smoothnessThreshold,
  onSmoothnessThresholdChange,
  onInclude,
  onExclude,
}: SourceClipsPanelProps) {
  const [viewMode, setViewMode] = useState<ReviewViewMode>('grid');
  const [minOverall, setMinOverall] = useState(0);
  const [decisionFilter, setDecisionFilter] = useState<ReviewFilters['decision']>('all');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const totals = generationStats?.totals;
  const records = useMemo(
    () => buildReviewClipRecords(
      clips,
      decisions,
      acceptedOrder,
      versionMembership,
      { minOverall, minSmoothness: smoothnessThreshold, decision: decisionFilter },
    ),
    [acceptedOrder, clips, decisions, decisionFilter, minOverall, smoothnessThreshold, versionMembership],
  );
  const groups = useMemo(() => groupByLook(records), [records]);
  // Candidate Clip positions are stable within each source file; compute the
  // ordering once so each rendered card only performs a lookup.
  const fileClipIndexes = useMemo(() => {
    const indexes = new Map<string, Map<string, number>>();
    for (const [fileId, fileSiblings] of clipsByFile) {
      const byStart = [...fileSiblings].sort((a, b) => a.start_sec - b.start_sec);
      indexes.set(fileId, new Map(byStart.map((candidate, index) => [candidate.clip_id, index + 1])));
    }
    return indexes;
  }, [clipsByFile]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderAction = (record: ReturnType<typeof buildReviewClipRecords>[number]) =>
    record.timelinePosition !== undefined
      ? () => onExclude(record.clip.clip_id)
      : () => onInclude(record.clip.clip_id);

  /** The other candidates cut from the same source file, as track ranges. */
  const fileSiblingRanges = (clip: ClipCandidate) =>
    (clipsByFile.get(clip.file_id) ?? [])
      .filter((candidate) => candidate.clip_id !== clip.clip_id)
      .map((candidate) => ({ start: candidate.start_sec, end: candidate.end_sec }));

  /** Sibling ranges plus this clip's 1-based position among its file's candidates. */
  const fileContext = (clip: ClipCandidate) => {
    const fileSiblings = clipsByFile.get(clip.file_id) ?? [];
    return {
      siblingRanges: fileSiblingRanges(clip),
      fileClipIndex: fileClipIndexes.get(clip.file_id)?.get(clip.clip_id) ?? 0,
      fileClipCount: fileSiblings.length,
    };
  };

  const renderGrid = () => (
    <div className="review-grid" data-review-grid>
      {groups.flatMap(({ key, lead, siblings: lookSiblings }) => {
        const renderClip = (record: ReturnType<typeof buildReviewClipRecords>[number], similarLookCount: number) => {
          const { siblingRanges, fileClipIndex, fileClipCount } = fileContext(record.clip);
          return (
            <ClipCard
              key={record.clip.clip_id}
              clip={record.clip}
              rank={record.rank}
              decision={record.decision}
              draftPosition={record.timelinePosition}
              versionLabels={record.versionLabels}
              siblingRanges={siblingRanges}
              fileClipIndex={fileClipIndex}
              fileClipCount={fileClipCount}
              similarLookCount={similarLookCount}
              similarLooksExpanded={expandedGroups.has(key)}
              onToggleSimilarLooks={() => toggleGroup(key)}
              mediaUrl={projectId ? buildVideoMediaUrl(projectId, record.clip.file_id) : undefined}
              onToggleInclude={renderAction(record)}
            />
          );
        };
        const visible = [renderClip(lead, lookSiblings.length)];
        if (lookSiblings.length > 0 && expandedGroups.has(key)) {
          visible.push(...lookSiblings.map((record) => renderClip(record, 0)));
        }
        return visible;
      })}
    </div>
  );

  const renderList = () => (
    <div className="review-list" data-review-list>
      {records.map((record) => {
        const { siblingRanges, fileClipIndex, fileClipCount } = fileContext(record.clip);
        return (
          <ClipListRow
            key={record.clip.clip_id}
            clip={record.clip}
            rank={record.rank}
            decision={record.decision}
            timelinePosition={record.timelinePosition}
            versionLabels={record.versionLabels}
            siblingRanges={siblingRanges}
            fileClipIndex={fileClipIndex}
            fileClipCount={fileClipCount}
            onToggleInclude={renderAction(record)}
          />
        );
      })}
    </div>
  );

  const renderFilmstrip = () => (
    <div className="review-filmstrip" data-review-filmstrip>
      {records.map((record) => {
        return (
          <ClipFilmstripItem
            key={record.clip.clip_id}
            clip={record.clip}
            rank={record.rank}
            decision={record.decision}
            timelinePosition={record.timelinePosition}
            versionLabels={record.versionLabels}
            siblingRanges={fileSiblingRanges(record.clip)}
            onToggleInclude={renderAction(record)}
          />
        );
      })}
    </div>
  );

  return (
    <details
      className="source-clips-panel"
      data-testid="source-clips-panel"
      data-open="true"
      open
    >
      <summary
        className="source-clips-head"
        onClick={(event) => event.preventDefault()}
      >
        <div className="source-clips-title">
          <h2>Your clips</h2>
          <span className="draft-summary">
            {totals
              ? `Generated ${totals.candidates_generated} → kept ${totals.candidates_kept} · scene cap on ${totals.scenes_at_cap}/${totals.scenes_total} scenes · video cap ${totals.max_candidates_per_video ?? '—'}`
              : `${records.length} shown · click to preview and pick clips`}
          </span>
        </div>
        <div className="source-clips-tools">
          <ViewModeSwitcher
            value={viewMode}
            options={VIEW_OPTIONS}
            onChange={setViewMode}
            ariaLabel="Candidate Clip view"
          />
          <span className="source-clips-sort">Sort <strong>Combined score</strong></span>
        </div>
      </summary>
      <div className="source-clips-content" data-review-browser data-view-mode={viewMode}>
          <div className="review-browser-toolbar">
            <label className="review-filter-control">
              Minimum Overall
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={minOverall}
                aria-label="Minimum Overall"
                onChange={(event) => setMinOverall(Number(event.target.value))}
              />
            </label>
            <label className="review-filter-control">
              Minimum Smoothness
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={smoothnessThreshold}
                aria-label="Minimum Smoothness"
                onChange={(event) => onSmoothnessThresholdChange(Number(event.target.value))}
              />
            </label>
            <label className="review-filter-control">
              Decision
              <select
                aria-label="Decision filter"
                value={decisionFilter}
                onChange={(event) => setDecisionFilter(event.target.value as ReviewFilters['decision'])}
              >
                <option value="all">All decisions</option>
                <option value="included">Included</option>
                <option value="excluded">Excluded</option>
                <option value="undecided">Undecided</option>
              </select>
            </label>
            <span className="draft-summary" data-review-count>
              {records.length} of {clips.length} shown
            </span>
          </div>
          <p className="review-pipeline-helper">
            Every usable clip found in your footage. Include clips in the working Timeline or remove
            them from it; the backend Timeline Document remains authoritative.
          </p>
          {totalCount > 0 ? (
            <div className="score-legend">
              <span className="score-legend-label">How clips are scored</span>
              <div className="score-legend-body">
                <p>Combined scores blend technical quality with visual interest. Strong clips score at least 8, usable clips score 5–8, and weak clips score below 5.</p>
              </div>
            </div>
          ) : null}
          {loading ? (
            <div className="empty-state">Loading candidates…</div>
          ) : error ? (
            <div className="empty-state">{error}</div>
          ) : records.length === 0 ? (
            <div className="empty-state">No clips match the current Review filters.</div>
          ) : viewMode === 'grid' ? renderGrid() : viewMode === 'list' ? renderList() : renderFilmstrip()}
      </div>
    </details>
  );
}
