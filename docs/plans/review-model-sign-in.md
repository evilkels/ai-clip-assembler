# Review Model Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** DONE (2026-07-19) — automated verification is green; live OAuth and installed-package smoke tests remain manual QA.

**Verification:** 359 backend tests, 33 main-process tests, 8 focused Connections E2E tests, backend/frontend lint, typecheck, production build, packaging-contract checks, Pi 0.80.10 API/dependency checks, and the production dependency audit pass. The remaining manual matrix is documented in `docs/MANUAL_QA_GUIDE.md` because it requires a real Plus/Pro account, external-browser interaction, and installed macOS artifacts.

**Goal:** Let Editors authenticate the internal `pi_agent` review model with an OpenAI ChatGPT Plus/Pro subscription from Settings without exposing OAuth credentials outside Electron main.

**Architecture:** Pin Pi 0.80.10 and use its public `ModelRuntime` login surface, which delegates persistence and refresh to Pi's supported file-backed AuthStorage at `~/.pi/agent/auth.json`. A single-flight Electron-main controller owns browser OAuth, cancellation, status inspection, Pi CLI compatibility checks, and narrow token-free IPC. The renderer adds a distinct Review model account section to Connections and leaves the existing Claude Desktop/Codex MCP controls unchanged.

**Tech Stack:** Electron 42 main/preload, Node 24, TypeScript 5.7, React 19, `@earendil-works/pi-coding-agent` 0.80.10, `@earendil-works/pi-ai` 0.80.10, Node test runner, Playwright.

## Global Constraints

- Support only the `openai-codex` provider and ChatGPT Plus/Pro browser OAuth in this slice.
- Pin `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` to exact version `0.80.10`; do not deep-import Pi internals.
- Electron main owns OAuth and opens only an HTTPS `auth.openai.com` authorization URL in the external browser.
- Use `ModelRuntime.create({ allowModelNetwork: false })`; its supported internal AuthStorage must write and refresh `~/.pi/agent/auth.json`.
- Never expose access tokens, refresh tokens, authorization URLs/codes, account IDs, credential objects, raw auth-file contents, or raw upstream errors to React, IPC responses, logs, diagnostics, or app-managed settings.
- Preserve other providers in Pi's auth file and preserve its `0700` directory / `0600` file protections.
- Show `connected`, `expired`, `disconnected`, `waiting`, `cancelled`, and `failed` account states.
- Expose Sign in/Reconnect and Cancel actions; allow only one active login and make cancellation idempotent.
- Automatically rerun the existing review-model diagnostic after successful authentication.
- Keep Review model authentication separate from Claude Desktop/Codex “Connect your AI” MCP configuration and preserve those controls.
- Report Pi CLI readiness separately as `ready`, `missing`, or `incompatible`; compatible versions are `>=0.73.1 <1.0.0`.
- Authentication never grants or changes per-project cloud-AI consent required by ADR 0001.
- Main-process and renderer changes follow strict test-first red/green cycles.

---

## File Structure

- Create `frontend/src/shared/reviewModelAuth.ts`: token-free IPC DTOs and state unions shared by main, preload, and renderer.
- Create `frontend/src/main/reviewModelAuth.ts`: Pi compatibility inspection, strict OAuth URL validation, single-flight login controller, cancellation, and sanitized status mapping.
- Create `frontend/tests/main/reviewModelAuth.test.ts`: focused main-process controller, compatibility, cancellation, sanitization, and URL tests.
- Modify `frontend/src/main/index.ts`: construct the controller, register narrow IPC handlers, reuse Pi binary resolution, and cancel authentication during shutdown.
- Modify `frontend/src/preload/index.ts`: expose only status, sign-in, and cancel methods.
- Modify `frontend/src/renderer/src/api/client.ts`: shared bridge typing and desktop-only auth wrappers.
- Modify `frontend/src/renderer/src/components/SettingsModal.tsx`: visible Connections tab, Review model account state machine, diagnostic rerun, and unchanged MCP section.
- Modify `frontend/src/renderer/src/styles.css`: account status/action layout using existing Settings tokens.
- Create `frontend/e2e/settings-connections.spec.ts`: renderer coverage for every state, cancellation, diagnostics rerun, and MCP regression.
- Modify `frontend/package.json` and `frontend/package-lock.json`: exact Pi production dependencies.
- Modify `frontend/scripts/verify-packaged-backend.mjs`: assert the packaged main dependency/API closure is present.
- Modify `docs/DEVELOPER_SETUP.md`, `docs/TROUBLESHOOTING.md`, `docs/USER_GUIDE.md`, and `docs/MANUAL_QA_GUIDE.md`: setup, state meanings, troubleshooting, and manual OAuth QA.
- Modify `docs/HARNESS_SPEC.md` and `docs/ARCHITECTURE.md`: record the internal-auth boundary and distinguish it from MCP.
- Modify `docs/plans/README.md`: index this plan.

