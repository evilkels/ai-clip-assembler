interface Props {
  label: string;
  value?: number;
}

function tierFor(value: number): 'green' | 'yellow' | 'red' {
  if (value >= 8) return 'green';
  if (value >= 5) return 'yellow';
  return 'red';
}

export function ScoreChip({ label, value }: Props) {
  if (typeof value !== 'number') {
    return (
      <span className="score-chip neutral" title={`${label}: unavailable`}>
        <span className="chip-label">{label}</span>
        <span className="chip-value">n/a</span>
      </span>
    );
  }
  return (
    <span className={`score-chip ${tierFor(value)}`} title={`${label}: ${value.toFixed(1)} / 10`}>
      <span className="chip-label">{label}</span>
      <span className="chip-value">{value.toFixed(1)}</span>
    </span>
  );
}
