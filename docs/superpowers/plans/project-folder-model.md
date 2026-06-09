# Plan: Project = Folder On Disk

Status: implemented in `feature/project-folder-model`, pending manual QA
Owner: Elvijs / Codex
Related: `UBIQUITOUS_LANGUAGE.md` (defines **Project**), `docs/PRD.md`

## Problem

A **Project** currently has no concrete on-disk representation. Users want to:

1. Point the app at a folder of drone footage they already organized (e.g. `~/Movies/sunset-drone-footage/`) and have it become a project.
2. Never duplicate footage on disk.
3. Open the same folder in DaVinci Resolve (or FCP) after export and have every clip path resolve on the first try — no relink dialogs.
4. Move or rename the folder later without breaking the project.

The current scaffolding does not commit to copy / symlink / reference semantics, which blocks the **Settings**, **Project Sidebar**, and **Export** workstreams.

## Decision

**A Project is the user-chosen folder itself, in place.** The app writes its working files into a sibling subfolder named `clipassembler/`. No copy, no symlink, no central `AIClipAssembler/Projects/` directory.

## On-Disk Layout

```
~/Movies/sunset-drone-footage/        <- user picks this folder; it IS the project
├── DJI_0042.MP4                      <- Source Videos, untouched
├── DJI_0043.MP4
├── DJI_0044.MP4
├── clipassembler/                    <- app working state, visible (no leading dot)
│   ├── project.json                  <- project metadata + settings overrides
│   ├── samples/                      <- Frame Samples (jpg), regeneratable
│   ├── analysis/                     <- scores, scene cuts, harness outputs (json)
│   └── cache/                        <- ffmpeg scratch, safe to delete
└── exports/                          <- visible to user, this is what DaVinci opens
    ├── davinci/sunset-drone.xml      <- references "../DJI_0042.MP4" (relative)
    ├── fcp/sunset-drone.fcpxml
    └── edl/sunset-drone.edl
```

### Why visible `clipassembler/` (no dot)

- User explicitly chose visible over hidden so the project state is discoverable in Finder.
- Trade-off: folder looks slightly more cluttered. Acceptable.

### Why exports live next to footage

DaVinci Resolve and Final Cut both resolve relative media paths from the timeline file's directory. With `exports/davinci/sunset-drone.xml` referencing `../../DJI_0042.MP4`, opening the timeline triggers zero relink prompts. This is the single biggest UX win in the whole plan.

## Lifecycle

### Create Project

1. User clicks **Create Project** -> native folder picker.
2. App scans the chosen folder (non-recursive by default) for `.mp4` / `.mov` / `.mkv`.
3. If zero videos found -> show error, suggest a different folder.
4. If `clipassembler/project.json` already exists -> treat as **Open**, do not overwrite.
5. Otherwise create `clipassembler/project.json` with:
   - `name` (defaulted to folder basename, user-editable)
   - `created_at`
   - `harness` (default `pi_agent` per current product decision)
   - `source_videos` (list of relative filenames discovered)
6. Kick off analysis pipeline -> writes to `clipassembler/samples/` and `clipassembler/analysis/`.

### Open Project

- Same picker. If `clipassembler/project.json` exists, load it. Otherwise prompt "this folder is not a project, create one?"

### Recent Projects (sidebar source)

- Maintain a separate list in app-data (e.g. `~/Library/Application Support/AIClipAssembler/recent.json`) holding absolute paths + last-opened timestamps. The sidebar reads from this; it is NOT the source of truth — the folder is.
- On open, if the folder has moved (path missing) -> mark as missing, offer "locate folder".

### Export

- Writes into `<project>/exports/<format>/` using paths relative to the timeline file.
- Overwrites previous export of same name (warn first).
- Never writes outside the project folder.

### Delete Project

- "Remove from list" -> only forgets the path in recents.
- "Delete project files" -> deletes only `clipassembler/` and `exports/`. **Never** touches the user's video files.

## Edge Cases

| Case | Behavior |
|---|---|
| User picks a folder that's already a project | Open it, don't re-init |
| User picks a folder with no videos | Friendly error, no folder mutation |
| User moves the folder after creating it | Recents list shows "missing", "locate" picker resolves it |
| Folder is in iCloud Drive / Dropbox / OneDrive | Write `clipassembler/cache/.nosync` (macOS Photos / iCloud convention) and a sync-exclude marker; document for Windows users |
| Two videos with same basename in different subfolders | MVP: non-recursive scan only. Defer recursive handling. |
| User adds a new video to the folder after import | Provide a **Rescan** action in the sidebar; do not auto-watch (battery/CPU). |
| `clipassembler/` deleted while app is running | On next save, detect missing dir and re-create; warn the user that analysis cache was lost. |
| Read-only folder (e.g. SD card) | Refuse to create project; suggest copying footage to a writable location first. |

## `project.json` Schema (v1)

```json
{
  "schema_version": 1,
  "name": "Sunset Drone Footage",
  "created_at": "2026-05-30T19:00:00Z",
  "harness": "pi_agent",
  "source_videos": [
    { "filename": "DJI_0042.MP4", "imported_at": "2026-05-30T19:00:01Z" }
  ],
  "settings_overrides": {}
}
```

- `source_videos[].filename` is **relative to the project folder**. Never absolute. This is what makes the folder portable.
- `settings_overrides` is the per-project escape hatch from global settings (the future Settings page writes globals; this object overrides them).

## Out Of Scope (Follow-ups)

