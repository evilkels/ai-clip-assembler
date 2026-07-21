# Review Model Sign-In — Review Follow-ups

Status: IN PROGRESS. PR #56 review follow-up; Tasks 0, 1, and 4 are DONE.
Tasks 2–3 remain plan/spec-record reconciliation, not known product defects.

## Origin

Owner requested one component per file. Copilot noted OAuth URL validation was
too broad. Standards/spec review otherwise found no hard correctness defect.

## Delivered cleanups

- OAuth validation now requires HTTPS, exact `auth.openai.com`, exact
  `/oauth/authorize`, no port/credentials/fragment.
- Collapsed duplicate disconnected mapping, deduplicated renderer bridge calls,
  renamed the account action, and reused the provider constant.
- Extracted `ReviewModelAccountSection` and request-lifecycle hook.
- Split pre-existing multi-component modules: Settings panels/theme, SourceTrack,
  ProposalCard, and TimelineItemRow now each have their own file.
- Verified typecheck, lint, build, 33 main tests, and 8 Connections E2E tests.

## Remaining Task 2 — reconcile shipped structure

1. Update the original plan's named E2E example to the delivered cancellation/
   stale-completion test; behavior is covered and renaming code adds no value.
2. Record `frontend/src/main/piExecutable.ts` and its test as the dedicated Pi
   resolver. It intentionally feeds both backend startup and account inspection.

## Remaining Task 3 — record intentional hardening

1. Document forced-loopback OAuth callback ownership. `withLoopbackCallbackHost`
   serializes temporary `process.env` mutation around Pi login; prefer a future
   non-global Pi API if one appears.
2. Document marker plus `stat`/`X_OK` executable validation as deliberate defense
   against noisy or malicious login-shell output.

## Done criteria

Reconcile those decisions in this plan or the architecture record, verify cited
paths and tests still match the implementation, then mark DONE. Do not reopen
the delivered auth behavior unless evidence shows a functional or security bug.
