import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuthInteraction, Credential } from '@earendil-works/pi-ai';
import {
  ReviewModelAuthController,
  SUPPORTED_PI_SDK_VERSION,
  inspectPiInstallation,
  isAllowedOpenAiAuthUrl,
  type ReviewModelAuthControllerOptions,
  type ReviewModelRuntime,
} from '../../src/main/reviewModelAuth.js';
import type { PiInstallationStatus, ReviewModelAccountStatus } from '../../src/shared/reviewModelAuth.js';

const READY_PI: PiInstallationStatus = {
  state: 'ready',
  version: '0.80.10',
  detail: 'Pi is ready.',
};

const SECRET_CREDENTIAL: Credential = {
  type: 'oauth',
  access: 'fake-access-token',
  refresh: 'fake-refresh-token',
  expires: 2_000,
  accountId: 'fake-account-id',
};

const forbiddenKeys = new Set(['access', 'refresh', 'accountid', 'authorization', 'code', 'token']);

function scanForbiddenKeys(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => scanForbiddenKeys(item, `${path}[${index}]`));
  return Object.entries(value).flatMap(([key, child]) => {
    const normalized = key.toLowerCase();
    const found = forbiddenKeys.has(normalized) ? [`${path}.${key}`] : [];
    return [...found, ...scanForbiddenKeys(child, `${path}.${key}`)];
  });
}

function runtime(login?: (provider: string, type: 'oauth', interaction: AuthInteraction) => Promise<Credential>): ReviewModelRuntime {
  return {
    login: login ?? (async () => SECRET_CREDENTIAL),
  };
}

function controller(overrides: Partial<ReviewModelAuthControllerOptions> = {}): ReviewModelAuthController {
  return new ReviewModelAuthController({
    runtimeFactory: async () => runtime(),
    credentialReader: () => undefined,
    piInspector: async () => READY_PI,
    openExternal: async () => undefined,
    now: () => 1_000,
    logger: { error: () => undefined },
    ...overrides,
  });
}

test('reports disconnected without a stored openai-codex credential', async () => {
  const status = await controller().getStatus();

  assert.deepEqual(status, {
    provider: 'openai-codex',
    state: 'disconnected',
    detail: 'Sign in with ChatGPT to use the review model.',
    pi: READY_PI,
  });
});

test('reports connected for an unexpired oauth credential without returning secrets', async () => {
  const status = await controller({ credentialReader: () => SECRET_CREDENTIAL }).getStatus();

  assert.deepEqual(status, {
    provider: 'openai-codex',
    state: 'connected',
    detail: 'Connected to ChatGPT.',
    expiresAt: 2_000,
    pi: READY_PI,
  });
  assert.deepEqual(scanForbiddenKeys(status), []);
  assert.doesNotMatch(JSON.stringify(status), /fake-(?:access|refresh|account)/);
});

test('reports expired for an expired oauth credential without refreshing it', async () => {
  let runtimeCalls = 0;
  const status = await controller({
    credentialReader: () => ({ ...SECRET_CREDENTIAL, expires: 999 }),
    runtimeFactory: async () => {
      runtimeCalls += 1;
      return runtime();
    },
  }).getStatus();

  assert.equal(status.state, 'expired');
  assert.equal(status.expiresAt, 999);
  assert.equal(status.detail, 'ChatGPT sign-in has expired. Sign in again.');
  assert.equal(runtimeCalls, 0);
});

test('reports missing and incompatible Pi installations separately', async () => {
  const missing = await controller({
    piInspector: async () => ({ state: 'missing', detail: 'Pi is not installed.' }),
  }).getStatus();
  const incompatible = await controller({
    piInspector: async () => ({ state: 'incompatible', version: '0.72.0', detail: 'Pi must be updated.' }),
  }).getStatus();

  assert.equal(missing.pi.state, 'missing');
  assert.equal(incompatible.pi.state, 'incompatible');
  assert.equal(incompatible.pi.version, '0.72.0');
});

test('reports unexpected Pi inspection failures as incompatible, not missing', async () => {
  const status = await controller({
    piInspector: async () => {
      throw new Error('unexpected SDK loader failure with fake-token');
    },
  }).getStatus();

  assert.deepEqual(status.pi, {
    state: 'incompatible',
    detail: 'Pi could not be inspected.',
  });
  assert.doesNotMatch(JSON.stringify(status), /fake-token/);
});

