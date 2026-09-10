# Review Model Sign-In — Review Follow-ups

Status: **DONE (2026-09-10).** The remaining plan/spec reconciliation matches
the shipped implementation.

The four decisions Tasks 2 and 3 asked to be recorded, recorded here:

- The delivered E2E is `frontend/e2e/settings-connections.spec.ts`, which covers
  cancellation and stale completion. It replaces the example the original plan
  named; the behaviour is covered, so renaming code would add nothing.
- `frontend/src/main/piExecutable.ts` and its test are the dedicated Pi
  resolver. It feeds both backend startup and account inspection on purpose —
  one resolver, so the two paths cannot disagree about which Pi they found.
- `withLoopbackCallbackHost` in `reviewModelAuth.ts` owns the forced-loopback
  OAuth callback. It serializes a temporary `process.env` mutation around Pi
  login because Pi takes the host from the environment and offers no per-call
  argument; a non-global Pi API would replace it.
- Marker plus `stat`/`X_OK` validation of the resolved Pi binary is deliberate
  defense against a noisy or hostile login shell, whose stdout would otherwise
  be trusted as a path.

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
