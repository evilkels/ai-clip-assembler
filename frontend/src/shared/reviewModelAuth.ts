export const REVIEW_MODEL_PROVIDER = 'openai-codex' as const;

export type ReviewModelAccountState =
  | 'connected'
  | 'expired'
  | 'disconnected'
  | 'waiting'
  | 'cancelled'
  | 'failed';

export type PiInstallationState = 'ready' | 'missing' | 'incompatible';

export interface PiInstallationStatus {
  state: PiInstallationState;
  version?: string;
  detail: string;
}

export interface ReviewModelAccountStatus {
  provider: typeof REVIEW_MODEL_PROVIDER;
  state: ReviewModelAccountState;
  detail: string;
  expiresAt?: number;
  pi: PiInstallationStatus;
}