test('uses the supported Pi 0.80.10 runtime contract', async () => {
  let interaction: AuthInteraction | undefined;
  let call: { provider: string; type: string } | undefined;
  let createOptions: unknown;
  const auth = controller({
    runtimeFactory: undefined,
    piSdkLoader: async () => ({
      VERSION: '0.80.10',
      ModelRuntime: {
        create: async (options) => {
          createOptions = options;
          return runtime(async (provider, type, value) => {
            call = { provider, type };
            interaction = value;
            return SECRET_CREDENTIAL;
          });
        },
      },
      readStoredCredential: () => undefined,
    }),
  });

  const status = await auth.signIn();

  assert.equal(SUPPORTED_PI_SDK_VERSION, '0.80.10');
  assert.deepEqual(createOptions, { allowModelNetwork: false });
  assert.deepEqual(call, { provider: 'openai-codex', type: 'oauth' });
  assert.ok(interaction?.signal instanceof AbortSignal);
  assert.equal(status.state, 'connected');
});

test('forces embedded Pi OAuth to loopback only for the login lifetime', async () => {
  const variable = 'PI_OAUTH_CALLBACK_HOST';
  const previous = process.env[variable];
  process.env[variable] = '0.0.0.0';
  let releaseLogin: (() => void) | undefined;
  let hostDuringLogin: string | undefined;

  try {
    const auth = controller({
      runtimeFactory: undefined,
      piSdkLoader: async () => ({
        VERSION: '0.80.10',
        ModelRuntime: {
          create: async () => runtime(async () => {
            hostDuringLogin = process.env[variable];
            await new Promise<void>((resolve) => {
              releaseLogin = resolve;
            });
            return SECRET_CREDENTIAL;
          }),
        },
        readStoredCredential: () => undefined,
      }),
    });

    const signIn = auth.signIn();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(hostDuringLogin, '127.0.0.1');
    assert.equal(process.env[variable], '127.0.0.1');

    releaseLogin?.();
    assert.equal((await signIn).state, 'connected');
    assert.equal(process.env[variable], '0.0.0.0');
  } finally {
    releaseLogin?.();
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  }
});

test('inspects SDK and CLI missing, old, and ready states without exposing command output', async () => {
  const incompatibleSdk = await inspectPiInstallation({
    sdkVersion: '0.80.9',
    execFile: async () => ({ stdout: '0.80.10', stderr: '' }),
  });
  const missingError = new Error('missing') as NodeJS.ErrnoException;
  missingError.code = 'ENOENT';
  const missing = await inspectPiInstallation({
    sdkVersion: '0.80.10',
    execFile: async () => {
      throw missingError;
    },
  });
  const old = await inspectPiInstallation({
    sdkVersion: '0.80.10',
    execFile: async () => ({ stdout: 'pi 0.72.9 fake-token', stderr: '' }),
  });
  const ready = await inspectPiInstallation({
    sdkVersion: '0.80.10',
    execFile: async () => ({ stdout: 'pi 0.80.10', stderr: '' }),
  });
  const latestCompatible = await inspectPiInstallation({
    sdkVersion: '0.80.10',
    execFile: async () => ({ stdout: 'pi 0.99.99', stderr: '' }),
  });
  const nextMajor = await inspectPiInstallation({
    sdkVersion: '0.80.10',
    execFile: async () => ({ stdout: 'pi 1.0.0', stderr: '' }),
  });

  assert.equal(incompatibleSdk.state, 'incompatible');
  assert.equal(missing.state, 'missing');
  assert.deepEqual(old, {
    state: 'incompatible',
    version: '0.72.9',
    detail: 'Pi 0.73.1 or newer is required.',
  });
  assert.deepEqual(ready, { state: 'ready', version: '0.80.10', detail: 'Pi is ready.' });
  assert.deepEqual(latestCompatible, { state: 'ready', version: '0.99.99', detail: 'Pi is ready.' });
  assert.deepEqual(nextMajor, {
    state: 'incompatible',
    version: '1.0.0',
    detail: 'Pi 0.73.1 or newer, but earlier than 1.0.0, is required.',
  });
  assert.doesNotMatch(JSON.stringify([incompatibleSdk, missing, old, ready, latestCompatible, nextMajor]), /fake-token/);
});

