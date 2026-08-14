import { SegmentedControl, type SegmentedControlProps } from './SegmentedControl';

export type ViewModeSwitcherProps<T extends string> = SegmentedControlProps<T>;

export function ViewModeSwitcher<T extends string>(props: ViewModeSwitcherProps<T>) {
  return <SegmentedControl {...props} className={['view-mode-switcher', props.className].filter(Boolean).join(' ')} />;
}
