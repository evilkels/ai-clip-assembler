import type { AnalysisNotice, AnalysisStatus, ClipGenerationStats } from '../types/clip';

/**
 * A workflow step's primary action is gated on the work the previous step
 * actually produced. Deriving that here keeps the rule in one testable place
 * and out of the shell, which only renders the result.
 *
 * Design reference `5a` in the app restyle handoff.
 */

/**
 * The action that unblocks a blocked step. The design moves the screen's one
 * solid accent onto this button, so a blocked action bar still carries exactly
 * one solid accent rather than a dead button and nothing else.
 *
 * These are owned by the route that holds their handler and reach the shell
 * through `StepGateContext`.
 */
export type GateUnblockId = 'open-folder' | 'analyze' | 'loosen-rules';

export interface StepGate {
  allowed: boolean;
  /**
   * Why the primary is blocked, shown beside it. The reason is always visible:
   * never a bare dead button, and never an alert after the click.
   */
  reason?: string;
  /** Route-owned action that unblocks the step. */
  unblock?: GateUnblockId;
  /** Unblock that is just a step back, which the shell can navigate itself. */
  unblockTo?: { to: string; label: string };
}

const ALLOWED: StepGate = { allowed: true };

export interface ImportGateInput {
  sourceCount: number;
  clipCount: number;
  phase: AnalysisStatus['phase'];
}

/**
 * Review needs at least one Candidate Clip. Analysis runs in the background, so
 * a single candidate is enough to move on while the rest are still being found.
 */
export function importGate({ sourceCount, clipCount, phase }: ImportGateInput): StepGate {
  if (sourceCount === 0) {
    return {
      allowed: false,
      reason: 'Open a folder or drop MP4/MOV files first.',
      unblock: 'open-folder',
    };
  }
  if (clipCount > 0) return ALLOWED;
  if (phase === 'analyzing') {
    return { allowed: false, reason: 'Waiting for the first clip candidate…' };
  }
  if (phase === 'complete') {
    // The rule-based harness keeps one honestly scored fallback per scene, so a
    // true zero indicts the thresholds rather than the footage.
    return {
      allowed: false,
      reason: 'No clip passed your rules.',
      unblock: 'loosen-rules',
    };
  }
  return {
    allowed: false,
    reason: 'Analyze at least one video — Review has nothing to show.',
    unblock: 'analyze',
  };
}

/**
 * Leaving Review needs an Accepted Clip. The action that unblocks it is on this
 * screen — every candidate card carries it — so the bar states the reason and
 * does not offer a button that would only navigate away from the fix.
 */
export function reviewGate(acceptedCount: number): StepGate {
  if (acceptedCount > 0) return ALLOWED;
  return {
    allowed: false,
    reason: 'Add at least one clip to the working timeline.',
  };
}

/**
 * Leaving Timeline needs a Timeline Item. Items come from accepting candidates,
 * which happens in Review, so here the unblock really is a step back.
 */
export function timelineGate(timelineItemCount: number): StepGate {
  if (timelineItemCount > 0) return ALLOWED;
  return {
    allowed: false,
    reason: 'The timeline is empty — accept a clip in Review first.',
    unblockTo: { to: '/review', label: 'Back to Review' },
  };
}

/**
 * The rule values that produced zero candidates, so the blocked bar can name
 * the thresholds the editor has to loosen rather than just asserting failure.
 */
export function thresholdSummary(stats: ClipGenerationStats | null): string | null {
  const preferences = stats?.preferences;
  if (!preferences) return null;
  const parts: string[] = [];
  if (typeof preferences.smoothness_threshold === 'number') {
    parts.push(`how steady ${preferences.smoothness_threshold.toFixed(1)}`);
  }
  if (typeof preferences.max_turn_rate_deg_per_sec === 'number') {
    parts.push(`max turn ${preferences.max_turn_rate_deg_per_sec}°/s`);
  }
  if (typeof preferences.min_clip_duration_sec === 'number') {
    parts.push(`scene min ${preferences.min_clip_duration_sec}s`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Warning notices ride along with an allowed gate and never block it: a harness
 * that degrades still produced a usable set of Candidate Clips.
 */
export function ridingWarning(notices: AnalysisNotice[] | undefined): AnalysisNotice | null {
  return notices?.find((notice) => notice.level === 'warning') ?? null;
}