test('treats a malformed oauth expiry as disconnected', async () => {
  const malformed = { ...SECRET_CREDENTIAL, expires: 'future' } as unknown as Credential;

  const status = await controller({ credentialReader: () => malformed }).getStatus();

  assert.equal(status.state, 'disconnected');
  assert.equal(status.expiresAt, undefined);
});

test('selects browser OAuth and opens only auth.openai.com in Electron main', async () => {
  const opened: string[] = [];
  const auth = controller({
    openExternal: async (url) => {
      opened.push(url);
    },
    runtimeFactory: async () => runtime(async (_provider, _type, interaction) => {
      const choice = await interaction.prompt({
        type: 'select',
        message: 'Choose login method',
        options: [
          { id: 'browser', label: 'Browser' },
          { id: 'device_code', label: 'Device code' },
        ],
      });
      assert.equal(choice, 'browser');
      interaction.notify({ type: 'auth_url', url: 'https://auth.openai.com/oauth/authorize?state=fake-state' });
      return SECRET_CREDENTIAL;
    }),
  });

  const status = await auth.signIn();

  assert.equal(status.state, 'connected');
  assert.deepEqual(opened, ['https://auth.openai.com/oauth/authorize?state=fake-state']);
  assert.equal('url' in status, false);
});

test('rejects a non-HTTPS or non-OpenAI OAuth URL without opening it', async () => {
  assert.equal(isAllowedOpenAiAuthUrl('http://auth.openai.com/oauth/authorize'), false);
  assert.equal(isAllowedOpenAiAuthUrl('https://auth.openai.com.evil.example/oauth/authorize'), false);
  assert.equal(isAllowedOpenAiAuthUrl('not a url'), false);

  for (const url of ['http://auth.openai.com/oauth/authorize', 'https://evil.example/oauth/authorize']) {
    const opened: string[] = [];
    const status: ReviewModelAccountStatus = await controller({
      openExternal: async (value) => {
        opened.push(value);
      },
      runtimeFactory: async (): Promise<ReviewModelRuntime> => runtime(async (_provider, _type, interaction) => {
        interaction.notify({ type: 'auth_url', url });
        await new Promise((resolve) => setImmediate(resolve));
        return SECRET_CREDENTIAL;
      }),
    }).signIn();

    assert.equal(status.state, 'failed');
    assert.equal(status.detail, 'The OpenAI sign-in page could not be opened.');
    assert.deepEqual(opened, []);
  }
});

test('allows only one sign-in attempt at a time', async () => {
  let release: (() => void) | undefined;
  const auth = controller({
    runtimeFactory: async () => runtime(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return SECRET_CREDENTIAL;
    }),
  });

  const first = auth.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await auth.signIn();

  assert.equal(second.state, 'waiting');
  assert.equal(second.detail, 'A sign-in attempt is already in progress.');
  release?.();
  assert.equal((await first).state, 'connected');
});

test('cancels a waiting sign-in idempotently and permits a later retry', async () => {
  let attempts = 0;
  const auth = controller({
    runtimeFactory: async () => runtime(async (_provider, _type, interaction) => {
      attempts += 1;
      if (attempts > 1) return SECRET_CREDENTIAL;
      return new Promise<Credential>((_resolve, reject) => {
        interaction.signal?.addEventListener('abort', () => reject(new Error('Login cancelled')), { once: true });
      });
    }),
  });

  const pending = auth.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  const firstCancel = await auth.cancel();
  const secondCancel = await auth.cancel();

  assert.equal(firstCancel.state, 'cancelled');
  assert.equal(secondCancel.state, 'cancelled');
  assert.equal((await pending).state, 'cancelled');
  assert.equal((await auth.signIn()).state, 'connected');
  assert.equal(attempts, 2);
});

test('does not begin OAuth after cancellation while the runtime initializes', async () => {
  let releaseRuntime: ((value: ReviewModelRuntime) => void) | undefined;
  let loginCalls = 0;
  const auth = controller({
    runtimeFactory: () => new Promise<ReviewModelRuntime>((resolve) => {
      releaseRuntime = resolve;
    }),
  });

  const pending = auth.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  await auth.cancel();
  releaseRuntime?.(runtime(async () => {
    loginCalls += 1;
    return SECRET_CREDENTIAL;
  }));

  assert.equal((await pending).state, 'cancelled');
  assert.equal(loginCalls, 0);
});

