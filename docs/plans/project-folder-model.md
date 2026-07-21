# Plan: Project = Folder On Disk

**Status: implementation and automated QA complete; pending real-footage/manual app QA.**
Owner: Elvijs / Codex. Related: `UBIQUITOUS_LANGUAGE.md` (defines Project), `docs/PRD.md`.

## Problem

A Project had no concrete on-disk representation. Users want to point the app at an existing folder of drone footage, never duplicate footage, open the exported timeline in DaVinci/FCP with zero relink prompts, and be able to move/rename the folder later without breaking the project.

## Decision

**A Project is the user-chosen folder itself, in place** — no copy, no symlink, no central `AIClipAssembler/Projects/` directory. The app writes working files into a visible sibling subfolder `clipassembler/` (project.json, samples/, analysis/, cache/); exports land in a visible `exports/` folder next to the source footage.

**Why visible `clipassembler/` (no leading dot):** user explicitly chose visible over hidden so project state is discoverable in Finder — accepted trade-off of slightly more clutter.

**Why exports live next to footage:** DaVinci/FCP resolve relative media paths from the timeline file's directory; with `exports/davinci/x.xml` referencing `../../DJI_0042.MP4`, opening triggers zero relink prompts. This was called out as the single biggest UX win in the whole plan.

`source_videos[].filename` in `project.json` is always relative to the project folder (never absolute) — this is what makes the folder portable across machines/drives.

## Notable edge-case decisions

Non-recursive scan only (MVP); recursive scan deferred. iCloud/Dropbox/OneDrive folders get a `clipassembler/cache/.nosync` marker (macOS convention) — Windows equivalent left as an open question. Read-only folders (e.g. SD cards) are refused outright rather than supported. "Delete project files" only ever removes `clipassembler/` and `exports/` — never touches user video files. Recents list (`recent.json` in app-data) is explicitly NOT the source of truth — the folder is; a missing folder shows "locate" recovery.

## Implementation status (branch `feature/project-folder-model`)

All 6 phases done in branch: backend project loader/writer, relocated analysis output paths, folder-scoped exports (EDL/FCPXML/DaVinci XML with relative paths), frontend create/open flow + sidebar, project-scoped views (app starts with no open project; legacy upload is an explicit fallback), MANUAL_QA_GUIDE.md extended. Later (`t3code/190b754e`): analysis + saved timeline persisted to `clipassembler/analysis/results.json` so reopening restores state; DaVinci XMEML v5 export added; folder-project videos are ffprobed on open (fixes a crash where `metadata: None` broke FCPXML export); rescan no longer discards existing clips/timeline.

**Verified:** backend 131 tests pass; frontend typecheck/build pass; Playwright e2e passes; `scripts/synthetic_e2e_qa.py` passes full folder→export→reopen cycle.

## Remaining before this plan can move to done/

Real-footage/manual QA has **not** run: verify no-copy behavior, `clipassembler/`/`.nosync`/`exports/` creation, rescan, move/locate recovery, remove-vs-delete semantics, overwrite warning, and — critically — import into real DaVinci Resolve/FCP with zero relink prompts.

## Open questions (unresolved)

"Pack Project" zip export (analysis without footage)? Windows/Linux `.nosync` equivalent? Deny-list for `/System`, `/Applications` etc. (implemented for macOS system dirs; cross-platform equivalents undecided)? Per-project harness override UX vs. always-global — unresolved.
