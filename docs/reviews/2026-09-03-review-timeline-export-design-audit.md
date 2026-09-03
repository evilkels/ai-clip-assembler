# Design audit: Review (`1b`), Timeline (`3a`), Export (`3b`) against the restyle reference

Date: 2026-09-03. Written against `main` at `08d284a` (PR #72 merged).
Auditor: Codex (gpt-5.6-luna, read-only) on behalf of the controller session; citations spot-checked.
Reference: `docs/design/2026-09-03-app-restyle-handoff.md` and its unstaged companion
`app-reference.dc.html` (line numbers below refer to that file, opened from the supplied export).

Plan 031 recorded that only the shell and Import had been diffed element by element. This is the
same treatment for the three remaining screens, in the plan's Phase 2 format, so that plan 031 can
gain the missing phase. Items marked as decisions are working affordances the design lacks; they
need a product call, not a deletion.

# Side-by-side design audit

## 1. Reference sections `2a`, `2b`, `2c`

The handoff covers `1d`, `1b`, `3a`, `3b`, Settings, gating, and agent behaviour, but not `2a`, `2b`, or `2c` (`docs/design/2026-09-03-app-restyle-handoff.md:27-42`, `:647-649`).

- `2a` — “Contact Sheet”: dark marketing/landing page; the product’s judgment is the hero, using scored frames and kept-versus-cut examples (`app-reference.dc.html:1219-1236`).
- `2c` — “Contact Sheet · light”: the same marketing layout on light paper surfaces (`app-reference.dc.html:1350-1367`).
- `2b` — “Cutting Room”: light editorial marketing page with a dark app screenshot as the close (`app-reference.dc.html:1481-1508`).

These are new landing-page/marketing designs, not before-state recreations. The handoff explicitly identifies only `1c` and `1a` as current-build recreations (`docs/design/2026-09-03-app-restyle-handoff.md:41-42`).

## 2. Review `1b`

### Already conformant (verified in code)

- Review header composition, exact title/step/description, filter controls, audio control, and shown count exist (`routes/Review.tsx:131-169`; `styles.css:3925-3946`).
- The 320px chat rail, header copy, New session control, message alignment/shapes, composer, and Send affordance are present (`ReviewChatPanel.tsx:46-161`; `styles.css:3955-4022`).
- Suggested-cuts heading, copy, Short/Medium/Long switcher, stale banner, three-column gallery, and 18px card gap are implemented (`Review.tsx:181-238`; `styles.css:4031-4082`).
- All four Version states and missing-clip reporting exist (`VersionCard.tsx:28-81`).
- Candidate Clip grid/list/filmstrip views, source tracks, per-source colour accents, and shared score-meter geometry exist (`SourceClipsPanel.tsx:127-225`; `ClipCard.tsx:253-328`; `styles.css:4201-4230`).
- Proposal cards, turn failure/retry, and thinking indicator are implemented (`ReviewChatPanel.tsx:100-138`; `ProposalCard.tsx:12-43`).

### Element deltas

1. **[layout/geometry] Preview cards do not match the designed player.** Design: hatched `preview frame`, 12px perforation strip, 38px play button at bottom-left, and a top-right timecode chip (`app-reference.dc.html:1950-1968`). Build renders actual video/posters, native video controls, a 34px play overlay, and no perforation/timecode treatment (`VersionPlayer.tsx:48-80`; `ClipPreview.tsx:153-193`; `styles.css:2357-2407`).

2. **[token/colour] Version action styling is still the generic primary-button system.** Design: accent-tint button with normal `--tx` text. Build keeps `btn primary` and only overrides background/border, leaving generic primary text/hover semantics (`VersionCard.tsx:73-81`; `styles.css:4125-4132`, `:1696-1703`).

3. **[missing/extra affordances] Grid cards differ materially.** Design has a top-right state badge, three meters, reason, and a `scores` button. Build moves state into a body verdict row, adds local technical scores, generation rationale, audio/file/look-group badges, and has no `scores` button (`ClipCard.tsx:264-328`; `styles.css:2949-3079`). Accepted-card action/badge treatment therefore does not match the reference.

4. **[layout/geometry] List and filmstrip are different compositions.** Design list rows use a 96×54 hatched thumb, three stacked score columns, and a compact action; build uses a 92px grid column, coloured pseudo-poster, only smooth/combined scores, and an additional source track (`ClipListRow.tsx:35-84`; `styles.css:2227-2288`). Design filmstrip is a single tiled row; build uses multi-column cards with metadata, scores, source tracks, and Include/Remove buttons (`ClipFilmstripItem.tsx:31-71`; `styles.css:2290-2325`).

5. **[copy] Review action-bar copy is incomplete.** Design says `Review complete — 11 clips kept`, includes runtime in the next line, and shows `⌘ ↵`; build says only `{acceptedCount} clips kept`, omits runtime and the shortcut (`app-reference.dc.html:2105-2120`; `AppShell.tsx:101-109`).

## 3. Timeline `3a`

### Already conformant (verified in code)

- The main split is nominally `minmax(0,1fr) | 320px` (`styles.css:3305-3317`).
- Undo/Redo, transport, scrubbing, drag reorder, trim handles, zoom, keyboard hints, and live preview are implemented (`Timeline.tsx:648-820`).
- Inspector fields, authoritative Timeline Item data, selected-row state, and backend operations are present (`TimelineEditor.tsx:38-97`; `TimelineItemRow.tsx:16-93`).
- Action-bar destination and export-format detail match the design (`AppShell.tsx:111-119`).

### Element deltas

1. **[copy/layout] Header runtime readout is wrong.** Design has `8 · 17.3s` over `ITEMS · RUNTIME`; build renders one line such as `8 items · 17.3s`, with no second label (`app-reference.dc.html:2193-2207`; `Timeline.tsx:1-35`; `styles.css:3325-3332`).

2. **[copy] Header description differs.** Design says “Reorder items, trim source bounds, and scrub the speed-aware sequence before export”; build capitalizes “Timeline Items” (`app-reference.dc.html:2196-2199`; `routes/Timeline.tsx:15-18`).

3. **[layout/token] Preview is not the designed portrait placeholder.** Design uses a centred 9:16 hatched well with only the filename at bottom-left. Build displays actual video plus an overlay containing audio, filename, source range, and timeline position (`app-reference.dc.html:2211-2216`; `Timeline.tsx:605-638`; `styles.css:3334-3382`).

4. **[token/colour/affordances] Transport differs.** Design makes Play the single solid accent control and has no audio control or zoom +/- buttons. Build makes all transport buttons subtle and adds shared audio, zoom-out, and zoom-in controls (`app-reference.dc.html:2218-2230`; `Timeline.tsx:648-700`).

5. **[layout/geometry] Track rendering differs.** Design uses a 20px four-cell ruler and flex-width 66px clip blocks with hatch, vertical accent wash, rank, and duration. Build uses dynamic ticks, a 24px ruler, absolutely positioned 80px clip area, horizontal trim handles, thumbnail glyph, filename, and Select button (`app-reference.dc.html:2232-2255`; `Timeline.tsx:704-799`; `styles.css:3478-3615`).

6. **[token/colour] Playhead is red in the build but accent in the design** (`app-reference.dc.html:2240`; `styles.css:3630-3655`).

7. **[missing/extra affordances] Inspector is incomplete/different.** Design has a Silent pill, 2×2 fields, source/timeline readback, Split + Duplicate + destructive Remove. Build lacks Silent, renders only Split and Remove, uses a different readback including item ID, and styles Remove as subtle (`app-reference.dc.html:2260-2289`; `TimelineEditor.tsx:38-64`; `TimelineItemRow.tsx:80-93`).

8. **[layout/affordances] All-items rows contain extra controls and use a border selection state rather than the designed wash** (`app-reference.dc.html:2291-2300`; `TimelineItemRow.tsx:124-175`; `styles.css:4344-4375`).

9. **[copy/geometry] Footer differs:** missing `Timeline ready —`, uses 10px rather than 7px pip gaps, and omits `⌘ ↵` (`app-reference.dc.html:2305-2320`; `WorkflowFooter.tsx:38-73`; `styles.css:833-849`).

## 4. Export `3b`

### Already conformant (verified in code)

- The 1fr/380px workspace, 24px gap, three format cards, receipt structure, path ellipsis, and hand-off aside exist (`styles.css:1141-1168`, `:1221-1283`).
- Format selection is keyboard-accessible and the receipt supports Copy, Reveal, payload disclosure, warnings, and Resolve handoff (`Export.tsx:235-339`).

### Element deltas

1. **[copy] Header differs.** Design says “6 items in the timeline”; build says “in the Timeline” (`app-reference.dc.html:2393-2401`; `Export.tsx:192-207`).

2. **[missing affordance] Reveal in Finder is conditional.** Design shows it in the header; build renders it only after any export result exists (`Export.tsx:196-208`).

3. **[copy] Format cards use different final copy and filenames.** Build says `DaVinci Resolve XML`, `Final Cut Pro XML`, `CMX 3600 EDL` with generic notes and extensions; design says `DaVinci Resolve`, `Final Cut Pro`, `Plain EDL`, with `timeline.xml`, `timeline.fcpxml`, and `timeline.edl` (`app-reference.dc.html:2406-2417`; `Export.tsx:20-52`).

4. **[token/colour] Default selection and selected-card treatment differ.** Design selects Resolve with gradient and glow; build defaults to EDL and uses a flat accent tint (`Export.tsx:96-99`; `styles.css:1187-1192`).

5. **[missing/extra affordances] Build adds a standalone solid Export button below the cards; the reference has no equivalent control.** Treat this as a product decision, not an automatic deletion (`Export.tsx:265-279`).

6. **[copy/affordances] Receipt differs:** build appends “exported” to the title, adds a Reveal button inside the path row, backend-report text, warnings, and one receipt per format; design shows one receipt with Copy, Open in DaVinci Resolve, and disclosure (`Export.tsx:284-340`; `app-reference.dc.html:2420-2434`).

7. **[token/copy] Hand-off source dots are all accent-coloured and counts use `2×`; design uses per-source colours and `2 items`/`1 item` (`Export.tsx:346-361`; `styles.css:1280-1283`; `app-reference.dc.html:2447-2454`).

8. **[missing/extra affordance] The build adds a global workflow footer on Export, while reference `3b` has only header, content, and status footer (`AppShell.tsx:121-127`; `app-reference.dc.html:2337`, `:2461-2465`). Keep as a decision because it provides navigation. The build’s empty state is also outside the designed screen states.

## Decisions and dependencies

- Do not delete working preview video/audio, source-track seeking, Timeline selection/reorder/remove controls, export overwrite handling, standalone Export, or the Export footer without an explicit product decision.
- Plan 030 Phase 1 is relevant to the shared status-bar middle field and any Selected-vs-Effective Harness display. Ship the truthful `BACKEND v0.2.0 · LOCAL` baseline first; do not hardcode Pi Agent as the effective result.
- Review’s fallback notice and agent availability/copy depend on plan 030 Phases 2–4. Timeline and Export have no direct plan-030 dependency.
