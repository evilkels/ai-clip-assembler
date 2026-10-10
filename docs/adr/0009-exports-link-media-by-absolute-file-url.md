# 0009: Exports link media by absolute file URL

## Status

Accepted (2026-10-08).

## Context

Folder-project exports used paths relative to the export file. FCPXML requires
a file URL for its media source, and Resolve displayed a relink dialog for the
relative XMEML path. Absolute URLs also make the move behavior explicit: moving
a project folder breaks links in an export already created from that folder.

## Decision

- FCPXML media sources use absolute `file:///…` URLs.
- Resolve XMEML media paths use absolute `file://localhost/…` URLs, matching
  the form defined by FCP7 XML and written by Resolve.
- After moving a project folder, reopen it in the app and export again so the
  generated URLs point to the media's new location.

## Consequences

- Existing exports stop resolving media after their project folder moves.
- Folder-project portability QA is Flow C, tracked as H4 in
  [plan 032](../plans/032-valid-fcpxml-and-nle-verification.md).
- The folder-project plan's rationale for placing exports next to footage is
  discoverability; export location no longer makes the media links portable.
