interface SourceVideoSelectionBarProps {
  selectedCount: number;
  totalCount: number;
  analyzing: boolean;
  regenerating?: boolean;
  canRegenerate: boolean;
  onAnalyze: () => void;
}

export function SourceVideoSelectionBar({
  selectedCount,
  totalCount,
  analyzing,
  regenerating = false,
  canRegenerate,
  onAnalyze,
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
    <div className="analysis-controls source-video-selection-bar" data-testid="source-video-selection-bar">
      <div className="source-video-selection-summary">
        <strong>{selectedCount} of {totalCount} selected</strong>
        <span>Selection stays with each source video while you filter or sort.</span>
      </div>
      <div className="source-video-selection-actions">
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
