# Going-public roadmap — Codex CLI working flow

Status: ACTIVE (2026-07-02). Owner: Elvijs. This is the operating manual for
driving the project from "works on my machine" to a public, monetizable
release, using Codex CLI as the implementer and reviewer.

## The loop (use this for every task below)

Codex CLI reads `AGENTS.md` automatically, so it already knows the repo rules
(plans layout, PR workflow, protected main). Each task runs the same five-step
loop:

1. **Branch** — `git checkout -b feature/<task-slug>` (main is protected).
2. **Implement** — run Codex on the task prompt:

   ```bash
   codex "Read docs/plans/going-public-codex-flow.md, task <N>. Implement it.
   Follow AGENTS.md. Run the checks listed under 'Definition of done' before
   declaring success."
   ```

   Use interactive `codex` for judgment-heavy tasks; use
   `codex exec "<prompt>"` for mechanical ones you don't need to watch.
3. **Verify locally** — the gates, always, before review:

   ```bash
   cd backend && PYTHONPATH=. .venv/bin/python -m pytest && cd ..
   cd frontend && npm run typecheck && npm run build && cd ..
   backend/.venv/bin/python scripts/synthetic_e2e_qa.py
   ```

4. **Review with a fresh Codex session** — never let the implementing session
   grade its own work:

   ```bash
   codex review          # reviews the current diff against the base branch
   ```

   or, for a stricter pass:

   ```bash
   codex "Review the diff of this branch against main as a skeptical senior
   engineer. Look for: broken privacy claims, regressions in the analysis
   pipeline, missing tests, contract drift between backend models and
   frontend types. Report findings only — do not fix."
   ```

   Fix findings in the implementing session, re-run gates, repeat until clean.
5. **PR** — `gh pr create`, link the task, merge when green. Update this file's
   checklist and `docs/plans/README.md` status.

## The roadmap

Order matters: each phase unblocks the next. Don't start phase 3 marketing
work while phase 1 trust issues are open.

### Phase 1 — Trust (do first, cheap, reputational insurance)

- [x] **Task 1: Privacy consent + honest labeling.** DONE 2026-07-03 in PR
  #37 (`72a195b`). The README/AGENTS.md say
  footage never leaves the machine, but the default `pi_agent` harness sends
  sampled frames to a cloud model. Add an explicit first-use consent prompt
  before any cloud-backed harness runs, default new projects to the manual
  harness, and reword README/AGENTS.md to "local by default, cloud AI
  opt-in". (Flagged in the 2026-06-10 audit; deselected then, mandatory now.)
  Definition of done: consent state persisted per project, backend refuses
  cloud harness without it (tested), docs updated, gates green.

### Phase 2 — Installability (the adoption blockers)

- [ ] **Task 2: FFmpeg out-of-the-box.** Part (a) DONE 2026-07-03 in PR #36
  (`f7f88eb`): graceful degradation when `vidstabdetect` is missing. Part (b)
  remains open: bundle a static ffmpeg in the DMG. Today a fresh install needs a 10–30
  min source build of ffmpeg with libvidstab. Two-part fix: (a) graceful
  degradation — detect missing `vidstabdetect` at startup and skip motion
  stability with a visible notice instead of hard-failing
  (`backend/src/frame_extraction.py`, `backend/src/motion_analysis.py`);
  (b) bundle a static ffmpeg in the DMG (follow-up from plan 003's packaging
  work, PRs #31–#33). Ship (a) first — it makes every install work today.
- [ ] **Task 3: Sign + notarize the DMG.** Apple developer account, signing
  identity, notarization in the build script. Without this Gatekeeper calls
  the app damaged. Mostly plumbing, not code.
- [x] **Task 4: Backend spawn hardening.** DONE 2026-07-03 in PR #38
  (`b625a82`). Orphaned uvicorn holding port 8000
  breaks the next launch. Add orphan cleanup + port-collision policy to the
  Electron backend spawn. (Recorded follow-up from plan 003.)

### Phase 3 — Presentability (make the repo sell itself)

- [ ] **Task 5: README demo media.** Add screenshots + a short GIF of the
  review board and timeline. `docs/BRAND_MEDIA_PROMPTS.md` already has the
  asset direction. A video tool with no visuals is invisible.
- [x] **Task 6: Reconcile drifted plan statuses.** DONE 2026-07-03 on branch
  `docs/reconcile-plan-statuses`; `settings-page` reconciled here, while
  `project-sidebar` is intentionally left for the parallel session. The
  `settings-page` plan moved to `done/` after checking the shipped slice
  against its acceptance items.

### Phase 4 — Architecture debt (parallel track, keeps velocity up)

- [x] **Task 7: Execute plan 010** — DONE in PR #35 (2026-07-03); the plans
  README marks plan 010 done. Generate frontend types from backend
  models (kills contract drift). Already fully specified in
  `docs/plans/010-shared-frontend-backend-contract.md`.
- [x] **Task 8: Execute plan 011** — slice 1 DONE in PR #35 (2026-07-03); the
  plans README marks plan 011 slice 1 done. Decompose `api.py`, slice 1.
  Characterization tests first, per the plan.

### Phase 5 — Launch + monetize (after 1–3 are done)

- [ ] **Task 9: Soft launch to the drone niche** (r/drones, drone Discords,
  DJI forums) — collect feedback and testimonials before any general launch.
- [ ] **Task 10: Decide the paid tier** from that feedback. Working
  hypothesis: free MIT core + paid signed "just works" build (bundled ffmpeg,
  updates) at ~$29–59 one-time, with hosted-AI upsell later via the
  `connect-your-ai-mcp` plan.

## Rules of the road

- One task per branch per PR. Never batch phases.
- The implementing Codex session never reviews itself — fresh session or
  `codex review` for step 4.
- Anything Codex claims is done must be backed by the gate commands' actual
  output (see `verification` norms in CONTRIBUTING.md).
- New findings that aren't on this list go to `docs/plans/README.md` as plan
  candidates — don't scope-creep the current task.
