import { expect, test, type Page } from '@playwright/test';
import type { ReviewModelAccountStatus } from '../src/shared/reviewModelAuth';

const READY_PI = { state: 'ready' as const, version: '0.80.10', detail: 'Pi is ready.' };

function status(
  state: ReviewModelAccountStatus['state'],
  detail: string,
  pi: ReviewModelAccountStatus['pi'] = READY_PI,
): ReviewModelAccountStatus {
  return { provider: 'openai-codex', state, detail, pi };
}

async function installDesktopBridge(
  page: Page,
  options: {
    initial: ReviewModelAccountStatus;
    signIn?: ReviewModelAccountStatus;
    cancel?: ReviewModelAccountStatus;
    deferSignIn?: boolean;
  },
) {
  await page.addInitScript((config) => {
    let current = config.initial;
    let completeSignIn: ((value: ReviewModelAccountStatus) => void) | undefined;
    const clients = [
      {
        id: 'claude_desktop' as const,
        name: 'Claude Desktop',
        configPath: '/tmp/claude/claude_desktop_config.json',
        installed: true,
        connected: false,
        needsRestart: false,
      },
      {
        id: 'codex' as const,
        name: 'Codex',
        configPath: '/tmp/codex/config.toml',
        installed: true,
        connected: true,
        needsRestart: true,
      },
    ];

    Object.assign(window, {
      __reviewModelTest: {
        completeSignIn() {
          const next = config.signIn ?? current;
          current = next;
          completeSignIn?.(next);
          completeSignIn = undefined;
        },
        setStatus(next: ReviewModelAccountStatus) {
          current = next;
        },
      },
      clipAssembler: {
        backendUrl: 'http://127.0.0.1:8000',
        platform: 'darwin',
        getReviewModelAccountStatus: async () => current,
        signInReviewModel: async () => {
          if (config.deferSignIn) {
            return new Promise<ReviewModelAccountStatus>((resolve) => {
              completeSignIn = resolve;
            });
          }
          current = config.signIn ?? current;
          return current;
        },
        cancelReviewModelSignIn: async () => {
          current = config.cancel ?? { ...current, state: 'cancelled', detail: 'Sign-in was cancelled.' };
          return current;
        },
        detectMcpClients: async () => clients,
        connectMcpClient: async (clientId: 'claude_desktop' | 'codex') => {
          const client = clients.find(({ id }) => id === clientId)!;
          return { ...client, connected: true, needsRestart: true, snippet: '[mcp server]' };
        },
      },
    });
  }, options);
}

async function openConnections(page: Page) {
  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Connections' }).click();
  await expect(page.getByRole('heading', { name: 'Review model account' })).toBeVisible();
}

function reviewModelAccount(page: Page) {
  return page.getByRole('heading', { name: 'Review model account' }).locator('..');
}

function diagnostics(reachable: boolean) {
  return {
    review_model: {
      binary: { configured: 'pi', resolved: '/usr/local/bin/pi', found: true },
      provider: 'openai-codex',
      model: 'gpt-5.4-mini',
      reachable,
      elapsed_sec: 0.2,
      detail: reachable ? 'OK' : 'No API key found for openai-codex',
    },
  };
}

test('cancels an in-flight sign-in and ignores its stale completion', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('disconnected', 'Sign in with ChatGPT to use the review model.'),
    signIn: status('connected', 'Connected to ChatGPT.'),
    cancel: status('cancelled', 'Sign-in was cancelled.'),
    deferSignIn: true,
  });
  await openConnections(page);

  await expect(page.getByText('Disconnected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByText('Waiting', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

  await page.evaluate(async () => {
    (window as Window & { __reviewModelTest: { completeSignIn(): void } }).__reviewModelTest.completeSignIn();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });

  await expect(reviewModelAccount(page).getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(reviewModelAccount(page).getByText('Connected', { exact: true })).toHaveCount(0);
});

test('shows waiting with a Cancel action and then cancelled', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('waiting', 'Waiting for OpenAI sign-in.'),
    cancel: status('cancelled', 'Sign-in was cancelled.'),
  });
  await openConnections(page);

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(reviewModelAccount(page).getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
});

