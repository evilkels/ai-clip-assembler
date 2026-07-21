# Plan 017: Review-page clarity and polish

Status: Step 1 DONE (2026-07-20); Steps 2–6 TODO. Priority P1, effort M
(L with design-system adoption), risk LOW/MED. Planned at `6fc6c6d`; depends
on plans 012, 016, and `ui-polish-modern-shell.md`.

## Goal and diagnosis

Make Candidate Clips discoverable and explain Suggested cuts, clip-generation
controls, include/exclude, and the Working Timeline. Live testing found clips
buried in a collapsed last panel, developer-facing generation copy, two
confusing smoothness controls, and excluded clips still entering AI proposals.

## Delivered — Step 1

- Reordered Review to Suggested cuts → Browse your clips → Advanced knobs.
- Reframed generation controls in plain language and made browsing actionable.
- Excluded clip IDs now leave the review agent's candidate pool via
  `_review_inputs`; covered by `test_excluded_clips_are_hidden_from_the_review_agent`.
- Verified 363 backend tests, ruff, TypeScript, ESLint, and dev-app HMR.

## Remaining work

1. **Poster-first cards:** reuse sampled frame JPEGs, render `<img>`, and mount
   `<video>` only on first play. Then open Browse by default or virtualize it.
   This avoids the documented N×metadata-stream jank around 24 clips.
2. **One smoothness model:** remove the view-only filter or label it so clearly
   that it cannot be confused with the generation threshold.
3. **Included means preferred:** pass included IDs into review generation and
   bias deterministic versions and the prompt; excluded remains a hard veto.
4. **Onboarding:** one dismissible, project-persisted explainer for Suggested
   cuts, Candidate Clips, and Working Timeline using ubiquitous language.
5. **Design-system adoption:** after the behavioral work, migrate the Review
   shell using the separate modern-shell plan.

## Verification and constraints

- Poster work must reuse existing samples, not rerun FFmpeg. Manually verify a
  24-clip Electron project has no multi-stream stutter.
- Backend: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q && .venv/bin/ruff check src tests`.
- Frontend: `cd frontend && npm run typecheck && npm run lint:frontend`.
- Add focused backend tests for preference semantics and preserve generated
  frontend contract freshness. Stop if drift makes cited behavior unrecognizable.
