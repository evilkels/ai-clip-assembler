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

async function openPanel(page: Page, panel: string) {
  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: panel, exact: true }).click();
}

async function openAiAssistance(page: Page) {
  await openPanel(page, 'AI assistance');
  await expect(page.getByRole('heading', { name: 'Review model account' })).toBeVisible();
}

async function installScoringProject(page: Page, effectiveHarness: string | null = null) {
  await installDesktopBridge(page, {
    initial: status('connected', 'Connected to ChatGPT.'),
  });
  await page.addInitScript(({ folderPath }) => {
    Object.assign(window.clipAssembler, {
      getLastOpenedRecentProject: async () => ({
        folderPath,
        lastOpenedAt: '2026-09-03T10:00:00Z',
        name: 'Scoring Project',
      }),
      addRecentProject: async () => [],
    });
  }, { folderPath: '/projects/scoring' });

  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/projects/from-folder') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          project_id: 'scoring-project',
          project_folder: '/projects/scoring',
          project: {
            schema_version: 1,
            name: 'Scoring Project',
            created_at: '2026-09-03T10:00:00Z',
            harness: 'pi_agent',
            cloud_ai_consent: true,
            source_videos: [{ filename: 'drone.mp4', imported_at: '2026-09-03T10:00:00Z' }],
            settings_overrides: {},
          },
          videos: [
            {
              file_id: 'source-1',
              file_name: 'drone.mp4',
              status: 'ready',
              metadata: {
                file_id: 'source-1',
                file_name: 'drone.mp4',
                duration_sec: 24,
                fps: 30,
                resolution: [1920, 1080],
                codec: 'h264',
              },
            },
          ],
          selected_harness: 'pi_agent',
          effective_harness: effectiveHarness,
          generation_stats: null,
        }),
      });
      return;
    }
    if (url.pathname === '/harnesses') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ harnesses: [] }),
      });
      return;
    }
    if (url.pathname.endsWith('/clips')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ clips: [] }) });
      return;
    }
    if (url.pathname.endsWith('/timeline/document')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          document: { version: 1, revision: 0, items: [], profile: null, target_duration_sec: null, decisions: {} },
          sequence_fingerprint: '',
          review_context_fingerprint: '',
        }),
      });
      return;
    }
    if (url.pathname.endsWith('/selected-harness') && request.method() === 'PUT') {
      const body = request.postDataJSON() as { harness_id: string };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ project_id: 'scoring-project', selected_harness: body.harness_id }),
      });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
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
      guidance: reachable
        ? []
        : ['Open Settings > Connections and sign in to the review model account.'],
    },
  };
}

test('reaches all Settings panels and preserves the legacy Settings deep link', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('connected', 'Connected to ChatGPT.'),
  });
  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();

  for (const panel of ['AI assistance', 'Connections', 'Diagnostics']) {
    await page.getByRole('tab', { name: panel, exact: true }).click();
    await expect(page.getByRole('heading', { name: panel })).toBeVisible();
  }
});

test('cancels an in-flight sign-in and ignores its stale completion', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('disconnected', 'Sign in with ChatGPT to use the review model.'),
    signIn: status('connected', 'Connected to ChatGPT.'),
    cancel: status('cancelled', 'Sign-in was cancelled.'),
    deferSignIn: true,
  });
  await openAiAssistance(page);

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
  await openAiAssistance(page);

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
  await page.getByRole('tab', { name: 'AI assistance' }).click();
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
  await openAiAssistance(page);

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
  await openAiAssistance(page);

  await expect(page.getByText('Expired', { exact: true })).toBeVisible();
  await expect(reviewModelAccount(page).getByRole('button', { name: 'Reconnect', exact: true })).toBeEnabled();
});

test('shows a sanitized failed state', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('failed', 'OpenAI sign-in failed. Try again.'),
  });
  await openAiAssistance(page);

  await expect(page.getByRole('alert')).toContainText('OpenAI sign-in failed. Try again.');
  await expect(reviewModelAccount(page).getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/access[_ -]?token|refresh[_ -]?token|auth\.openai\.com/i);
});