test('reruns diagnostics after sign-in and shows connected', async ({ page }) => {
  let diagnosticRequests = 0;
  await page.route('**/diagnostics', async (route) => {
    diagnosticRequests += 1;
    await route.fulfill({ json: diagnostics(diagnosticRequests > 1) });
  });
  await installDesktopBridge(page, {
    initial: status('disconnected', 'Sign in with ChatGPT to use the review model.'),
    signIn: status('connected', 'Connected to ChatGPT.'),
    deferSignIn: true,
  });

  await page.goto('/#/import');
  await page.evaluate(async () => {
    await fetch('http://127.0.0.1:8000/diagnostics');
  });
  await expect.poll(() => diagnosticRequests).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Connections' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Waiting', { exact: true })).toBeVisible();
  expect(diagnosticRequests).toBe(1);

  await page.evaluate(() => {
    (window as Window & { __reviewModelTest: { completeSignIn(): void } }).__reviewModelTest.completeSignIn();
  });

  await expect.poll(() => diagnosticRequests).toBe(2);
  await expect(reviewModelAccount(page).getByText('Connected', { exact: true })).toBeVisible();
  await expect(page.getByText('Configured model is reachable.')).toBeVisible();
});

test('keeps the account connected and announces unreachable diagnostics', async ({ page }) => {
  await page.route('**/diagnostics', async (route) => {
    await route.fulfill({ json: diagnostics(false) });
  });
  await installDesktopBridge(page, {
    initial: status('disconnected', 'Sign in with ChatGPT to use the review model.'),
    signIn: status('connected', 'Connected to ChatGPT.'),
  });
  await openConnections(page);

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(reviewModelAccount(page).getByText('Connected', { exact: true })).toBeVisible();
  await expect(reviewModelAccount(page).getByRole('alert')).toContainText(
    'Account is connected, but the configured model is not reachable.',
  );
});

test('shows expired with Reconnect', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('expired', 'ChatGPT sign-in has expired. Sign in again.'),
  });
  await openConnections(page);

  await expect(page.getByText('Expired', { exact: true })).toBeVisible();
  await expect(reviewModelAccount(page).getByRole('button', { name: 'Reconnect', exact: true })).toBeEnabled();
});

test('shows a sanitized failed state', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('failed', 'OpenAI sign-in failed. Try again.'),
  });
  await openConnections(page);

  await expect(page.getByRole('alert')).toContainText('OpenAI sign-in failed. Try again.');
  await expect(reviewModelAccount(page).getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/access[_ -]?token|refresh[_ -]?token|auth\.openai\.com/i);
});

test('keeps Claude Desktop and Codex MCP connection controls', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('connected', 'Connected to ChatGPT.'),
  });
  await openConnections(page);

  await expect(page.getByRole('heading', { name: 'Connect your AI' })).toBeVisible();
  await expect(page.getByText('Claude Desktop', { exact: true })).toBeVisible();
  await expect(page.getByText('Codex', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(page.locator('.mcp-client-list').getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
});

test('explains missing and incompatible Pi installations', async ({ page }) => {
  const missing = status(
    'disconnected',
    'Sign in with ChatGPT to use the review model.',
    { state: 'missing', detail: 'Pi is not installed.' },
  );
  const incompatible = status(
    'disconnected',
    'Sign in with ChatGPT to use the review model.',
    { state: 'incompatible', version: '1.0.0', detail: 'Pi 0.73.1 or newer, but earlier than 1.0.0, is required.' },
  );
  await installDesktopBridge(page, { initial: missing });
  await openConnections(page);

  await expect(page.getByText('Pi is not installed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.evaluate((next) => {
    (window as Window & { __reviewModelTest: { setStatus(value: ReviewModelAccountStatus): void } }).__reviewModelTest.setStatus(next);
  }, incompatible);
  await page.getByRole('tab', { name: 'Connections' }).click();

  await expect(page.getByText(/earlier than 1\.0\.0/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
});
