import type { ReactNode } from 'react';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  renderLabel?: (option: SegmentedOption<T>) => ReactNode;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  renderLabel,
}: SegmentedControlProps<T>) {
  const classes = ['segmented-control', className].filter(Boolean).join(' ');
  return (
    <div className={classes} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          className={`segmented-control-option${option.value === value ? ' active' : ''}`}
          type="button"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {renderLabel ? renderLabel(option) : option.label}
        </button>
      ))}
    </div>
  );
}