## Task 1: Secure Pi OAuth Controller And Main-Process Tests

**Files:**
- Create: `frontend/src/shared/reviewModelAuth.ts`
- Create: `frontend/src/main/reviewModelAuth.ts`
- Create: `frontend/tests/main/reviewModelAuth.test.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`

**Interfaces:**
- Produces `ReviewModelAccountState = 'connected' | 'expired' | 'disconnected' | 'waiting' | 'cancelled' | 'failed'`.
- Produces `PiInstallationState = 'ready' | 'missing' | 'incompatible'`.
- Produces `ReviewModelAccountStatus` containing provider, account state, safe detail, and Pi installation state/version only.
- Produces `ReviewModelAuthController.getStatus()`, `.signIn()`, and `.cancel()`.
- Uses only Pi root exports: `ModelRuntime`, `VERSION`, and `readStoredCredential`.

- [ ] **Step 1: Add exact Pi dependencies**

Run:

```bash
cd frontend
npm install --save-exact @earendil-works/pi-coding-agent@0.80.10 @earendil-works/pi-ai@0.80.10
```

Confirm both packages appear under `dependencies` with the literal version `0.80.10` and the lockfile resolves one 0.80.10 line for each package.

- [ ] **Step 2: Write failing controller tests**

Create `frontend/tests/main/reviewModelAuth.test.ts` with injected fake runtime, credential reader, Pi inspector, browser opener, clock, and logger. Cover these exact behaviors:

```ts
test('reports disconnected without a stored openai-codex credential', async () => {});
test('reports connected for an unexpired oauth credential without returning secrets', async () => {});
test('reports expired for an expired oauth credential without refreshing it', async () => {});
test('reports missing and incompatible Pi installations separately', async () => {});
test('uses the supported Pi 0.80.10 runtime contract', async () => {});
test('selects browser OAuth and opens only auth.openai.com in Electron main', async () => {});
test('rejects a non-HTTPS or non-OpenAI OAuth URL without opening it', async () => {});
test('allows only one sign-in attempt at a time', async () => {});
test('cancels a waiting sign-in idempotently and permits a later retry', async () => {});
test('maps upstream failures containing fake tokens to a stable safe message', async () => {});
test('never places credential-shaped keys in a returned status or logger call', async () => {});
```

Use recursive key scanning for `access`, `refresh`, `accountId`, `authorization`, `code`, and `token`, and assert fake secrets do not appear in serialized DTOs or captured log arguments.

- [ ] **Step 3: Verify the tests fail for the missing feature**

Run:

```bash
cd frontend
npm run test:main
```

Expected: TypeScript compilation fails because `src/main/reviewModelAuth.ts` and `src/shared/reviewModelAuth.ts` do not exist.

- [ ] **Step 4: Add the shared token-free contract**

Create `frontend/src/shared/reviewModelAuth.ts` with these public shapes:

```ts
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
```

Do not add credential, account, URL, or code fields.

- [ ] **Step 5: Implement the controller minimally**

Create `frontend/src/main/reviewModelAuth.ts` with dependency injection and these exports:

```ts
export const SUPPORTED_PI_SDK_VERSION = '0.80.10';
export const MINIMUM_PI_CLI_VERSION = '0.73.1';
export function isAllowedOpenAiAuthUrl(value: string): boolean;
export async function inspectPiInstallation(options?: InspectPiOptions): Promise<PiInstallationStatus>;
export class ReviewModelAuthController {
  getStatus(): Promise<ReviewModelAccountStatus>;
  signIn(): Promise<ReviewModelAccountStatus>;
  cancel(): Promise<ReviewModelAccountStatus>;
}
```

The default runtime factory must call `ModelRuntime.create({ allowModelNetwork: false })`. `signIn()` must call `runtime.login('openai-codex', 'oauth', interaction)`, auto-answer only the `select` prompt with `browser`, keep `manual_code` pending until its signal aborts, and reject other prompts with a stable unsupported-flow error. `notify(auth_url)` must validate and open the URL in main without logging or returning it. Store only an `AbortController` and safe state for the active attempt. Convert every caught upstream exception to one of these details: `Sign-in was cancelled.`, `The OpenAI sign-in page could not be opened.`, `Pi authentication storage could not be updated.`, or `OpenAI sign-in failed. Try again.`

Status inspection may read the credential only inside main, copy only `expires`, and immediately discard the object. It must not call `getAuth()` or otherwise refresh during a read-only status check.

- [ ] **Step 6: Verify green and run the package API contract**

Run:

```bash
cd frontend
npm run test:main
node --input-type=module -e '
  const m = await import("@earendil-works/pi-coding-agent");
  if (m.VERSION !== "0.80.10" || typeof m.ModelRuntime !== "function" || typeof m.readStoredCredential !== "function") process.exit(1);
'
npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai
```

Expected: main-process tests pass, API contract exits 0, and both direct packages resolve to 0.80.10.

## Task 2: IPC, Connections UI, Diagnostics Rerun, And E2E

**Files:**
- Modify: `frontend/src/main/index.ts`
- Modify: `frontend/src/preload/index.ts`
- Modify: `frontend/src/renderer/src/api/client.ts`
- Modify: `frontend/src/renderer/src/components/SettingsModal.tsx`
- Modify: `frontend/src/renderer/src/styles.css`
- Create: `frontend/e2e/settings-connections.spec.ts`

**Interfaces:**
- Consumes `ReviewModelAuthController` and `ReviewModelAccountStatus` from Task 1.
- Produces IPC channels `review-model-auth:status`, `review-model-auth:sign-in`, and `review-model-auth:cancel`.
- Produces preload methods `getReviewModelAccountStatus()`, `signInReviewModel()`, and `cancelReviewModelSignIn()`.
- Produces renderer wrappers with the same names.

- [ ] **Step 1: Write failing E2E coverage before renderer changes**

Create `frontend/e2e/settings-connections.spec.ts`. Inject a fake `window.clipAssembler` with `page.addInitScript`, route `GET /diagnostics`, open Settings → Connections, and cover:

```ts
test('shows disconnected and starts browser sign-in', async ({ page }) => {});
test('shows waiting with a Cancel action and then cancelled', async ({ page }) => {});
test('reruns diagnostics after sign-in and shows connected', async ({ page }) => {});
test('shows expired with Reconnect', async ({ page }) => {});
test('shows a sanitized failed state', async ({ page }) => {});
test('keeps Claude Desktop and Codex MCP connection controls', async ({ page }) => {});
test('explains missing and incompatible Pi installations', async ({ page }) => {});
```

The diagnostic-rerun test must count requests and assert a second request occurs only after the sign-in promise completes.

- [ ] **Step 2: Verify the focused E2E test fails**

Run:

```bash
cd frontend
npx playwright test e2e/settings-connections.spec.ts
```

Expected: failure because the Connections account section and bridge methods do not exist.

- [ ] **Step 3: Register strict main-process IPC**

In `frontend/src/main/index.ts`, create one controller after Electron is ready. Register exactly three handlers. They accept no renderer-supplied provider, path, URL, or attempt identifier:

```ts
ipcMain.handle('review-model-auth:status', () => reviewModelAuth.getStatus());
ipcMain.handle('review-model-auth:sign-in', () => reviewModelAuth.signIn());
ipcMain.handle('review-model-auth:cancel', () => reviewModelAuth.cancel());
```

Validate that `event.sender` belongs to an application `BrowserWindow` before servicing each request. Cancel an active login in `before-quit` before stopping the backend. Reuse the Pi executable resolution exported by the auth module so packaged backend startup and account readiness inspect the same binary.

- [ ] **Step 4: Add the explicit preload and renderer bridge**

Expose only:

```ts
getReviewModelAccountStatus: () => ipcRenderer.invoke('review-model-auth:status'),
signInReviewModel: () => ipcRenderer.invoke('review-model-auth:sign-in'),
cancelReviewModelSignIn: () => ipcRenderer.invoke('review-model-auth:cancel'),
```

Use the shared DTO type rather than duplicating it. Add renderer wrappers that throw `Review model sign-in is only available in the desktop app` when the bridge is unavailable.

- [ ] **Step 5: Add Review model account to Connections**

Keep the internal tab key `connect-ai`, change only its visible label to `Connections`, and rename the component to `ConnectionsTabPanel`. Render a first section titled `Review model account`, followed by the existing `Connect your AI` MCP section without changing its MCP functions, client IDs, snippets, or buttons.

On mount, load token-free account status. Use one action button whose label/action is:

- `Sign in` for `disconnected`;
- `Reconnect` for `connected`, `expired`, `cancelled`, or `failed`;
- `Cancel` for `waiting`.

Disable Sign in/Reconnect when Pi state is `missing` or `incompatible`, and render the Pi detail separately from account state. Put state changes in `role="status" aria-live="polite"`; failures use `role="alert"`. Guard async completions with a monotonically increasing request ID and mounted flag so cancel and completion cannot overwrite newer state.

After sign-in returns `connected`, immediately call `getDiagnostics()` and render its reachable result; do not change `connected` to a different account state when diagnostics fails. Explain instead that the account is connected but the configured model is not reachable.

- [ ] **Step 6: Verify UI green and regressions**

Run:

```bash
cd frontend
npx playwright test e2e/settings-connections.spec.ts
npm run test:main
npm run typecheck
npm run lint:frontend
```

Expected: all commands exit 0.

## Task 3: Packaging Contract And Documentation

**Files:**
- Modify: `frontend/scripts/verify-packaged-backend.mjs`
- Modify: `docs/DEVELOPER_SETUP.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/USER_GUIDE.md`
- Modify: `docs/MANUAL_QA_GUIDE.md`
- Modify: `docs/HARNESS_SPEC.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes exact Pi 0.80.10 dependencies and the status/UI behavior from Tasks 1–2.
- Produces packaging assertions and user/developer/manual QA guidance without secrets.

- [ ] **Step 1: Add a packaging dependency assertion**

Extend `frontend/scripts/verify-packaged-backend.mjs` to read `frontend/package.json` and fail unless both Pi production dependencies equal `0.80.10`. Also scan `out/main/index.js` and fail if the main build omits the Pi package name or auth module import marker. Error text must name the missing package/marker without printing environment variables or file contents.

- [ ] **Step 2: Update developer and troubleshooting guidance**

In `docs/DEVELOPER_SETUP.md`, document exact Pi SDK versions, `npm run test:main`, browser callback port `1455`, and terminal `pi /login` as an advanced fallback. State that development/manual tests must never use or commit a real auth file fixture.

In `docs/TROUBLESHOOTING.md`, add distinct remedies for missing CLI, incompatible CLI, expired/revoked login, callback port occupied, cancelled flow, browser non-return, offline/proxy failure, corrupt/unreadable auth storage, and “connected but diagnostic failed.” Explicitly warn users never to paste `auth.json` or OAuth URLs/codes into bug reports.

- [ ] **Step 3: Update user and manual QA guidance**

In `docs/USER_GUIDE.md`, correct local-first wording: manual is local/default; `pi_agent` sends sampled Frame Samples to a cloud provider only after per-project consent. Add Review model account instructions before the separate Connect your AI MCP section and explain that signing in does not install Pi or grant project consent.

In `docs/MANUAL_QA_GUIDE.md`, add the remaining manual matrix: fresh sign-in/persistence, file permissions, unrelated-provider preservation, cancel/retry/modal-close/app-quit cleanup, port 1455 collision, invalid callback, offline/denial/revocation, corrupt/read-only/non-ASCII auth paths, missing/incompatible/current Pi, diagnostics plus consented analysis, consent revocation, MCP regression, Safari/non-default browser, Apple Silicon/Intel, and a final log/screenshot secret scan.

- [ ] **Step 4: Update architecture and harness contracts**

In `docs/HARNESS_SPEC.md`, replace “environment variables only” with the current runtime settings behavior and document Electron-main OAuth ownership plus Pi's shared auth file. In `docs/ARCHITECTURE.md`, add the renderer → preload → Electron-main → external browser/AuthStorage boundary and explicitly distinguish it from external MCP clients → stdio bridge → backend timeline operations.

- [ ] **Step 5: Verify documentation and packaging checks**

Run:

```bash
rg -n "Review model account|auth.json|1455|Connect your AI|openai-codex" \
  docs/DEVELOPER_SETUP.md docs/TROUBLESHOOTING.md docs/USER_GUIDE.md \
  docs/MANUAL_QA_GUIDE.md docs/HARNESS_SPEC.md docs/ARCHITECTURE.md
