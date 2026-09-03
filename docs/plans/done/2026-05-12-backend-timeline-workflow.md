# Backend Timeline Workflow Implementation Plan

**Status: implemented and verified.**

**Goal:** Add backend timeline replacement and export behavior matching the PRD's editable timeline workflow for drone-video testing.

**Architecture decision:** Keep analyzed clips as an immutable suggestion catalog, and store a *separate* ordered export timeline with trimmed timings. Export reads the edited timeline when present; analysis still seeds the default sequence for projects that haven't been manually edited yet. This split (suggestions vs. edited timeline) is the key design choice — it lets re-analysis and manual edits coexist without clobbering each other.

## What shipped

- `PUT /projects/{project_id}/timeline` — full timeline replacement, taking an ordered list of `{clip_id, start_sec, end_sec, included}`; rejects unknown `clip_id`s with 422.
- `clips_in_timeline_order(project)` helper so export reads edited order/trims instead of raw analyzed clips.
- Export response enriched with `clip_count` and `total_duration_sec`.
- Later project-folder work (see `project-folder-model.md`, now in this folder) persists and restores this saved timeline across reopen.

## Status

Current merged backend verification passes with 131 tests. Frontend typecheck and build pass. PR referenced issues `#10` (left open) and `#19` (not closed without full acceptance validation).
