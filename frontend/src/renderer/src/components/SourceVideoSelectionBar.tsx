interface SourceVideoSelectionBarProps {
  selectedCount: number;
  totalCount: number;
  analyzing: boolean;
  regenerating?: boolean;
  canRegenerate: boolean;
  onAnalyze: () => void;
  onShowUnanalyzed?: () => void;
  onDeselectAll?: () => void;
}

export function SourceVideoSelectionBar({
  selectedCount,
  totalCount,
  analyzing,
  regenerating = false,
  canRegenerate,
  onAnalyze,
  onShowUnanalyzed,
  onDeselectAll,
}: SourceVideoSelectionBarProps) {
  const label = analyzing
    ? 'Analyzing…'
    : regenerating
      ? 'Regenerating clips…'
      : selectedCount === 0 && canRegenerate
        ? 'Regenerate clips'
        : selectedCount === 0
          ? 'Select videos to analyze'
          : selectedCount === totalCount
            ? `Analyze all ${selectedCount}`
            : `Analyze ${selectedCount} of ${totalCount}`;

  return (
    <div
      className="analysis-controls source-video-selection-bar"
      data-testid="source-video-selection-bar"
      data-selection-action-rail
      data-region="selection-action-rail"
    >
      <div className="source-video-selection-summary">
        <strong>{selectedCount} of {totalCount} selected</strong>
        <span>{selectedCount === totalCount ? 'All source videos will be analyzed.' : `${selectedCount} of ${totalCount} source videos selected.`}</span>
      </div>
      <div className="source-video-selection-actions">
        {onShowUnanalyzed ? (
          <button type="button" className="btn subtle" onClick={onShowUnanalyzed}>
            Unanalyzed only
          </button>
        ) : null}
        {onDeselectAll ? (
          <button type="button" className="btn subtle" onClick={onDeselectAll} disabled={selectedCount === 0}>
            Deselect all
          </button>
        ) : null}
        <button
          type="button"
          className="btn primary"
          onClick={onAnalyze}
          disabled={analyzing || regenerating || (selectedCount === 0 && !canRegenerate)}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
