# AGENTS.md — AI Clip Assembler

Local-first desktop video editor: Electron + React in `frontend/`, FastAPI +
Python in `backend/`. Order of work: `docs/ROADMAP.md`. Vocabulary: `GLOSSARY.md`. System design:
`docs/ARCHITECTURE.md`. Harness contract: `docs/HARNESS_SPEC.md`. Docs map:
`docs/index.md`.

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
- E2E coverage and run commands: `frontend/e2e/README.md`.
- Releases: `docs/UPDATING.md`.
- Specs go in `docs/specs/`, review records in `docs/reviews/`, mockups in
  `docs/designs/`. A tool that writes plans to `plans/` or
  `docs/superpowers/plans/` gets them merged into `docs/plans/`.
- Tool scratch folders (`.superpowers/`, SDD ledgers, implementer reports,
  delegation briefs) are git-ignored and never committed. Delegated work is
  tracked as tasks in its `docs/plans/` plan; a record worth keeping goes in
  `docs/reviews/`.

## Docs (OKF)

`docs/` is an OKF v0.2 bundle using the types in Ernesto's vault
(`~/ernesto-os/_system/types/`: Plan, Spec, Review, Decision, Note).
Every `.md` in `docs/` starts with frontmatter: `type`, `title`,
`description`, `status`; plans add `plan_status`, decisions add
`decision_status`; `created` is optional. Standard relative markdown links
only. Before committing docs changes run
`python3 ~/ernesto-os/tools/okf.py validate --root .`.
Vault page for this repo: `~/ernesto-os/10-projects/ai-clip-assembler/ai-clip-assembler-code.md`.
