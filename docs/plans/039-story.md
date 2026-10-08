# 039: Story in the edit

The Editor and the In-App Review Agent put Markers (a note pinned to a moment)
and Story Sections (named runs of Timeline Items) on the Timeline; they survive
undo, show on the Timeline page, and export as markers to DaVinci Resolve and
Final Cut Pro.

## Context

Roadmap milestone 5 ([../ROADMAP.md](../ROADMAP.md)); terms from
[GLOSSARY.md](../../GLOSSARY.md) (Marker, Story Section). Owner decisions:
Markers and Story Sections are in v1.0.0; exports must pass in Resolve and
Final Cut with absolute media paths; EDL is best-effort. Depends on
[review-visual-editing](review-visual-editing.md) (the AI loop that will write
these Operations) and, for Phase 5, on
[032](032-valid-fcpxml-and-nle-verification.md) Phases 1–4 (valid FCPXML
structure, rational timing, absolute `file://` paths). Phase 5 touches the
same functions 032 rewrites (`generate_fcpxml`, `generate_resolve_xml`,
`generate_edl` in `backend/src/export_engine.py`, and
`clips_from_timeline_document` in `backend/src/api.py:1824`), so it starts
only after 032's code phases are merged and reuses 032's time helpers.

Today there is no marker or section concept anywhere: `TimelineDocument`
(`backend/src/models.py:235`) holds items, profile, target duration and
decisions; the Timeline page (`frontend/src/renderer/src/components/Timeline.tsx:712`)
has one ruler and one clip track; exports carry items only.

### Decisions