test('does not begin OAuth after cancellation while Pi inspection is pending', async () => {
  let releaseInspection: ((value: PiInstallationStatus) => void) | undefined;
  let inspectionCalls = 0;
  let runtimeCalls = 0;
  const auth = controller({
    piInspector: () => {
      inspectionCalls += 1;
      if (inspectionCalls > 1) return Promise.resolve(READY_PI);
      return new Promise<PiInstallationStatus>((resolve) => {
        releaseInspection = resolve;
      });
    },
    runtimeFactory: async () => {
      runtimeCalls += 1;
      return runtime();
    },
  });

  const pending = auth.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  await auth.cancel();
  releaseInspection?.(READY_PI);

  assert.equal((await pending).state, 'cancelled');
  assert.equal(runtimeCalls, 0);
});

test('permits an immediate retry when cancelled preflight ignores abort', async () => {
  let releaseOldInspection: ((value: PiInstallationStatus) => void) | undefined;
  let inspectionCalls = 0;
  let loginCalls = 0;
  const auth = controller({
    piInspector: () => {
      inspectionCalls += 1;
      if (inspectionCalls > 1) return Promise.resolve(READY_PI);
      return new Promise<PiInstallationStatus>((resolve) => {
        releaseOldInspection = resolve;
      });
    },
    runtimeFactory: async () => runtime(async () => {
      loginCalls += 1;
      return SECRET_CREDENTIAL;
    }),
  });

  const staleAttempt = auth.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await auth.cancel()).state, 'cancelled');

  const retry = await auth.signIn();

  assert.equal(retry.state, 'connected');
  assert.equal(loginCalls, 1);
  releaseOldInspection?.(READY_PI);
  assert.equal((await staleAttempt).state, 'cancelled');
});

test('keeps a stale login result cancelled after a newer retry succeeds', async () => {
  let resolveStaleLogin: ((value: Credential) => void) | undefined;
  let loginCalls = 0;
  const auth = controller({
    runtimeFactory: async () => runtime(async () => {
      loginCalls += 1;
      if (loginCalls > 1) return SECRET_CREDENTIAL;
      return new Promise<Credential>((resolve) => {
        resolveStaleLogin = resolve;
      });
    }),
  });

  const staleAttempt = auth.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await auth.cancel()).state, 'cancelled');
  assert.equal((await auth.signIn()).state, 'connected');

  resolveStaleLogin?.(SECRET_CREDENTIAL);

  assert.equal((await staleAttempt).state, 'cancelled');
  assert.equal((await auth.signIn()).state, 'connected');
  assert.equal(loginCalls, 3);
});

test('maps upstream failures containing fake tokens to a stable safe message', async () => {
  const logged: unknown[][] = [];
  const status = await controller({
    logger: { error: (...args) => logged.push(args) },
    runtimeFactory: async () => runtime(async () => {
      throw new Error('access=fake-access-token refresh=fake-refresh-token accountId=fake-account-id');
    }),
  }).signIn();

  assert.equal(status.state, 'failed');
  assert.equal(status.detail, 'OpenAI sign-in failed. Try again.');
  assert.doesNotMatch(JSON.stringify(status), /fake-(?:access|refresh|account)/);
  assert.doesNotMatch(JSON.stringify(logged), /fake-(?:access|refresh|account)/);
});

test('never places credential-shaped keys in a returned status or logger call', async () => {
  const logged: unknown[][] = [];
  const statuses: ReviewModelAccountStatus[] = [];
  const auth = controller({
    credentialReader: () => SECRET_CREDENTIAL,
    logger: { error: (...args) => logged.push(args) },
    runtimeFactory: async () => runtime(async () => {
      const error = new Error('token=fake-access-token');
      Object.assign(error, { access: 'fake-access-token', refresh: 'fake-refresh-token' });
      throw error;
    }),
  });

  statuses.push(await auth.getStatus(), await auth.signIn(), await auth.cancel());

  assert.deepEqual(scanForbiddenKeys(statuses), []);
  assert.deepEqual(scanForbiddenKeys(logged), []);
  assert.doesNotMatch(JSON.stringify({ statuses, logged }), /fake-(?:access|refresh|account)/);
});
