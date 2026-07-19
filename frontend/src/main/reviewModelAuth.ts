import { execFile as execFileCallback } from 'node:child_process';
import type { AuthInteraction, AuthPrompt, Credential } from '@earendil-works/pi-ai';
import {
  REVIEW_MODEL_PROVIDER,
  type PiInstallationStatus,
  type ReviewModelAccountStatus,
} from '../shared/reviewModelAuth.js';

export const SUPPORTED_PI_SDK_VERSION = '0.80.10';
export const MINIMUM_PI_CLI_VERSION = '0.73.1';
const MAXIMUM_PI_CLI_VERSION_EXCLUSIVE = '1.0.0';

const CANCELLED_DETAIL = 'Sign-in was cancelled.';
const BROWSER_DETAIL = 'The OpenAI sign-in page could not be opened.';
const STORAGE_DETAIL = 'Pi authentication storage could not be updated.';
const FAILED_DETAIL = 'OpenAI sign-in failed. Try again.';

type SafeFailure = 'browser' | 'storage';

class SafeAuthError extends Error {
  constructor(readonly category: SafeFailure) {
    super(category);
    this.name = 'SafeAuthError';
  }
}

export interface ReviewModelRuntime {
  login(providerId: string, type: 'oauth', interaction: AuthInteraction): Promise<Credential>;
}

export interface InspectPiOptions {
  piBin?: string;
  sdkVersion?: string;
  piSdkLoader?: PiSdkLoader;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

export interface PiSdkSurface {
  VERSION: string;
  ModelRuntime: {
    create(options: { allowModelNetwork: false }): Promise<ReviewModelRuntime>;
  };
  readStoredCredential(providerId: string): Credential | undefined;
}

export type PiSdkLoader = () => Promise<PiSdkSurface>;

export interface ReviewModelAuthControllerOptions {
  runtimeFactory?: () => Promise<ReviewModelRuntime>;
  credentialReader?: (providerId: typeof REVIEW_MODEL_PROVIDER) => Credential | undefined | Promise<Credential | undefined>;
  piSdkLoader?: PiSdkLoader;
  piInspector?: () => Promise<PiInstallationStatus>;
  openExternal?: (url: string) => Promise<void>;
  now?: () => number;
  logger?: Pick<Console, 'error'>;
}

interface SignInAttempt {
  abortController: AbortController;
  browserOpen?: Promise<void>;
  failure?: SafeFailure;
}

async function loadPiSdk(): Promise<PiSdkSurface> {
  return import('@earendil-works/pi-coding-agent');
}

async function createDefaultRuntime(loadSdk: PiSdkLoader): Promise<ReviewModelRuntime> {
  const { ModelRuntime } = await loadSdk();
  return ModelRuntime.create({ allowModelNetwork: false });
}

async function readDefaultCredential(loadSdk: PiSdkLoader): Promise<Credential | undefined> {
  const { readStoredCredential } = await loadSdk();
  return readStoredCredential(REVIEW_MODEL_PROVIDER);
}

function runPiVersion(file: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCallback(file, args, { timeout: 5_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseVersion(value: string): string | undefined {
  return value.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isMissingExecutable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT');
}

export function isAllowedOpenAiAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'auth.openai.com' &&
      (url.port === '' || url.port === '443') &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

export async function inspectPiInstallation(options: InspectPiOptions = {}): Promise<PiInstallationStatus> {
  const sdkVersion = options.sdkVersion ?? (await (options.piSdkLoader ?? loadPiSdk)()).VERSION;
  if (sdkVersion !== SUPPORTED_PI_SDK_VERSION) {
    return {
      state: 'incompatible',
      version: sdkVersion,
      detail: `The bundled Pi SDK must be version ${SUPPORTED_PI_SDK_VERSION}.`,
    };
  }

  try {
    const result = await (options.execFile ?? runPiVersion)(options.piBin ?? process.env.PI_BIN ?? 'pi', ['--version']);
    const version = parseVersion(`${result.stdout}\n${result.stderr}`);
    if (!version || compareVersions(version, MINIMUM_PI_CLI_VERSION) < 0) {
      return {
        state: 'incompatible',
        ...(version ? { version } : {}),
        detail: `Pi ${MINIMUM_PI_CLI_VERSION} or newer is required.`,
      };
    }
    if (compareVersions(version, MAXIMUM_PI_CLI_VERSION_EXCLUSIVE) >= 0) {
      return {
        state: 'incompatible',
        version,
        detail: `Pi ${MINIMUM_PI_CLI_VERSION} or newer, but earlier than ${MAXIMUM_PI_CLI_VERSION_EXCLUSIVE}, is required.`,
      };
    }
    return { state: 'ready', version, detail: 'Pi is ready.' };
  } catch (error) {
    if (isMissingExecutable(error)) return { state: 'missing', detail: 'Pi is not installed.' };
    return { state: 'incompatible', detail: 'Pi could not be inspected.' };
  }
}

async function defaultOpenExternal(url: string): Promise<void> {
  const { shell } = await import('electron');
  await shell.openExternal(url);
}

function promptCancelled(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Login cancelled'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('Login cancelled')), { once: true });
  });
}

function mapCredentialStatus(
  credential: Credential | undefined,
  pi: PiInstallationStatus,
  now: number,
): ReviewModelAccountStatus {
  if (credential?.type !== 'oauth') {
    return {
      provider: REVIEW_MODEL_PROVIDER,
      state: 'disconnected',
      detail: 'Sign in with ChatGPT to use the review model.',
      pi,
    };
  }

  const expiresAt = credential.expires;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return {
      provider: REVIEW_MODEL_PROVIDER,
      state: 'disconnected',
      detail: 'Sign in with ChatGPT to use the review model.',
      pi,
    };
  }
  const expired = expiresAt <= now;
  return {
    provider: REVIEW_MODEL_PROVIDER,
    state: expired ? 'expired' : 'connected',
    detail: expired ? 'ChatGPT sign-in has expired. Sign in again.' : 'Connected to ChatGPT.',
    expiresAt,
    pi,
  };
}

export class ReviewModelAuthController {
  private readonly runtimeFactory: () => Promise<ReviewModelRuntime>;
  private readonly credentialReader: (
    providerId: typeof REVIEW_MODEL_PROVIDER,
  ) => Credential | undefined | Promise<Credential | undefined>;
  private readonly piInspector: () => Promise<PiInstallationStatus>;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly now: () => number;
  private readonly logger: Pick<Console, 'error'>;
  private activeAttempt?: SignInAttempt;