- **D1 Markers are anchored to a Timeline Item.** `Marker {marker_id,
  item_id, source_sec, name (1–60 chars), note (≤ 500 chars, may be empty),
  color, author: "editor" | "agent"}` in `TimelineDocument.markers`.
  `source_sec` is a source time inside the item's bounds. The timeline
  position is derived: the item's offset plus `(source_sec − start_sec) /
  speed`. Reason: a note about a moment of footage should follow that footage
  through reorder, trim and speed changes, and FCPXML markers are
  clip-relative anyway. Timeline-relative seconds were rejected: a reorder
  would leave notes on the wrong shots.
- **D2 Integrity is handled inside the existing Operations.** `remove_item`,
  `exclude`, `reset_decision` and `replace_timeline` drop the markers of the
  items they remove; `split_item` moves each marker to the half that contains
  it (a marker exactly at `at_sec` goes to the second half); `set_bounds`
  drops markers that fall outside the new bounds and the Proposal change-list
  line ends with `(1 marker dropped)`; `reorder`, `set_speed`,
  `set_transform` leave markers alone. All of this is one Operation, so undo
  restores markers with the item.
- **D3 A Story Section is a tag on the item.** `TimelineItem.section:
  Optional[StorySection {name (1–40 chars), color}]`. A Story Section as the
  Editor sees it is a maximal run of consecutive items with the same section
  name. Reason: no registry, no section ids to dangle when items are removed
  or reordered, nothing extra to undo. Renaming is one `set_story_section`
  over the run's items. Two runs with the same name are two bands with the
  same label; the UI does not forbid it.
- **D4 Colours.** `Color = Literal["blue", "cyan", "green", "yellow", "red",
  "pink", "purple", "sand"]`, the first eight of Resolve's marker colours.
  Defaults: Editor markers and sections `blue`; agent markers `purple` so the
  Editor can tell them apart. Code identifiers use `color`.
- **D5 Operations** in `timeline_ops.OPERATIONS`, each validated before any
  mutation, each one undo step through the existing `TimelineController`:
  `add_marker {item_id, source_sec, name, note="", color="blue",
  author="editor"}`, `move_marker {marker_id, source_sec, item_id=None}`
  (`item_id` moves it to another item), `edit_marker {marker_id, name=None,
  note=None, color=None}`, `remove_marker {marker_id}`,
  `set_story_section {item_ids, name, color="blue"}`,
  `clear_story_section {item_ids}`. Marker ids come from the same seeded
  allocator as item ids (`seeded_item_ids`, `timeline_ops.py:96`), so a
  Script's markers replay identically on Apply. Errors: unknown item or
  marker, `source_sec` outside the item, empty name, unknown colour, empty
  `item_ids`.
- **D6 Script API** (added to `BINDINGS` in `timeline_script.py`, same
  conventions: 1-based positions, source seconds, handles read live):
  - `timeline:markers() -> {Marker}`; `item:markers() -> {Marker}` (reads).
  - `item:add_marker(at_sec, name [, { note=, color= }]) -> Marker` records
    `add_marker`.
  - Marker handle: `marker:id()`, `marker:item() -> Item`, `marker:at() ->
    seconds`, `marker:name()`, `marker:note()`, `marker:color()` (reads);
    `marker:move(at_sec [, item])` records `move_marker`; `marker:edit{ name=,
    note=, color= }` records `edit_marker` (fields left out keep their value,
    like `reframe`); `marker:remove()` records `remove_marker` and kills the
    handle.
  - `item:section() -> { name, color } | nil` (read); `item:set_section(name
    [, color])` records `set_story_section` for that item;
    `item:clear_section()` records `clear_story_section`.
  - `timeline:set_section(from, to, name [, color])` records one
    `set_story_section` for items `from..to` inclusive;
    `timeline:sections() -> {{ name, color, first, last }}` lists the runs.
  - Marker tables returned by `markers()` are handles, not plain tables, so
    `for _, m in ipairs(item:markers()) do m:remove() end` works.
- **D7 Timeline UI.** In `Timeline.tsx`, between the ruler and the clip
  blocks: a **sections band** (one coloured bar per run, name inside, click
  opens a popover with name, colour and **Clear section**) and a **markers
  lane** (one flag per marker at its derived position, filled with its colour,
  name on hover; click selects and opens a popover with name, note, colour,
  **Delete**; drag moves it within its item). Adding: **Add marker** in the
  inspector (`TimelineEditor.tsx`) at the playhead inside the selected item,
  and double-click on a clip block at that position. **Set section** in the
  inspector for the selected item: a name field with the existing names as
  suggestions and the colour picker; it applies to the selected item and
  every following item that has no section until the next section starts, so
  one click after Apply usually names a whole run. All through
  `applyTimelineOperation` (`ReviewContext.tsx:208`). Test ids:
  `timeline-marker`, `timeline-section`, `marker-popover`, `section-popover`.
- **D8 How the Review Agent is told.** The Timeline record from
  review-visual-editing gains `section` per item and a `markers` list; the
  prompt's story-cut brief says: when you build a story cut, name its parts
  with `timeline:set_section` (the names in the Editor's request, otherwise
  open / journey / reveal / close), and leave a Marker where the Editor should
  look (why a shot was chosen, a weak join), at most one marker per item and
  ten per Script; never remove the Editor's markers unless asked. The agent
  policy enforces the two limits as operation errors (`more than 10 markers in
  one script`). `_describe` in `review_agent.py` renders the new Operations
  (`Mark item 3 (DJI_0034.MP4) at 12.0 s: "reveal"`, `Name items 1–3 "open"`).
- **D9 Export mapping.** Times use the helpers 032 lands.
  - **FCPXML** (`generate_fcpxml`): a Marker becomes `<marker start=…
    duration=<one frame> value="name" note="note"/>` inside its item's
    `asset-clip`, `start` in the clip's own time base (the same base as the
    `asset-clip` `start` attribute). A Story Section becomes `<chapter-marker
    start=… duration=<one frame> value="name" posterOffset="0s"/>` on the
    run's first `asset-clip` and `<keyword start=<clip start> duration=<clip
    duration> value="name"/>` on every `asset-clip` of the run, so the range
    shows in Final Cut's keyword index. These children go after `timeMap` and
    `adjust-transform`, in the order marker, chapter-marker, keyword, which is
    the order 032's DTD check accepts. Colour has no FCPXML representation and
    is dropped; the User Guide says so.
  - **Resolve XML** (`generate_resolve_xml`): sequence-level `<marker>`
    children after `<media>`: a Marker is `<marker><name>…</name>
    <comment>…</comment><in>F</in><out>-1</out></marker>` at the derived
    record frame; a Story Section is the same with `<in>` and `<out>` at the
    run's record frames (a duration marker). No `<color>` child is emitted:
    Resolve's XMEML colour support is unverified, and H1 notes whether colour
    is missed.
  - **EDL** (`generate_edl`): after the events, one `* LOC: HH:MM:SS:FF COLOR
    name` line per Marker at its record timecode, colour upper-cased, and one
    per Story Section at the run's start with the name `[Section] name`, the
    form Resolve's "Import Timeline Markers from EDL" reads. Best-effort; no
    warning when a marker cannot be placed (none are expected).
  - `clips_from_timeline_document` adds `item_id`, `section` and `markers`
    (with derived `record_sec`) to each clip dict; `export_timeline` passes
    the document's markers to the generators.
- **D10 Document version 3.** `TIMELINE_DOCUMENT_VERSION = 3`; the new fields
  default to empty, so version 2 files load unchanged; `write_timeline_document`
  writes version 3.

## Phase 1: Data model and Operations

- [ ] 1.1 Models: `Color`, `Marker`, `StorySection`, `TimelineItem.section`,
  `TimelineDocument.markers`, version 3 (D1, D3, D4, D10); `npm run gen:types`.
  Done when `backend/tests/test_project_store.py::test_version_2_document_loads_with_empty_markers`
  passes and `check:types-fresh` is clean.
- [ ] 1.2 Marker Operations `add_marker`, `move_marker`, `edit_marker`,
  `remove_marker` in `timeline_ops.py` with the D5 validation and seeded ids.
  Done when `test_timeline_ops.py` has one passing test per Operation plus
  `test_add_marker_rejects_source_sec_outside_the_item`,
  `test_marker_ids_are_seeded_like_item_ids`.
- [ ] 1.3 `set_story_section`, `clear_story_section` per D5. Done when
  `test_set_story_section_tags_each_listed_item` and
  `test_clear_story_section_on_untagged_items_is_a_no_op` pass.
- [ ] 1.4 Integrity in existing Operations per D2. Done when these pass:
  `test_remove_item_drops_its_markers`, `test_split_moves_markers_to_the_half_that_contains_them`,
  `test_set_bounds_drops_markers_outside_the_new_bounds`,
  `test_exclude_and_replace_timeline_drop_markers`,
  `test_reorder_and_speed_keep_markers`.
- [ ] 1.5 Undo covers markers and sections through the unchanged controller.
  Done when `test_api.py::test_marker_and_section_ops_undo_and_redo` passes
  (add marker, set section, undo twice, redo twice, document equal at each
  step ignoring `revision`, which undo and redo advance) and the MCP tool list exposes the six Operations
  (`test_mcp_server.py::test_marker_operations_are_listed`).
- [ ] 1.6 `_describe` lines for the six Operations and the `(n markers
  dropped)` suffix on trims (D2, D8). Done when
  `test_review_agent.py::test_change_list_describes_markers_and_sections`
  passes.

## Phase 2: Script API

- [ ] 2.1 Marker handle (`MARKER` table, `wrap_marker`) and the reads in D6.
  Done when `test_timeline_script.py::test_markers_read_live_and_are_handles`
  passes.
- [ ] 2.2 `item:add_marker`, `marker:move`, `marker:edit`, `marker:remove`
  record their Operations with 0-based-free args (ids and seconds only).
  Done when one test per call asserts the recorded Operation and
  `test_marker_recording_replays_identically` passes through `apply_batch`
  with the same seed.
- [ ] 2.3 `item:section`, `item:set_section`, `item:clear_section`,
  `timeline:set_section(from, to, …)`, `timeline:sections()`. Done when
  `test_set_section_over_a_range_records_one_operation` and
  `test_sections_lists_runs_in_order` pass.
- [ ] 2.4 Agent policy limits per D8 (one marker per item, ten per Script).
  Done when `test_agent_policy_caps_markers` passes and the Editor policy has
  no cap.
- [ ] 2.5 API reference and User Guide: the new calls appear in
  `API_REFERENCE` from `BINDINGS`; `docs/USER_GUIDE.md` "Scripting in Review"
  gains a fourth worked example (`name the first three shots "open" and mark
  the reveal`), executable by `test_user_guide_scripts.py`. Done when
  `test_api_reference_names_exactly_what_the_runtime_exposes` and the guide
  test pass.

## Phase 3: Timeline UI

- [ ] 3.1 Derived positions: `projectTimelineItems`
  (`frontend/src/renderer/src/lib/timelineProjection.ts:57`) returns each
  item's section and its markers with `timeline_sec` (the renderer has no unit
  runner; `test:main` covers the main process only). Done when 3.5's e2e
  asserts the flag's `left` offset for a marker on a 2× item equals the
  derived position.
- [ ] 3.2 Sections band and markers lane in `Timeline.tsx` per D7, including
  the two popovers. Done when `e2e/timeline-markers.spec.ts` (3.5) sees
  `timeline-section` and `timeline-marker` with the right names and colours
  after seeding the document through `POST /timeline/op`.
- [ ] 3.3 Add and edit: inspector **Add marker** and **Set section**, clip
  double-click, popover edit/delete/clear, drag to move (sends `move_marker`
  once on drop). Done when the e2e adds a marker at the playhead, renames it,
  drags it, deletes it, names a section and clears it, each reflected by
  `GET /timeline/document`.
- [ ] 3.4 Undo/Redo buttons on the Timeline page restore markers and sections
  (no new code expected; `Timeline.tsx` re-reads the document on
  `timeline-changed`). Done when the e2e asserts one Undo removes the last
  added marker and Redo brings it back.
- [ ] 3.5 `e2e/timeline-markers.spec.ts` covering 3.1–3.4 and the Review
  Proposal card showing marker lines from an agent Script (fake engine). Done
  when it passes in CI and has a row in `frontend/e2e/README.md`.
- [ ] 3.6 Visual conformance: the band and lane in both themes added to
  `e2e/visual-conformance.spec.ts` with macOS baselines cut by the controller.
  Done when the Linux baselines are updated by the
  `Update Linux visual baselines` workflow and the spec is green.

## Phase 4: The Review Agent uses them

- [ ] 4.1 Timeline record gains `section` and `markers` (D8) in
  `review_evidence.py`. Done when
  `test_review_evidence.py::test_timeline_record_lists_sections_and_markers`
  passes.
- [ ] 4.2 Prompt: the story paragraph in `_AGENT_PROMPT` per D8. Done when
  `test_prompt_tells_the_agent_to_name_sections_and_leave_markers` passes.
- [ ] 4.3 Turn test: a fake AI call returns a Script that builds a four-section
  cut with three markers → one Proposal whose change list has the section and
  marker lines, Apply puts sections and markers on the document in one
  revision. Done when
  `test_api.py::test_story_cut_script_applies_sections_and_markers_in_one_undo_step`
  passes.
- [ ] 4.4 User Guide "Ask for a story cut" (from review-visual-editing 5.3)
  gains a paragraph on sections and markers and how to edit them on the
  Timeline page. Done when the section exists and names the inspector
  controls.

## Phase 5: Export (after 032 Phases 1–4)

- [ ] 5.1 `clips_from_timeline_document` carries `item_id`, `section`,
  `markers` with `record_sec`; `export_timeline` passes markers through. Done
  when `test_api.py::test_export_clip_dicts_carry_markers_and_sections` passes.
- [ ] 5.2 FCPXML markers, chapter markers and keywords per D9. Done when
  `test_export_engine.py::test_fcpxml_marker_sits_in_its_clip_at_source_time`,
  `test_fcpxml_section_emits_chapter_marker_and_keywords_on_the_run` and
  `test_fcpxml_marker_children_follow_timemap_and_transform` parse the output
  with `ElementTree`, assert element order, and the file passes 032's DTD
  check.
- [ ] 5.3 Resolve XML sequence markers per D9. Done when
  `test_resolve_xml_marker_is_a_sequence_marker_at_the_record_frame` and
  `test_resolve_xml_section_is_a_duration_marker` parse the output and assert
  `in`/`out` frames computed through 032's frame helper for 25 and 29.97 fps.
- [ ] 5.4 EDL locator lines per D9. Done when
  `test_edl_emits_loc_lines_for_markers_and_sections` asserts the regex
  `^\* LOC: \d\d:\d\d:\d\d:\d\d [A-Z]+ .+$` per marker and the timecode equals
  `seconds_to_timecode(record_sec, fps)`.
- [ ] 5.5 Golden fixtures: the 032 golden projects gain two markers and two
  sections; receipts on the Export page show `N markers, M sections exported`
  (`routes/Export.tsx:284`). Done when the golden diffs are reviewed and
  `e2e/studio-workflow-redesign.spec.ts` asserts the receipt line.

## Human tasks

- [ ] H1 Import the Resolve XML from a project with three markers and two
  sections into DaVinci Resolve: every marker is on the timeline ruler at the
  right shot with its name and note; sections show as duration markers; no
  relink dialog; say whether marker colours are missed. Record the result
  in this file.
- [ ] H2 Import the FCPXML into Final Cut Pro: markers sit on the right clips
  at the right moments, chapter markers carry the section names, the keyword
  collections list the section's clips; no DTD error.
- [ ] H3 In Resolve, "Import Timeline Markers from EDL" on the exported EDL:
  the `* LOC:` lines land as markers with the right colours. Note any that do
  not; EDL is best-effort.