These depend on the model above but are separate workstreams:

1. **Project Sidebar UI** — reads from `recent.json`, opens projects.
2. **Settings page** — globals in app-data, per-project in `project.json::settings_overrides`.
3. **QA test flows** — extend `docs/MANUAL_QA_GUIDE.md` with: create-from-folder, export-and-open-in-DaVinci, move-folder-and-relocate.
4. **UI polish / React Doctor cleanup** — separate; `npx react-doctor@latest` currently reports score 89/100, 39 issues. Address as its own pass.
5. **Recursive folder scan** — defer until users actually nest footage.
6. **Project templates / starter folders** — defer.

## Open Questions

1. Should we offer a "Pack Project" zip command (project.json + analysis, excluding video) for sharing analysis without footage?
2. On Windows / Linux, what's the equivalent of macOS `.nosync` for the major sync services? Worth research before implementation.
3. Should the app refuse to operate on folders under `/System`, `/Applications`, etc.? Probably yes — define the deny-list.
4. Per-project harness override (`project.json::harness`) vs global default — confirm UX: does picking a harness per project make sense, or is it always global?

## Implementation Sketch (Phases)

Each phase should be a separate PR / ready-for-agent issue:

1. **Backend: project loader/writer** — `project.json` read/write, folder-scan, schema validation, idempotent create. Pure Python, unit-tested. **Done in branch.**
2. **Backend: relocate analysis output** — move whatever the current pipeline writes into `clipassembler/samples/` and `clipassembler/analysis/`. **Done in branch for folder-backed projects.**
3. **Backend: exports write inside project folder** — change export endpoints to take a project, not arbitrary paths. **Done in branch for EDL/FCPXML folder-backed exports.**
4. **Frontend: Create / Open Project flow** — Electron folder picker, `recent.json` in app-data, sidebar entry. **Done in branch.**
5. **Frontend: project-scoped views** — current drone-video workflow becomes "the open project's view". **Done in branch.** The app starts with no open project; legacy upload is available as an explicit fallback.
6. **Docs: extend `MANUAL_QA_GUIDE.md`** with the three flows above. **Done in branch.**

Phases 1-3 can land before any frontend change; the existing UI keeps working against a single implicit project during the migration.

## Branch Implementation Status

Current branch: `feature/project-folder-model`

Implemented:

- `backend/src/project_store.py` with `ProjectManifest`, `ProjectSourceVideo`, `create_project`, `open_project`, and `create_or_open_project`.
- Non-recursive top-level scan for `.mp4`, `.mov`, and `.mkv`.
- `clipassembler/project.json`, `samples/`, `analysis/`, and `cache/` creation.
- Schema validation for version `1` and top-level relative source filenames.
- `POST /projects/from-folder`.
- Folder-backed analysis output paths:
  - `<project>/clipassembler/samples/<source-video>/`
  - `<project>/clipassembler/analysis/motion/<source-video>.trf`
- Folder-backed export paths:
  - `<project>/exports/edl/timeline.edl`
  - `<project>/exports/fcp/timeline.fcpxml`
- FCPXML source media references relative to the export directory, e.g. `../../DJI_0042.MP4`.
- Electron folder picker.
- App-data `recent.json`.
- Project Sidebar with recent projects, missing-folder state, locate, remove-from-list, rescan, and delete-project-files actions.
- No-project startup state with explicit legacy upload fallback.
- Rescan flow for newly added top-level source videos.
- Delete-project-files flow that removes only `clipassembler/` and `exports/`.
- Unsafe folder deny-list for `/System` and `/Applications`.
- `clipassembler/cache/.nosync` creation.
- Export overwrite guard and frontend confirmation.
- Manual QA guide coverage for create/open folder, export paths, empty-folder behavior, and move-folder reopen.

Added later on `t3code/190b754e`:

- Analysis results + saved timeline persisted to `clipassembler/analysis/results.json`; re-opening a folder project restores candidate clips, accepted order, and trims (backend restore + `GET /projects/{id}/timeline` + frontend session restore).
- DaVinci Resolve export (`format=resolve_xml`) writing FCP7 XMEML v5 to `<project>/exports/davinci/timeline.xml` with relative `pathurl`s.
- Folder-project videos are ffprobed on open, so exports use real fps/resolution (previously `metadata: None` crashed FCPXML export for folder projects).
- Rescan no longer discards existing clips/timeline; re-analyze to cover new footage.
- Self-contained end-to-end check: `scripts/synthetic_e2e_qa.py`.

Verified:

- Backend: `PYTHONPATH=. .venv/bin/pytest` passes with 101 tests.
- Frontend: `npm run build` passes.

## Remaining Manual QA Before Complete

The implementation work is complete, but the plan should not be marked
`complete` until real-footage QA has been run:

1. Run the documented folder-project QA flow with real footage.
2. Verify source videos are not copied.
3. Verify `clipassembler/`, `clipassembler/cache/.nosync`, and `exports/` are created in the chosen folder.
4. Verify adding a new top-level video and clicking **Rescan** updates `project.json`.
5. Verify moving/renaming a recent project folder shows missing state and can be recovered with **Locate**.
6. Verify **Remove** only removes a recent-project entry.
7. Verify **Delete project files** deletes only `clipassembler/` and `exports/`.
8. Verify exporting twice shows an overwrite warning.
9. Import generated EDL/FCPXML into DaVinci Resolve or Final Cut Pro and confirm media resolves without relink prompts.
