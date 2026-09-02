import type { CSSProperties } from 'react';

interface Props {
  label: string;
  value?: number;
}

function normalizedFill(value: number): string {
  return `${Math.max(0, Math.min(10, value)) * 10}%`;
}

function tierFor(value: number): 'green' | 'yellow' | 'red' {
  if (value >= 8) return 'green';
  if (value >= 5) return 'yellow';
  return 'red';
}

export function ScoreChip({ label, value }: Props) {
  if (typeof value !== 'number') {
    return (
      <span
        className="score-chip neutral"
        title={`${label}: unavailable`}
        aria-label={`${label}: unavailable`}
        data-score-label={label}
      >
        <span className="chip-label">{label}</span>
        <span className="chip-value">n/a</span>
      </span>
    );
  }
  const fill = normalizedFill(value);
  return (
    <span
      className={`score-chip ${tierFor(value)}`}
      title={`${label}: ${value.toFixed(1)} / 10`}
      aria-label={`${label}: ${value.toFixed(1)} / 10`}
      data-score-label={label}
      data-score-fill={fill}
      style={{ '--score-fill': fill } as CSSProperties}
    >
      <span className="chip-label">{label}</span>
      <span className="chip-value">{value.toFixed(1)}</span>
    </span>
  );
}
