# PR #62 Pocock Review

Reviewed `git diff main...f38b8d1` and `git log main..f38b8d1 --oneline`.
The requested authoritative design is checked in at
`docs/specs/2026-08-10-authoritative-timeline-and-export-design.md`.

## Standards

- **Hard — plan index/status:** The hunk adds Plan 022 with
  `> **Status:** TODO`, but adds no Plan 022 row to `docs/plans/README.md`.
  This violates `AGENTS.md`'s rule that plan indexes and statuses live in
  `docs/plans/README.md` (with completed plans in `docs/plans/done/`). Reconcile
  the implemented plan's status and index entry.
- **Hard — scope:** One diff adds CI (`.github/workflows/test.yml: "name: Tests"`),
  authoritative Timeline/Export changes, and shell/recents/update UI. That
  conflicts with `CONTRIBUTING.md`: “Keep changes scoped to one problem” and
  “Keep modules focused and avoid unrelated refactors.” Deliver these as focused
  PRs/branches.
- **Judgement — possible Duplicated Code:** `ProjectHeader.tsx` adds
  `function basename(path) { return path.split(/[\\/]/)… }`, duplicating
  `projectSort.ts`. Share the display-name resolver so the header, sidebar, and
  sort use one legacy-recent fallback.
- **Judgement — possible Duplicated Code:** Timeline duration is repeated as
  `const duration = (trimEnd - trimStart) / item.speed` (`Timeline.tsx`),
  `sum + Math.max(0, (item.end_sec - item.start_sec) / item.speed)`
  (`routes/Timeline.tsx`), and `sum + (item.end_sec - item.start_sec) /
  item.speed` (`routes/Export.tsx`). A shared Timeline Item duration helper
  would make the clamp policy explicit.

## Spec

- **Missing:** Plan 022 requires renaming to affect the “**recents label only**”
  and to “**Say so in the UI copy**”
  (`docs/plans/022-project-shell-header-and-sidebar.md:14-15`). The new editor
  only says “Project name”; it never explains that folder, manifest, and backend
  stay untouched.
- **Partial:** The timeline/export design says “**Delivery: two stacked
  branches**” (`docs/specs/2026-08-10-authoritative-timeline-and-export-design.md:5`)
  and “Branch 2 … should target Branch 1”
  (`docs/specs/2026-08-10-authoritative-timeline-and-export-design.md:148`).
  PR #62 instead targets `main` from the combined branch.
- **Scope creep:** Plan 022 says not to modify `updateCheck.ts`, `UpdateSection.tsx`,
  or their tests beyond the shell-grid need
  (`docs/plans/022-project-shell-header-and-sidebar.md:16-17`), but the diff adds
  the Settings update section, “Check now,” and single-flight checker behavior.
- **Implemented wrong:** The required display name is
  `name ?? basename(folderPath)`
  (`docs/plans/022-project-shell-header-and-sidebar.md:105-108`), but
  `ProjectHeader` uses `recentProject?.name ?? projectName ?? basename(...)`; an
  unnamed legacy recent can therefore disagree with the sidebar.

Summary: Standards 4 findings (worst: mixed independent delivery scope); Spec 4 findings (worst: required stacked delivery replaced by a combined main-target PR).