  constructor(options: ReviewModelAuthControllerOptions = {}) {
    const piSdkLoader = options.piSdkLoader ?? loadPiSdk;
    this.runtimeFactory = options.runtimeFactory ?? (() => createDefaultRuntime(piSdkLoader));
    this.credentialReader = options.credentialReader ?? (() => readDefaultCredential(piSdkLoader));
    this.piInspector = options.piInspector ?? (() => inspectPiInstallation());
    this.openExternal = options.openExternal ?? defaultOpenExternal;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
  }

  private async getPiStatus(): Promise<PiInstallationStatus> {
    try {
      return await this.piInspector();
    } catch {
      return { state: 'incompatible', detail: 'Pi could not be inspected.' };
    }
  }

  private status(state: ReviewModelAccountStatus['state'], detail: string, pi: PiInstallationStatus): ReviewModelAccountStatus {
    return { provider: REVIEW_MODEL_PROVIDER, state, detail, pi };
  }

  async getStatus(): Promise<ReviewModelAccountStatus> {
    const pi = await this.getPiStatus();
    if (this.activeAttempt) return this.status('waiting', 'Waiting for OpenAI sign-in.', pi);
    try {
      const credential = await this.credentialReader(REVIEW_MODEL_PROVIDER);
      return mapCredentialStatus(credential, pi, this.now());
    } catch {
      this.logger.error('Review model authentication storage inspection failed.');
      return this.status('failed', STORAGE_DETAIL, pi);
    }
  }

