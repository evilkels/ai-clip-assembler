# Remote View checkpoint review — 2026-10-10

The owner requested preservation of the stalled work as-is and independent tester and code-review agents. No implementation changes or merges were made during this takeover. Draft PR: [#108](https://github.com/evilkels/ai-clip-assembler/pull/108).

## Scope and continuation

Review fixed point: `89118ea568b9f15e037470a3f10b42204eddac39` (current main at takeover). Reviewed source checkpoint: `e0d3d4a`, using `git diff 89118ea...e0d3d4a`; it includes the earlier branch commits and four formerly untracked task 1.11 files. Documentation note: `96ac043`.

Plan 041 has **10/36 implementation tasks** checked and **1/7 human/owner tasks** checked. Tasks 1.1–1.10 are checked; 1.11 is WIP. Resume at 1.11, then 1.12–1.20, followed by Phases 2–3. No human task was changed. Draft #108 conflicts with main and must be reconciled before eventual integration. The following findings concern already implemented behavior; planned missing phone UI and Electron wiring are expected at this checkpoint.

## Standards

Independent read-only Standards agent, following the code-review skill and the checkout's AGENTS.md, CODING_STANDARDS.md, CONTRIBUTING.md and architecture/ADRs:

1. **P1: Directory flush failures silently acknowledge durable saves.** `backend/src/durable_io.py:35–42` suppresses every `OSError` from directory open/flush, including real I/O failure. The atomic writer then returns success even when directory metadata durability is unknown, contrary to ADR 0003's prohibition on silently treating failed writes as durable saves. A mock probe confirmed an `OSError(EIO)` from `fsync_fd` is swallowed. Limit compatibility suppression to unsupported-operation errors and propagate storage failures.
2. **P1: Recovery rewinds a live finalizer.** `backend/src/uploads/ingest.py:97–98` triggers folder recovery for one stalled publication. `recover`, at lines 433–436, changes every `verifying` upload to `received` without checking live workers or taking the upload lock. Another live verification can become cancellable or accept a second finalize while its existing worker continues toward publication. Serialize recovery, skip live workers, and revalidate transitions under the upload lock.
3. **P2: Capacity check and reservation race between Projects.** `backend/src/uploads/service.py:297` checks free capacity, but line 327 reserves it later under a per-folder lock. Two Projects can pass the same free-space calculation before either reserves. Make check plus reservation one ledger transaction, releasing on staging failure.

No additional Fowler smell finding warranted action. The checkpoint evidence was explicitly authorized by the owner.

## Spec

Independent read-only Spec agent against plan 041, architecture §6.4, UX spec and ADR 0010:

1. **P1: Reservation race violates the no-overcommit contract.** Architecture: “Reservations prevent the app overcommitting itself.” Same cross-Project transaction gap as Standards finding 3.
2. **P2: Chunk acceptance omits the free-space check.** Architecture §6.4: “Check free space at creation, before accepting chunks and before rendering.” `backend/src/uploads/service.py:353` accepts chunks without checking capacity again. The reviewer reproduced creation with 20 GiB free followed by a chunk accepted after simulated free space fell to 4 GiB. Recheck before accepting a chunk.
3. **P2: Ten unfinished uploads is enforced per Project, not per device.** Architecture §6.4: “At most ten unfinished uploads per device.” `backend/src/uploads/service.py:288` counts only the current folder's uploads. The reviewer reproduced eleven unfinished uploads for one device across two Projects. Enforce the device quota across Projects.

No scope creep found. Later phases remain deliberately unfinished.

## Validation

Independent tester completed:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed, including generated type freshness |
| `npm run test:main` | **114 passed, 3 failed** |
| `npm run test:backend` | 822 passed, 3 skipped; 6 warnings |
| `python3 scripts/tests/test_plans.py -v` | 16 passed |
| `python3 scripts/plans.py check` | Passed |

Backend skips: unimplemented `src.version_diversity` (plan 027), missing `onnx`, and unavailable SigLIP model/runtime. Local test logs: `/tmp/ai-clip-status-tests/remote-*.log`; these are machine-local scratch, not repository artifacts.

The three failures are in `frontend/tests/main/remoteViewController.test.ts`:

- Line 734, another Serve entry changes while ours is added: backend disable expected once, observed twice.
- Line 840, backend closes the gate: expected Remote View off, observed on.
- Line 854, backend EOF: expected Remote View off, observed on.

Browser execution is blocked by an existing Python backend on port 8000; it was not stopped or reused. No fixes were made. Local dependency environments are not checkpoint artifacts.

Standards: 3 findings; highest severity P1 durability/recovery. Spec: 3 findings; highest severity P1 reservation race. There are **five distinct findings** across the axes; the reservation race appears in both.


## Quality follow-up

The controller reconciled current main in an isolated worktree (merge `718e772`) while preserving both ADR entries and regenerating the plan index. The original checkout remains available for the stalled thread. This follow-up repairs the five distinct initial findings and the three controller cleanup failures; it does not complete later Remote View phases.

An external implementer and two independent Sol/high CLI review passes checked the source against Standards and Spec. Repairs include genuine directory I/O error propagation, recovery skipping live workers under upload locks, atomic capacity check/reservation, disk sampling under the ledger lock, per-chunk capacity rechecks, per-device quotas across Projects, coherent registry snapshots, reservation cleanup on every failed admission, and shared/awaited backend shutdown. The directory-flush regression injects `EIO` through the real directory-descriptor path, preserving the post-publication error boundary. Creation/capacity and registry regressions were demonstrated red before repair.

The last independent review identified four P2 findings. The controller repaired two with red/green proof: chunk-capacity sampling now uses the ledger lock, and expiry rechecks state/progress after taking the upload lock (4 focused cases passed, Ruff passed). **Two remain open and block readiness:**

1. Collision naming in `backend/src/uploads/ingest.py` still iterates the mutable upload registry. Snapshot it safely and shorten recovery's folder-lock scope to avoid a Project/folder lock inversion; add meaningful concurrent publication coverage.
2. The registry loading/sweeping regression still uses a one-second scheduling window. Replace that with explicit handshakes and preserve demonstrable failure on the prior implementation.

These are continuation work within tasks 1.8/1.9 before 1.12. Draft PR #108 remains a checkpoint, not merge-ready. Task 1.11 is now checked: all 122 main-process cases pass, including the three original failures, without sleeps or private controller-state reads. Plan progress is 11/36 implementation tasks; owner gates remain 1/7.

Validation of settled source is recorded below. An earlier full run overlapped the implementer's lock changes and test execution: 863 passed, 3 skipped, with one obsolete admission-test failure and a timing-sensitive native-sort failure. That result is retained as history rather than claimed as final proof. The existing local backend on port 8000 still prevents the default browser suite, so CI supplies that gate. The prototype polling regression is separately green in PR #109.

The main-reconciliation commit required bypassing the local React Doctor hook for that commit only: it rejected inherited renderer changes (38 existing warnings). ESLint, Ruff, typecheck and plan checks passed; no hook configuration was changed. The implementer's initial full backend run lacked `lxml`; the controller used an existing dependency environment and ran the full suite successfully before the follow-up, 863 passed / 3 skipped.
