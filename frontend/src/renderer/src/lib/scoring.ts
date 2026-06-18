/**
 * Shared scoring helpers — turn raw clip scores into a plain-language verdict.
 *
 * Tiers mirror the colour bands used by ScoreChip (>=8 green, >=5 yellow,
 * otherwise red) so the verdict badge and the per-metric chips agree.
 */

export type Verdict = 'strong' | 'usable' | 'weak';

export interface VerdictInfo {
  verdict: Verdict;
  label: string;
  tier: 'green' | 'yellow' | 'red';
  blurb: string;
}

export function verdictFor(overall: number): VerdictInfo {
  if (overall >= 8) {
    return {
      verdict: 'strong',
      label: 'Strong',
      tier: 'green',
      blurb: 'Stable, sharp and well-composed — a reliable keeper.',
    };
  }
  if (overall >= 5) {
    return {
      verdict: 'usable',
      label: 'Usable',
      tier: 'yellow',
      blurb: 'Decent overall, but one metric is weak — check the scores.',
    };
  }
  return {
    verdict: 'weak',
    label: 'Weak',
    tier: 'red',
    blurb: 'Low quality — likely shaky, soft or poorly exposed.',
  };
}
