# Plan 030: Truthful AI usage — selected vs effective harness, and an independent Review Agent

Status: TODO · Priority P1 · Effort M · Risk MED · Category correctness + trust
Created 2026-09-03 against `48a0f8b`. Implements
[ADR 0005](../adr/0005-harness-and-review-agent-are-independent.md).

> **For agentic workers:** phases are ordered; each step has its own
> verification. Use the vocabulary in `UBIQUITOUS_LANGUAGE.md` exactly —
> **Selected Harness**, **Effective Harness**, **Harness Fallback**,
> **In-App Review Agent**. Do not write "manual mode" in user-facing copy.

## Why

Reported from real testing of the released v0.2.0 app: the Editor chose the
agentic harness, ran analysis, opened Review, and the chat greeted them with
"Manual analysis is ready. Creative versions remain deterministic and local."
Nothing else in the UI mentioned a harness, so the chat's greeting was the only
signal that anything had happened — and it named the wrong concept.

Four defects sit behind that one sentence.

1. **The chat is gated on the scoring harness.** `api.py:1107-1110` selects the
   In-App Review Agent from `project["harness_id"]`, so choosing rule-based
   scoring silently replaces the agent with a stub. ADR 0005 decides these are
   independent.
2. **The Selected Harness is not persisted.** `Import.tsx:112` holds it in
   component state defaulting to `'manual'`, so it resets on navigation. The
   `ProjectManifest` has a `harness` field that nothing writes and nothing
   reads.
3. **Fallback is silent.** `pi_cli_harness.py:203` raises
   `PiCliUnavailableError` and the caller returns `_fallback_result(...)` — the
   rule-based result. The backend computes `used_ai`, a per-video `warning` and
   `models_used` into `response["metadata"]` (`api.py:655`), and the client
   drops all of it: `client.ts:386-404` neither declares nor maps `metadata`.
   No notice carries it either; the only notice is the vidstab one.
4. **Re-deriving overwrites the selection.** `POST /clips/rederive` passes
   `harness_id="manual"` hardcoded (`api.py:790`) into `_finalize_clip_set`,
   which writes `projects[project_id]["harness_id"]` (`api.py:675`). The value
   is truthful about the clips — re-derive really does rebuild them via
   `assemble_smooth_clips` from cached Frame Scores with no AI step — but it
   destroys the record of what the Editor chose. The confirm dialog warns about
   "include/exclude choices, order, trims, and the working timeline" and says
   nothing about discarding AI enhancement.

Note that on v0.2.0 the `pi` CLI could not be resolved at all, so *every*
agentic run fell back. That root cause is already fixed on
`feat/029-clip-posters`; this plan is about the app being honest when it
happens again, which it will — a missing CLI is only one of three fallback
paths.

## Decisions already made — do not relitigate

- **Harness and Review Agent are independent**, under **one** per-project
  cloud-AI consent. Not two consents. ADR 0005.
- **`harness_id` splits into Selected and Effective.** Re-derive keeps writing
  an Effective Harness of `manual`, because a re-derived library genuinely is
  rule-based; what it must stop doing is overwriting the selection.
- **Fallback stays a fallback.** A long analysis that degrades is better than
  one that throws away its work. It must be *reported*, not prevented.

## Phase 1 — Model the two harnesses

- [ ] **Step 1.1** Persist **Selected Harness** on the project and in the
      manifest (`ProjectManifest.harness` already exists and is unused). It
      must survive navigation, reopen, and re-derive.
- [ ] **Step 1.2** Write **Effective Harness** wherever a Candidate Clip
      library is produced: analysis, and `/clips/rederive`. Re-derive writes
      `manual`; analysis writes the harness that actually ran, which is
      `manual` on a Harness Fallback.
- [ ] **Step 1.3** Backend tests: analysis with `pi_agent` and a working CLI
      records both as `pi_agent`; with the CLI missing, Selected stays
      `pi_agent` while Effective becomes `manual`; re-derive changes Effective
      only; both survive a project reopen.

## Phase 2 — Decouple the Review Agent

- [ ] **Step 2.1** Choose the In-App Review Agent from its own setting rather
      than `harness_id`, keeping the existing cloud-AI consent check as the
      single gate. Removing the coupling must not weaken ADR 0001: without
      consent, no provider call for either surface.
- [ ] **Step 2.2** Default the agent setting so existing projects behave
      sensibly: consent granted implies the agent is available regardless of
      Selected Harness.
- [ ] **Step 2.3** Retire the "Manual analysis is ready." stub message. If a
      stub agent is still needed for the no-consent case, it must describe the
      *agent's* state, not the harness — e.g. that conversational suggestions
      need cloud AI consent for this project, with the way to grant it.
- [ ] **Step 2.4** Tests: rule-based Selected Harness plus consent yields a
      real agent; no consent yields the stub for both surfaces.

## Phase 3 — Make fallback visible

- [ ] **Step 3.1** Carry `metadata` through the client: declare it in the
      response type and map it (`client.ts:386-404`).
- [ ] **Step 3.2** Surface a **Harness Fallback** in Review where the Editor
      will see it, naming the reason and the affected Source Videos. The
      backend already supplies `used_ai`, the per-video `warning`, and
      `models_used`.
- [ ] **Step 3.3** Say it in the regenerate confirm dialog too: re-deriving
      discards AI enhancement and returns the library to rule-based.
- [ ] **Step 3.4** E2E: a run whose harness falls back shows the notice and
      names the reason; a fully successful agentic run shows none.

## Phase 4 — Show the Selected Harness

- [ ] **Step 4.1** Render the Selected Harness where the Editor can see it
      outside Import, so "what is this project set to?" is answerable without
      navigating back. Show Effective alongside it when they differ.
- [ ] **Step 4.2** Full gates: backend, ruff, lint, typecheck, `test:main`,
      Playwright.

## Done criteria

- [ ] Selecting the Manual Harness leaves the In-App Review Agent working.
- [ ] The Selected Harness survives navigation, reopen and re-derive.
- [ ] A Harness Fallback is visible in the UI with its reason.
- [ ] Re-derive changes the Effective Harness only, and says what it discards.
- [ ] No user-facing string says "manual mode".
- [ ] Without cloud-AI consent, neither scoring nor chat calls a provider.

## Stop and report instead of improvising if

- Decoupling appears to require a second consent prompt — that was considered
  and rejected in ADR 0005; report rather than adding one.
- Persisting the Selected Harness needs a manifest schema version bump. That
  affects project portability (ADR 0003) and is a maintainer decision.
- The Review Agent turns out to depend on harness-produced data beyond the
  Candidate Clip library, which would mean the two are genuinely coupled and
  ADR 0005 needs revisiting rather than implementing.

## Out of scope

Which provider counts as "the AI harness" for the Flow D signal test
(`drone-workflow-qa-flows.md`, still unresolved), per-project versus global
harness override UX ([`done/project-folder-model.md`](done/project-folder-model.md),
still unresolved), and any
change to what the harnesses actually score.
