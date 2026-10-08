# 036: Proper tests and checks

Every check that guards a PR runs the same way locally, in the pre-commit hook
and in CI. Every test proves the behaviour its name claims. The e2e suite is
documented well enough for the owner to review what it covers.

## Context

Evidence: [the 2026-10-06 test audit](../reviews/2026-10-06-test-audit.md) and
a retrospective of the Sep 10 – Oct 6 agent sessions. Bugs that reached review
or users while the suite stayed green:

- An invalid FCPXML on every export (#80).
- MCP stdio framing that standard clients cannot speak.
- Download links stuck at v0.2.0.
- A chat whose auto-scroll was broken behind a `toBeVisible` assertion.
- Review baselines that never saw the changed cards.

Today's only hook is an unversioned `.git/hooks/pre-commit`. It runs
`react-doctor` through `npx @latest`, prints no findings, never fails, and fires
on docs-only commits.

Decisions:

- **Hook.** The hook is `.githooks/pre-commit`, a POSIX `sh` script, enabled by
  a `prepare` script in `frontend/package.json`
  (`git config core.hooksPath .githooks`). It adds no dependency. It checks
  only staged paths:
  - ESLint on staged `frontend/src` JS/TS files.
  - The installed `react-doctor --staged --fail-on warning` when a staged
    `.tsx` file is present.
  - `tsc --noEmit -p tsconfig.json` when any staged frontend TS is present.
  - Ruff on staged `backend` `.py` files.

  It prints each tool's diagnostics and exits non-zero on any failure. When a
  checked file also has unstaged changes, it stops and names the file instead
  of linting working-tree content. A commit touching none of those paths runs
  nothing and prints nothing.
- **React compiler rules.** `react-hooks/immutability`, `refs` and
  `set-state-in-effect` are currently off. They are turned on as errors, with
  a per-file `off` override listing only the files that violate them today
  (20 diagnostics). New files are checked from day one; the override list only
  shrinks.
- **FCPXML.** Validation at the DTD level belongs to
  [plan 032](032-valid-fcpxml-and-nle-verification.md) Phase 4; it is not
  repeated here.
- **Codex.** A Codex `workspace-write` sandbox blocks the backend's write to
  `~/.ai-clip-assembler/runtime.json`. The repo fixes that path; loopback
  networking is Codex profile config (H1).

## Phase 1: One gate, everywhere

- [ ] 1.1 Add the versioned pre-commit hook as decided. Done when a commit with
  an ESLint error in a staged `.tsx` fails and prints the error, a docs-only
  commit prints nothing, and `.git/hooks/pre-commit` no longer runs (because
  `core.hooksPath` points elsewhere).
- [ ] 1.2 Turn the three React compiler rules on with the per-file override
  list. Done when `npm run lint` passes and a new file that writes a ref during
  render fails lint.
- [ ] 1.3 Make `CONTRIBUTING.md`'s command list match the gate in
  `.github/workflows/test.yml`, and drop the stale
  `--ignore=tests/test_codex_cli_harness.py` from `test:backend`. Done when
  every gate command appears in both places.
- [ ] 1.4 Add `B` (bugbear) to Ruff's `select` and fix what it finds; if it
  reports more than 40 findings, stop and report the count by rule. Done when
  `npm run lint:backend` passes.
- [ ] 1.5 Derive the Settings rail version label from the app version the
  update check already receives, and remove that manual step from
  `docs/UPDATING.md`. Done when `SettingsModal.tsx` contains no version
  literal.

## Phase 2: Tests that can fail

- [x] 2.1 Switch the MCP stdio bridge to newline-delimited JSON, per the MCP
  transport spec. First rewrite the two framing tests in
  `backend/tests/test_mcp_bridge.py` to cover several messages, Unicode and
  EOF. Done when those tests fail on the old framing and pass on the new. (PR #95)
- [x] 2.2 Assert exact Transform values in export: FCPXML position and scale,
  Resolve zoom, all from independent expected numbers. Done when zeroing the
  pan or resetting the scale fails a test. (PR #95)
- [x] 2.3 Make the site download test derive the expected release from
  `frontend/package.json`, and update `site/index.html` to v0.4.0. Done when a
  version bump without a site update fails
  `python3 scripts/tests/test_site_contract.py`. (PR #95)
- [x] 2.4 Move the fake embedding provider into backend test support and
  delete `test_fake_embedding_provider_rejects_non_positive_dimensions` along
  with the guard it covers. Done when `backend/src` has no fake provider. (PR #95)
- [x] 2.5 Move the `validateRevealExportPath` cases (empty, whitespace, null,
  relative, accepted) to `handleRevealExportFile` tests that assert the shell
  is never called on invalid input. Then stop exporting the validator. Done
  when `npm run test:main` passes and the validator is module-private. (PR #95)
- [x] 2.6 Replace the argument-order assertion in `piExecutable.test.ts` with
  a test that runs `resolvePiBinFromLoginShell` against a stub shell, which
  prints a PATH only when invoked as an interactive login shell. Done when
  dropping the login flags fails the test. (PR #95)

- [x] 2.7 Delete `scripts/tests/test_release_workflow.py` and its CI step. Its
  four tests are whitespace-exact regexes over `build-dmg.yml`, and one only
  checks that CI runs this same file. Replace them with an `actionlint` step
  in `.github/workflows/test.yml` that validates every workflow. Done when a
  workflow with an invalid expression fails that step. (PR #95)

## Phase 3: An e2e suite the owner can review

- [ ] 3.1 Write `frontend/e2e/README.md` and add a pointer to it in
  `AGENTS.md`. It covers:
  - how to run one spec and the whole suite;
  - the two kinds of spec: the real backend through `reviewSetup.ts`, or a
    stubbed backend through route fulfilment;
  - stable selectors (roles, labels, existing test ids), and that Settings is
    a modal, not a route;
  - the :8000 and :5173 servers with `reuseExistingServer`, and checking
    `lsof -nP -iTCP:8000 -sTCP:LISTEN` before a run;
  - that the Linux baselines come from task 3.5;
  - a table with one row per spec: the user flow it proves, and whether the
    backend is real or stubbed.

  Done when every spec has a row.
- [ ] 3.2 Lower the default per-test timeout to 30 s and give only the specs
  that run real analysis the 180 s budget (`test.slow()` or a describe-level
  timeout). Done when a failing stubbed test fails within 30 s.
- [ ] 3.3 Make three tests prove their names:
  - the Review visual snapshots also capture the scrolled candidate browser,
    with cards in view;
  - `playwriter-preview.spec.ts` asserts the Review clip's `currentTime`
    advances after Play;
  - the Settings test drops "legacy deep link" from its name, because the app
    has no Settings route.

  Done when each fails on its stated regression, shown by breaking the owner
  temporarily.
- [ ] 3.4 Point the Playwright backend's `CLIP_ASSEMBLER_RUNTIME_FILE` at an
  absolute path under `frontend/test-results/`. Done when a full run writes
  nothing under `~/.ai-clip-assembler/`.
- [ ] 3.5 Add `.github/workflows/update-linux-baselines.yml`. It is
  `workflow_dispatch` with a `ref` input; it runs the visual spec with
  `--update-snapshots` on `ubuntu-latest` and commits the changed
  `*-chromium-linux.png` files to that ref. Done when dispatching it on a
  branch with a stale baseline turns that branch's e2e job green.

## Phase 4: Review standards

- [ ] 4.1 Add `CODING_STANDARDS.md` at the root. The `code-review` skill reads
  it by name, on top of its built-in smell baseline. It holds judgement rules
  only:
  - a fix that guards one async path against a stale project or session
    covers every sibling path in the same hook or module;
  - a new or changed test passes the `test-audit` authoring gate, and a
    regression test is shown red on the pre-fix code, with the PR saying how;
  - an assertion proves the behaviour the test name claims (visible is not
    playing, scrolled or saved);
  - a wall-clock bound appears only where the deadline itself is the contract.

  Done when the file exists and holds no rule that a tool already enforces.

## Human tasks

- [ ] H1 Allow loopback networking for Codex `workspace-write` runs in your
  Codex profiles, so Codex delegates can run Playwright.
- [ ] H2 Read the spec table in `frontend/e2e/README.md` and flag any user
  flow that should be covered but isn't.