cd frontend
npm run build
node scripts/verify-packaged-backend.mjs
```

Expected: each document contains its relevant guidance and both build commands exit 0.

## Task 4: Full Verification, Review, And Commit

**Files:**
- Verify all branch changes.

**Interfaces:**
- Consumes Tasks 1–3.
- Produces fresh verification evidence and one final branch commit.

- [ ] **Step 1: Run backend tests and lint**

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest
.venv/bin/ruff check src tests
```

- [ ] **Step 2: Run frontend main, type, lint, build, audit, and focused E2E checks**

```bash
cd frontend
npm run test:main
npm run typecheck
npm run lint:frontend
npm run build
npx playwright test e2e/settings-connections.spec.ts
node scripts/verify-packaged-backend.mjs
npm audit --omit=dev --audit-level=high
```

- [ ] **Step 3: Verify dependency and secret boundaries**

```bash
cd frontend
node --input-type=module -e '
  const m = await import("@earendil-works/pi-coding-agent");
  if (m.VERSION !== "0.80.10" || typeof m.ModelRuntime !== "function" || typeof m.readStoredCredential !== "function") process.exit(1);
'
npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai
cd ..
rg -n "access|refresh|accountId|auth_url|authorization code" frontend/src/preload frontend/src/renderer
git diff --check
```

The final `rg` may find only explanatory test assertions or type-safe forbidden-key lists; it must not find a bridge/DTO field or logging statement that carries a secret.

- [ ] **Step 4: Review the complete branch diff**

Review from `git merge-base main HEAD` through `HEAD` for every Global Constraint, test quality, cancellation races, URL validation, token leakage, package closure, and unchanged MCP behavior. Fix every Critical or Important finding, rerun the covering checks, and re-review.

- [ ] **Step 5: Commit the completed branch**

Stage only the feature's files and commit with:

```bash
git commit -m "feat: add review model sign-in"
```

Do not push or open a pull request unless separately requested.

## Self-Review

- Spec coverage: all required states, OAuth ownership, Pi AuthStorage persistence/refresh, cancellation, diagnostics rerun, missing/incompatible Pi, MCP preservation, focused tests, docs, verification, review, and commit are assigned.
- Placeholder scan: no TBD/TODO/“handle edge cases” placeholders remain.
- Type consistency: the shared status/state types and three IPC operations are defined once and consumed unchanged across tasks.
- Scope: logout/device-code/manual-code UI, OAuth providers other than `openai-codex`, automatic Pi installation, and changes to project cloud consent are intentionally excluded.