  private prompt(prompt: AuthPrompt, attempt: SignInAttempt): Promise<string> {
    if (attempt.abortController.signal.aborted) return Promise.reject(new Error('Login cancelled'));
    if (prompt.type === 'select') {
      if (prompt.options.some((option) => option.id === 'browser')) return Promise.resolve('browser');
      return Promise.reject(new Error('Unsupported sign-in flow'));
    }
    if (prompt.type === 'manual_code') {
      const signals = [attempt.abortController.signal, prompt.signal].filter(
        (signal): signal is AbortSignal => signal !== undefined,
      );
      return Promise.race(signals.map(promptCancelled));
    }
    return Promise.reject(new Error('Unsupported sign-in flow'));
  }

  private notify(event: Parameters<AuthInteraction['notify']>[0], attempt: SignInAttempt): void {
    if (attempt.abortController.signal.aborted) return;
    if (event.type !== 'auth_url') return;
    if (!isAllowedOpenAiAuthUrl(event.url)) {
      attempt.failure = 'browser';
      attempt.abortController.abort();
      return;
    }
    try {
      attempt.browserOpen = Promise.resolve(this.openExternal(event.url)).catch(() => {
        attempt.failure = 'browser';
        attempt.abortController.abort();
      });
    } catch {
      attempt.failure = 'browser';
      attempt.abortController.abort();
    }
  }

  private failureStatus(error: unknown, attempt: SignInAttempt, pi: PiInstallationStatus): ReviewModelAccountStatus {
    if (attempt.failure === 'browser' || (error instanceof SafeAuthError && error.category === 'browser')) {
      return this.status('failed', BROWSER_DETAIL, pi);
    }
    if (attempt.failure === 'storage' || (error instanceof SafeAuthError && error.category === 'storage')) {
      return this.status('failed', STORAGE_DETAIL, pi);
    }
    const message = error instanceof Error ? error.message : '';
    if (attempt.abortController.signal.aborted || message === 'Login cancelled') {
      return this.status('cancelled', CANCELLED_DETAIL, pi);
    }
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'auth' &&
      /credential store|authentication storage/i.test(message)
    ) {
      return this.status('failed', STORAGE_DETAIL, pi);
    }
    this.logger.error('Review model sign-in failed.');
    return this.status('failed', FAILED_DETAIL, pi);
  }

  async signIn(): Promise<ReviewModelAccountStatus> {
    if (this.activeAttempt) {
      return this.status('waiting', 'A sign-in attempt is already in progress.', await this.getPiStatus());
    }
    const attempt: SignInAttempt = { abortController: new AbortController() };
    this.activeAttempt = attempt;
    const pi = await this.getPiStatus();
    try {
      if (attempt.abortController.signal.aborted) throw new Error('Login cancelled');
      if (pi.state !== 'ready') return this.status('failed', pi.detail, pi);
      const runtime = await this.runtimeFactory();
      if (attempt.abortController.signal.aborted) throw new Error('Login cancelled');
      const credential = await runtime.login(REVIEW_MODEL_PROVIDER, 'oauth', {
        signal: attempt.abortController.signal,
        prompt: (prompt) => this.prompt(prompt, attempt),
        notify: (event) => this.notify(event, attempt),
      });
      if (attempt.abortController.signal.aborted) throw new Error('Login cancelled');
      await attempt.browserOpen;
      if (attempt.abortController.signal.aborted) throw new Error('Login cancelled');
      if (attempt.failure) throw new SafeAuthError(attempt.failure);
      return mapCredentialStatus(credential, pi, this.now());
    } catch (error) {
      return this.failureStatus(error, attempt, pi);
    } finally {
      if (this.activeAttempt === attempt) this.activeAttempt = undefined;
    }
  }

  async cancel(): Promise<ReviewModelAccountStatus> {
    const attempt = this.activeAttempt;
    if (attempt) {
      this.activeAttempt = undefined;
      attempt.abortController.abort();
    }
    return this.status('cancelled', CANCELLED_DETAIL, await this.getPiStatus());
  }
}