test('renders persisted scoring cards and updates the Import harness control', async ({ page }) => {
  await installScoringProject(page);
  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'AI assistance', exact: true }).click();

  const scoringEngine = page.getByRole('radiogroup', { name: 'Scoring engine' });
  await expect(scoringEngine.getByRole('radio', { name: 'Pi Agent · cloud' })).toBeChecked();
  await expect(scoringEngine.getByRole('radio', { name: 'Rule-based · local' })).toBeVisible();
  await expect(scoringEngine.getByRole('radio', { name: 'Local model · Qwen 3-VL' })).toBeDisabled();
  await expect(page.getByTestId('effective-harness')).toHaveCount(0);

  const update = page.waitForRequest((request) =>
    request.method() === 'PUT' && request.url().endsWith('/projects/scoring-project/selected-harness'));
  // The radio itself is visually hidden behind the custom control, so click the
  // card's label the way a person does rather than forcing the input.
  await scoringEngine.locator('label').filter({ hasText: 'Rule-based · local' }).click();
  expect((await (await update).postDataJSON()).harness_id).toBe('manual');
  await expect(scoringEngine.getByRole('radio', { name: 'Rule-based · local' })).toBeChecked();

  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByLabel('Harness')).toHaveValue('manual');
});

test('shows the effective scoring result only when it differs from selection', async ({ page }) => {
  await installScoringProject(page, 'manual');
  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'AI assistance', exact: true }).click();

  await expect(page.getByTestId('effective-harness')).toHaveText(
    'Current clips scored by Rule-based · local (Pi Agent fell back)',
  );
});

test('keeps MCP connection controls out of the model account panel', async ({ page }) => {
  await installDesktopBridge(page, {
    initial: status('connected', 'Connected to ChatGPT.'),
  });
  await openPanel(page, 'Connections');

  await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review model account' })).toHaveCount(0);
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
  await openAiAssistance(page);

  await expect(page.getByText('Pi is not installed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();

  await page.getByRole('tab', { name: 'General' }).click();
  await page.evaluate((next) => {
    (window as Window & { __reviewModelTest: { setStatus(value: ReviewModelAccountStatus): void } }).__reviewModelTest.setStatus(next);
  }, incompatible);
  await page.getByRole('tab', { name: 'AI assistance' }).click();

  await expect(page.getByText(/earlier than 1\.0\.0/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
});

test('the Diagnostics tab spells out how to fix an unreachable model', async ({ page }) => {
  await page.route('**/diagnostics', async (route) => {
    await route.fulfill({
      json: {
        review_model: {
          binary: { configured: 'pi', resolved: null, found: false },
          provider: 'openai-codex',
          model: 'gpt-5.4-mini',
          reachable: false,
          elapsed_sec: null,
          detail: 'pi CLI not found on PATH (pi)',
          guidance: [
            'Confirm the CLI exists: run  which pi  in Terminal.',
            'Link it somewhere the app always looks: /opt/homebrew/bin/pi',
          ],
        },
      },
    });
  });
  await installDesktopBridge(page, {
    initial: status('connected', 'Connected to ChatGPT.'),
  });

  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Diagnostics' }).click();

  const failureCard = page.getByTestId('diagnostics-result');
  await expect(failureCard).toBeVisible();
  await expect(page.getByText('Not reachable', { exact: true })).toBeVisible();
  await expect(failureCard).toContainText('Check failed');
  await expect(failureCard).toContainText('pi CLI not found on PATH (pi)');
  const guidance = page.getByRole('heading', { name: 'How to fix this' }).locator('..');
  await expect(guidance.getByRole('listitem')).toHaveCount(2);
  await expect(guidance).toContainText('which pi');
  await expect(guidance).toContainText('/opt/homebrew/bin/pi');
});

test('the Diagnostics tab hides the fix-it steps once the model responds', async ({ page }) => {
  await page.route('**/diagnostics', async (route) => {
    await route.fulfill({ json: diagnostics(true) });
  });
  await installDesktopBridge(page, { initial: status('connected', 'Connected to ChatGPT.') });

  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Diagnostics' }).click();

  await expect(page.getByText('Reachable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How to fix this' })).toHaveCount(0);
});
