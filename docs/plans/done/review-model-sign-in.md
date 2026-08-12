# Review Model Sign-In

Status: DONE (2026-07-19). Automated checks are green; real OAuth/package smoke remains manual QA.

## Goal and delivered architecture

Editors can authenticate the internal `pi_agent` Review model with an OpenAI
ChatGPT subscription from Settings. Pi 0.80.10 owns persistence/refresh in
`~/.pi/agent/auth.json`; Electron main owns browser OAuth, cancellation, status,
CLI compatibility, and token-free IPC. Connections keeps the separate Claude
Desktop/Codex MCP controls.

The shared contract exposes only provider, safe state/detail, expiry, and Pi
readiness/version. Main validates the exact HTTPS OpenAI authorization endpoint,
forces the callback to loopback, serializes the temporary environment override,
and rejects stale/cancelled completions. A hardened login-shell resolver validates
the Pi executable and feeds both packaged backend startup and account inspection.

## Constraints preserved

- Only `openai-codex`; Pi packages pinned exactly to `0.80.10` and public APIs.
- Tokens, OAuth URLs/codes, account IDs, auth contents, and raw errors never cross
  into React/IPC responses/logs/diagnostics; other provider entries survive.
- States: connected, expired, disconnected, waiting, cancelled, failed; one
  active flow, idempotent cancellation, safe retry, diagnostic rerun on success.
- Pi readiness is ready/missing/incompatible (`>=0.73.1 <1.0.0`). Sign-in never
  installs Pi, selects a harness, or grants per-project cloud consent.

## Delivered surfaces

- `frontend/src/{shared/reviewModelAuth.ts,main/reviewModelAuth.ts}` plus narrow
  preload/renderer bridges and main IPC lifecycle ownership.
- `frontend/src/main/piExecutable.ts` centralizes validated Pi resolution.
- `ReviewModelAccountSection.tsx` owns the Connections UI state machine.
- `settings-connections.spec.ts`, main auth/executable tests, package assertions,
  and architecture/setup/user/troubleshooting/manual-QA documentation.

## Verification record

At delivery: 359 backend tests, 33 main tests, 8 focused Connections E2E tests,
backend/frontend lint, typecheck, production build, packaging contracts, Pi API
checks, and production dependency audit passed. Manual matrix covers persistence,
permissions, cancellation/races, callback failures, storage, compatibility,
diagnostics/consent, MCP regression, browsers/architectures, and secret scanning.

## Scope exclusions

No logout/device-code/manual-code UI, other OAuth providers, automatic Pi
installation, footage upload, or changes to project consent. Follow-up record:
[`review-model-sign-in-followups.md`](review-model-sign-in-followups.md).
