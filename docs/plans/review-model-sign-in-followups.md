# Review Model Sign-In — Review Follow-ups

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> to work this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** IN PROGRESS — Task 0 (safe cleanups) landed; Task 1 (the owner's
component question) and Tasks 2–3 (spec-axis reconciliation) are open.

**Origin:** Two-axis review of PR #56 (`feature/review-model-sign-in` vs `main`),
covering the two review comments on
[review 4748439927](https://github.com/evilkels/ai-clip-assembler/pull/56#pullrequestreview-4748439927):

1. **Owner** on `SettingsModal.tsx` — "Why is this not a separate component,
   like a child component, and make sure that other components like this are not
   multiple components in one file."
2. **Copilot** on `reviewModelAuth.ts` — `isAllowedOpenAiAuthUrl` allowed any
   HTTPS path/query on `auth.openai.com` before driving `shell.openExternal()`.

No hard standards violations and no spec correctness defects were found; every
item below is a judgement-call cleanup or a spec-record reconciliation.

---

## Task 0: Safe cleanups — DONE

Landed as low-risk refactors with `npm run typecheck`, `npm run lint`, and the
33 main-process tests (`npm run test:main`) all green.

- [x] **Tighten `isAllowedOpenAiAuthUrl`** (Copilot comment). Added
  `OPENAI_OAUTH_AUTHORIZE_PATH = '/oauth/authorize'`; the validator now also
  requires `url.pathname === OPENAI_OAUTH_AUTHORIZE_PATH` and `url.hash === ''`,
  in addition to the existing https + exact-host + no-port/credentials checks,
  before the URL can reach `shell.openExternal`. Existing tests already used
  the `/oauth/authorize` path, so they stayed green.
- [x] **Collapse duplicated `disconnected` branches** in `mapCredentialStatus`
  (`reviewModelAuth.ts`) — the non-oauth and non-finite-`expiresAt` branches
  returned byte-identical objects; both now return one shared `disconnected`.
- [x] **Deduplicate the renderer bridge wrappers** (`api/client.ts`) — the three
  `getReviewModelAccountStatus`/`signInReviewModel`/`cancelReviewModelSignIn`
  wrappers now delegate to one `callReviewModelBridge(method)` helper.
- [x] **Rename `act` → `handleAccountAction`** in `SettingsModal.tsx` (Mysterious
  Name) and reuse the exported `REVIEW_MODEL_PROVIDER` constant in the failed-load
  fallback instead of the literal `'openai-codex'`.

---

## Task 1: Answer the owner's component question — OPEN

**Finding:** Extracting `ReviewModelAccountSection` to its own *file* is optional,
not required. `SettingsModal.tsx` already colocates `SettingsTabPanel`,
`ConnectionsTabPanel` (renamed from `ConnectAiTabPanel`), `DiagnosticsTabPanel`,
and the `SettingsModal` shell, and `TimelineEditor.tsx`, `ReviewChatPanel.tsx`,
and `ClipCard.tsx` each bundle two components too — so panels-in-one-file is the
repo's established pattern (CONTRIBUTING: "follow the existing code style in
nearby files"). The genuine smell is the section's **internal breadth**: it
interleaves status-load, sign-in/cancel action, and diagnostics polling, with the
`mountedRef.current && requestId === requestIdRef.current` guard copied three
times (~lines 196, 219, 243).

**Files:** `frontend/src/renderer/src/components/SettingsModal.tsx`
(+ any new `hooks/`/`components/` file this task decides to create).

- [ ] **Step 1: Extract the request-lifecycle logic into a hook.** Move the
  `mounted`/`requestId` bookkeeping, status load, `handleAccountAction`, and
  `runDiagnostics` into a `useReviewModelAccount()` hook that returns
  `{ account, actionPending, diagnosticState, handleAccountAction }`. Collapse the
  triplicated guard into one predicate (e.g. `isCurrent(requestId)`). This removes
  the duplication regardless of whether the JSX moves.
- [ ] **Step 2: Decide on file extraction.** If Step 1 leaves the section thin and
  presentational, keep it in `SettingsModal.tsx` (consistent with the file's
  pattern) and note the decision in the PR. Only split into a separate file if the
  section stays large after the hook extraction. Record the rationale either way so
  the owner's question is explicitly answered.
- [ ] **Step 3: Audit for other multi-component files** (the owner's second ask).
  Confirm the colocation in `TimelineEditor.tsx`, `ReviewChatPanel.tsx`, and
  `ClipCard.tsx` is intentional/consistent; do NOT churn them in this PR unless one
  is clearly over the line. Leave a one-line note in the PR summarising the audit.
- [ ] **Step 4: Verify.** `npm run typecheck`, `npm run lint`, `npm run build`, and
  the Connections E2E spec (`frontend/e2e/settings-connections.spec.ts`) stay green.

## Task 2: Reconcile the plan record with what shipped — OPEN

Spec-axis findings where the code is defensible but the plan record
(`docs/plans/review-model-sign-in.md`) is now inaccurate. Cheap to fix; pick
"update the code" or "update the record" per item.

**Files:** `docs/plans/review-model-sign-in.md`, and optionally the code it names.

- [ ] **Step 1: Named E2E test.** Task 2 Step 1 of the original plan requires
  `test('shows disconnected and starts browser sign-in', ...)`; the shipped spec's
  equivalent is `'cancels an in-flight sign-in and ignores its stale completion'`.
  Behaviour is covered. Either rename the test to the specified name or amend the
  plan to record the actual name. Prefer amending the plan (the name is cosmetic).
- [ ] **Step 2: `piExecutable.ts` location.** The plan said Pi resolution would be
  "exported by the auth module"; it lives in a new `frontend/src/main/piExecutable.ts`
  (with `piExecutable.test.ts`) instead. The same `piBin` is threaded to both
  `startPackagedBackend(piBin)` and `inspectPiInstallation({ piBin })`, so intent
  holds. Add `piExecutable.ts` + its test to the plan's File Structure and update the
  Task 2 Step 3 wording. (Keeping the dedicated module is preferable to re-exporting
  from the auth module — leave the code as is.)

## Task 3: Decide on the unrequested hardening — OPEN

Two behaviours in the diff exceed the spec (scope creep). Both are defensible
security hardening; the point is to make the call deliberately and document it, not
to necessarily remove them.

**Files:** `frontend/src/main/reviewModelAuth.ts`, `frontend/src/main/index.ts`,
`docs/plans/review-model-sign-in.md` (or `docs/ARCHITECTURE.md`).

- [ ] **Step 1: Forced loopback callback.** `PI_OAUTH_CALLBACK_HOST` /
  `withLoopbackCallbackHost` globally mutate `process.env` around each
  `runtime.login` (behind a promise queue). Keep it (it forces the OAuth callback to
  loopback — a real hardening) but document why in the plan/architecture notes so the
  global-env mutation is not read as accidental. If a non-global mechanism exists in
  the Pi API, prefer it.
- [ ] **Step 2: Executable validation.** The `resolvePiBinFromLoginShell` rewrite
  (marker + `stat`/`X_OK`) exceeds the "reuse resolution" step. Keep it and record it
  as intentional hardening in the plan. Confirmed covered by `piExecutable.test.ts`.
