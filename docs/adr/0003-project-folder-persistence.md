# 0003: Projects persist as folders with JSON and FFmpeg-derived metadata

## Status

Accepted.

## Context

Local-first storage rules out a database service, and drone/action-footage
Editors already organize raw files into folders on disk. The app needed a
persistence model that keeps a Project portable — movable or renamed without
breaking it — and lets exported timelines resolve back to the original media
with zero relink prompts in DaVinci Resolve or Final Cut Pro.

## Decision

A Project is the user-chosen folder itself, in place: no copy, no symlink,
and no central managed-projects directory. The app writes working state into
a visible sibling subfolder, `clipassembler/` (`project.json`, samples,
analysis, cache), all as JSON plus FFmpeg-derived media metadata rather than a
database. `source_videos` filenames are stored relative to the project
folder, which is what keeps the folder portable. Exports are written next to
the footage in `exports/<format>/` using paths relative to the export file.

## Consequences

- Moving or renaming the project folder does not break the project, as long
  as the internal relative layout between Source Videos, `clipassembler/`,
  and `exports/` is preserved.
- There is no database to fall back on for atomicity guarantees: write
  failures (unwritable folder, missing `clipassembler/` directory, invalid
  manifest) must be surfaced to the Editor or handled deliberately, never
  silently treated as a durable save.
- Recents/sidebar state is a cache of folder paths, not the source of truth;
  the folder on disk always is.

## References

- [docs/plans/project-folder-model.md](../plans/project-folder-model.md)
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — Tech stack, Persistence/migration
- `backend/src/project_store.py` — `ProjectStoreError` and subclasses
