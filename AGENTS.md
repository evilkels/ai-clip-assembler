# AGENTS.md — AI Clip Assembler

Local-first desktop video editor: Electron + React in `frontend/`, FastAPI +
Python in `backend/`. Vocabulary: `GLOSSARY.md`. System design:
`docs/ARCHITECTURE.md`. Harness contract: `docs/HARNESS_SPEC.md`. Docs map:
`docs/README.md`.

## Agent skills

### Issue tracker

Plans in `docs/plans/` are the tracker; GitHub Issues are only the inbox for
outside reports. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary, on inbox issues only. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at root + `docs/adr/`. See `docs/agents/domain.md`.

## Working here

- `main` accepts only merged PRs: branch, PR, merge, then tag.
- The PR gate is `.github/workflows/test.yml`; its `npm run` scripts run the
  same checks locally from `frontend/`.
- Releases: `docs/UPDATING.md`.
- Specs go in `docs/specs/`, review records in `docs/reviews/`, mockups in
  `docs/designs/`. A tool that writes plans to `plans/` or
  `docs/superpowers/plans/` gets them merged into `docs/plans/`.
