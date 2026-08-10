# Authoritative Timeline and Truthful Export Design

**Date:** 2026-08-10  
**Base:** `b253d0f`  
**Delivery:** two stacked branches

## Problem

The backend owns the Timeline Document, but the main Timeline and Export pages
still project it through `acceptedOrder` and per-Candidate-Clip `trims`. That
projection removes repeated Timeline Items and keeps only the first item's
bounds. It also cannot represent item-specific Speed or Transform. The Export
page then writes this lossy projection back through the legacy timeline update
endpoint before exporting.

This contradicts ADR-0002 (backend-authoritative Timeline Document) and can
make the visible sequence, persisted sequence, and exported sequence disagree.

## Goals

1. Render and edit the visual Timeline from authoritative Timeline Items.
2. Preserve multi-instance items, item-specific bounds, Speed, and Transform.
3. Export the current authoritative Timeline without a legacy pre-export write.
4. Show export clip count, effective duration, file path, and format warnings.
5. Keep Review Board decisions Candidate-Clip-based; this change does not
   redefine inclusion or exclusion semantics.
6. Update all directly affected architecture, user, QA, and plan documentation.

## Delivery Shape

### Branch 1: `fix/authoritative-timeline-items`

The Timeline page and its visual sequence use `timelineItems`. A focused,
pure projection maps each Timeline Item to its source Candidate Clip and derives
its effective duration as `(end_sec - start_sec) / speed`. Item identity uses
`item_id`, so repeated source clips remain separate and selectable.

Timeline operations address `item_id` directly:

- reorder: `reorder`
- trim or extend: `set_bounds`
- remove: `remove_item`
- split: `split_item`
- retime: `set_speed`
- zoom and pan: `set_transform`

The existing `TimelineEditor` remains the detailed controls surface and is
mounted with the visual Timeline. Playback consumes authoritative item bounds.
Speed affects sequence duration and progress mapping; browser playback rate is
applied when the active item changes. Transform values are displayed and
editable, while real-time transformed video rendering remains explicitly out
of scope because the existing plan already tracks that visual-preview work.

`acceptedOrder` and `trims` remain compatibility projections for the Review
Board during this branch. They stop driving the Timeline page.

### Branch 2: `fix/truthful-export`

This branch is based on Branch 1. Export reads `timelineItems` and calls the
backend export endpoint directly. It never calls the legacy `updateTimeline`
endpoint and never writes Timeline state as a side effect of export.

The API client models the complete backend response:

```ts
interface ExportResult {
  project_id: string;
  format: ExportFormat;
  status: string;
  file_path: string;
  clip_count: number;
  total_duration_sec: number;
  warnings: string[];
}
```

The page stores each complete result and presents its file path, clip count,
effective duration, and warnings. The payload inspector shows ordered Timeline
Items including `item_id`, source clip, bounds, Speed, and Transform. EDL
flatten warnings are prominent and persistent with that result, satisfying
ADR-0004. FCPXML and Resolve XML remain encode-or-warn formats as implemented by
the backend.

## State and Data Flow

```text
Backend Timeline Document
  -> ReviewContext.timelineItems
  -> authoritative item projection
     -> Timeline playback and item controls
     -> Export summary and payload inspector
  -> POST /projects/{id}/export
     -> complete ExportResult
     -> result card and warnings
```

No new persistence format or backend mutation path is introduced.

## Error Handling

- Missing Candidate Clip metadata leaves the Timeline Item intact and shows a
  source-ID fallback; it must not silently remove an authoritative item.
- Invalid operations continue through the existing operation API and reconcile
  from the returned snapshot or conflict snapshot.
- Export failures remain visible without discarding earlier successful results.
- Existing-file conflicts retain the explicit overwrite confirmation.
- Clipboard and DaVinci-open failures keep their current non-destructive paths.

## Testing

Branch 1 adds deterministic tests for the pure item projection and browser/E2E
coverage proving:

- two Timeline Items from one Candidate Clip render twice;
- per-item bounds and speed produce the correct effective sequence duration;
- reorder, remove, and trim target `item_id`;
- authoritative SSE reconciliation changes the visible Timeline.

Branch 2 adds client/UI coverage proving:

- export does not call the legacy timeline update endpoint;
- the request exports the current backend document unchanged;
- response metadata is rendered;
- EDL flatten warnings are visible;
- repeated items and Speed/Transform appear in the payload inspector.

Each branch runs frontend typecheck, lint, build, relevant browser tests,
backend tests, and synthetic end-to-end QA. Manual real-footage/NLE checks are
recorded as pending human evidence, never reported as automated proof.

## Documentation and Reports

Directly affected docs are reconciled on the branch that changes behavior:

- `docs/ARCHITECTURE.md`
- `docs/USER_GUIDE.md`
- `docs/QA.md`
- `docs/plans/agent-operable-timeline.md`
- `docs/plans/README.md` when plan status changes

Each branch adds one concise standalone HTML report in `docs/reviews/`. Reports
use semantic HTML and small inline CSS only, remain readable without scripts or
network access, and record scope, behavior, tests, known limits, commit, and
manual QA still required.

## Branch and Review Policy

- Branch 2 is stacked on Branch 1; its pull request should target Branch 1.
- GPT-5.6 Luna at maximum effort implements bounded plans.
- A fresh GPT-5.6 Sol review checks each diff against this design.
- Review findings are fixed and reverified before each branch is pushed.
- No unrelated dependency upgrades, global state rewrite, transitions, audio,
  titles, color, or multi-track work is included.

## Success Criteria

The Timeline displays every authoritative Timeline Item exactly once, including
repeated sources, and all item mutations address the selected `item_id`. Export
performs no preflight Timeline mutation, exports that same ordered document,
and reports all backend metadata and degradation warnings. Automated checks are
green, affected docs match shipped behavior, and both branches are visible on
origin with self-contained HTML reports.
