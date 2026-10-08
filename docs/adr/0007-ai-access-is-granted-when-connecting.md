# 0007: AI Access is granted once, when the Editor connects a Provider

## Status

Accepted (2026-10-08). Supersedes the per-project opt-in in
[ADR 0001](0001-local-first-and-cloud-consent.md) and the consent scope in
[ADR 0005](0005-harness-and-review-agent-are-independent.md); their
local-first default and the independence of scoring and the Review Agent stand.

## Context

ADR 0001 made cloud AI opt-in per project. In practice consent was granted only
by a system dialog that appeared when analysis started with Pi selected: a
project analysed rule-based could never turn its Review chat on, Settings
claimed a revoke control that did not exist, and a hobbyist who had just signed
in to their own AI account was asked again in every project. The owner's target
user connects their own Claude or ChatGPT subscription on purpose; that act is
the moment to agree to what is sent.

## Decision

- **AI Access** is granted once, in the same step that connects a Provider:
  a **Connect and allow** button under a plain statement of what is sent and
  what never leaves the Mac. It then applies to every project.
- Each project has an **AI: On / Off** switch. Off means nothing about that
  project is sent; the app works rule-based.
- What may be sent: Frame Samples, file names (never folder paths), clip
  timings and scores, the Timeline, and the Review chat including Scripts and
  their results. Video and audio files are never uploaded. The app enforces
  this boundary itself (only listed files and text are handed to the Provider's
  program; no general file access), so the disclosure is a promise the code
  keeps, not a description of current behaviour.
- One gate covers analysis scoring and the Review Agent. The Editor's own
  Scripts never need AI Access. External agents connected over the MCP Server
  stay outside this gate: the Editor drives them with their own account.
- Disconnecting the Provider revokes AI Access everywhere.

## Consequences

- The project manifest's `cloud_ai_consent` becomes a per-project off switch
  (default on once AI Access exists); the connection-level grant lives with the
  AI Connection, not the project.
- "Consent" is not shown to the Editor; the UI says **Connect and allow** and
  **AI: On / Off**.
- User-facing privacy copy (README, User Guide, site) is rewritten to the list
  above, including that file names are sent.
