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

## Task 1: Extract the review-model section — DONE

The owner's comment is a direct instruction (a separate child component, in its
own file), which overrides the repo's prior panels-in-one-file convention.

**Files:** `frontend/src/renderer/src/components/ReviewModelAccountSection.tsx`
(new), `frontend/src/renderer/src/components/SettingsModal.tsx`.

- [x] **Step 1: Extract the request-lifecycle logic into a hook.** Added a
  `useReviewModelAccount()` hook returning
  `{ account, actionPending, diagnosticState, handleAccountAction }`. The
  `mountedRef.current && requestId === requestIdRef.current` guard that was copied
  three times is now one `isCurrent(requestId)` predicate.
- [x] **Step 2: Move it to its own file.** `ReviewModelAccountSection` (plus its
  `accountStateLabels`/`DiagnosticState` locals and the hook) now lives in
  `ReviewModelAccountSection.tsx`; `SettingsModal.tsx` imports it and dropped the
  now-unused `useRef`, review-model client wrappers, `ReviewModelAccountStatus`,
  and `REVIEW_MODEL_PROVIDER` imports.
- [x] **Step 3: Audit for other multi-component files** (the owner's second ask).
  Files still declaring >1 top-level component: `SettingsModal.tsx` (4 remaining:
  `ThemeToggle`, `SettingsTabPanel`, `ConnectionsTabPanel`, `DiagnosticsTabPanel`
  + the `SettingsModal` shell), `ClipCard.tsx` (`SourceTrack` + `ClipCard`),
  `ReviewChatPanel.tsx` (`ReviewChatPanel` + `ProposalCard`), `TimelineEditor.tsx`
  (`TimelineEditor` + `TimelineItemRow`). All are **pre-existing** and untouched by
  this PR; splitting them is unrelated refactor churn (CONTRIBUTING: "keep changes
  scoped to one problem"). Flagged for a separate cleanup pass — see Task 4.
- [x] **Step 4: Verify.** `npm run typecheck`, `npm run lint`, `npm run build`, the
  33 main-process tests, and all 8 Connections E2E tests
  (`frontend/e2e/settings-connections.spec.ts`) green after the move.

## Task 4: Split the pre-existing multi-component files — DONE

Done at the owner's request, on this PR. Each is a mechanical one-component-per-file
split with no behaviour change; every affected component is now the sole component
in its file.

- [x] `SettingsModal.tsx` → `ThemeToggle.tsx`, `SettingsTabPanel.tsx`,
  `ConnectionsTabPanel.tsx`, `DiagnosticsTabPanel.tsx`; `SettingsModal.tsx` keeps
  only the shell + `SettingsTab` type.
- [x] `ClipCard.tsx` → `SourceTrack.tsx` (the `Range` type and `clamp01` helper
  moved with it).
- [x] `ReviewChatPanel.tsx` → `ProposalCard.tsx`.
- [x] `TimelineEditor.tsx` → `TimelineItemRow.tsx` (the `round` helper moved with it).

**Verify:** typecheck, lint, build, 33 main tests green; the affected E2E specs
(settings-connections, compare-versions, timeline-playback) pass. One
timeline-playback test (`crosses the clip boundary…`) fails, but it fails
identically on the pre-refactor commit — a pre-existing fixture/playback issue,
not caused by this split.

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
