<!--
Supplied by the design owner 2026-09-03 as `design-proper-improvement.zip`
(`design_handoff_app/README.md`), checked in verbatim below the horizontal rule
because it is the self-sufficient spec plan 031 is written against.

The companion `app-reference.dc.html` (1.8 MB, fixed 1440px, inline styles) is
the authority wherever it and this document disagree. It is deliberately not
staged, matching the existing rule for supplied Claude Design exports in
`.gitignore`; keep the unpacked folder outside the repo and open it in a
browser at >=1440px.
-->

# Handoff: AI Clip Assembler — App Restyle (Import · Review · Timeline · Export · Settings)

## Overview

A visual and interaction restyle of the existing Electron/React app in
`frontend/src/renderer`. Same four-step workflow and same backend contracts; new shell, new token
set, new component vocabulary, plus one screen the app does not have yet (a four-panel **Settings**
with an explicit "who scores your footage" choice).

The design premise: the app is a review tool for footage, so it should read like a grading suite —
near-black studio surfaces, one accent, every number in monospace tabular figures, and exactly one
solid accent button per screen. Dark is the default theme; a full light token set is specified and
used for the Import screen so both are proven.

What is in scope:

| # | Screen | Reference id | Theme shown |
| --- | --- | --- | --- |
| 1 | Design system (tokens, components, type, geometry, interaction) | `4a`, `4b` | both |
| 2 | Import | `1d` | light |
| 3 | Review | `1b` | dark |
| 4 | Timeline | `3a` | dark |
| 5 | Export | `3b` | dark |
| 6 | Settings — AI assistance / Connections / Diagnostics | `6a`, `6b` | dark |
| 7 | Harness choice surfaced on Import (popover) | `6c` | dark |
| 8 | Import step-gating states (6 states) | `5a` | dark |
| 9 | Agent behaviour not yet drawn in the screens (6 cards) | `5b` | dark |

`1c` and `1a` in the reference are recreations of the **current** build (before state), included only
for comparison. Do not implement them.

## About the Design Files

`app-reference.dc.html` is a **design reference created in HTML** — a prototype that shows the
intended look, structure, copy, and a few live interactions. It is **not production code to copy**.
It is one flat file of inline styles at a fixed 1440px width, with a tiny runtime (`support.js`)
that renders the template; there are no components, no responsive rules, no real data.

The task is to **recreate these designs inside the existing app**: React 18 + TypeScript renderer,
the routes and components already in `frontend/src/renderer/src`, and the project's own styling
approach (`styles.css` / whatever `src/renderer/src/styles` establishes). Lift the exact values from
this README and from the reference file; express them as the codebase expresses everything else
(CSS custom properties for the two themes, component classes or modules, existing `SegmentedControl`,
`ScoreChip`, `StatusSurface`, `WorkflowHeader`, `WorkflowFooter` rather than new one-off markup).

**How to read the reference file.** Open `app-reference.dc.html` in a browser (needs `support.js`,
`image-slot.js`, `assets/logo.png` — all in this folder) and it renders all sections stacked on one
canvas, ordered 01 → 06. Or read it as text: every screen is a `<div id="...">` whose `style`
attribute carries the theme tokens, and every child element carries its literal inline style. When
this README and the file disagree, **the file wins**.

Two things in the file are prototype scaffolding, not design:

- `{{ … }}` holes, `<sc-for>`, `<sc-if>` — the prototype's templating. Replace with real props/state.
- Fixed pixel `height` on each screen wrapper (`1240px`, `1100px`, `1000px`, …) and the outer
  `border: 1px solid #000` + drop shadow. Those seat the mock on the review canvas. Real windows are
  resizable; only the internal grid proportions matter.

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, and copy are final and exact. Recreate the
desktop layout faithfully at 1440×~1000 and let it flex from there (see *Responsive / window
resizing*). Every hex value and pixel figure below is taken verbatim from the reference.

## Repo mapping

Build each screen on the file that already owns it:

| Design | Repo file(s) |
| --- | --- |
| Shell: header, rail, workflow steps, action bar, status footer | `layouts/` (AppShell), `components/WorkflowHeader.tsx`, `components/WorkflowFooter.tsx` |
| Import `1d` | `routes/Import.tsx`, `components/SourceVideoBrowser.tsx`, `SourceVideoSelectionBar.tsx`, `ViewModeSwitcher.tsx`, `ClipGenerationPanel.tsx` |
| Review `1b` | `routes/Review.tsx`, `components/ClipCard.tsx`, `ClipListRow.tsx`, `ClipFilmstripItem.tsx`, `SourceClipsPanel.tsx`, `ReviewChatPanel.tsx`, `VersionGallery.tsx`, `VersionCard.tsx`, `VersionPlayer.tsx`, `ProposalCard.tsx` |
| Timeline `3a` | `routes/Timeline.tsx`, `components/TimelineEditor.tsx`, `Timeline.tsx`, `TimelineItemRow.tsx`, `SourceTrack.tsx`, `useSequencePlayer.ts` |
| Export `3b` | `routes/Export.tsx`, `main/exportHandoff.ts` |
| Settings `6a`/`6b` | `components/SettingsModal.tsx`, `SettingsTabPanel.tsx`, `ConnectionsTabPanel.tsx`, `DiagnosticsTabPanel.tsx`, `ReviewModelAccountSection.tsx`, `main/reviewModelAuth.ts`, `main/mcpConnect.ts` |
| Harness popover `6c` | `routes/Import.tsx` toolbar + `SettingsModal` deep link |
| Gating `5a` | AppShell footer / `WorkflowFooter.tsx` |

## Design Tokens

Two themes, identical token names. **Dark is the default.** In the reference each screen wrapper
declares them as CSS custom properties; do the same at the theme root.

| Token | Role | Dark | Light |
| --- | --- | --- | --- |
| `--bg0` | window base, content well | `#08090b` | `#e9eaec` |
| `--bg1` | chrome bands (header, action bar, status bar), cards on bg0 | `#0d0f12` | `#f7f7f8` |
| `--bg2` | inputs, secondary buttons, inner cards | `#12151a` | `#ffffff` |
| `--surf` | rail, side panels, nested panels | `#101317` | `#ffffff` |
| `--elev` | hover surface, segmented-control track | `#171b21` | `#f1f2f4` |
| `--bd` | hairline borders, dividers | `#23272e` | `#dcdee2` |
| `--bds` | stronger border (buttons, empty markers) | `#343a43` | `#bfc3c9` |
| `--tx` | primary text, titles, values | `#f4f5f7` | `#14161a` |
| `--txd` | body copy, secondary action labels | `#a2a8b2` | `#52585f` |
| `--txm` | mono meta, labels, counts | `#6b7280` | `#878d95` |
| `--acc` | brand / active / primary action | `#ff4d6d` | `#e11d48` |
| `--accd` | accent tint fill | `rgba(255,77,109,.14)` | `#ffe4ea` |
| `--grn` | kept, complete, healthy | `#5fd18b` | `#1f9d57` |
| `--ylw` | stale, warning | `#e6b450` | `#b07d12` |
| ink on accent | label on solid accent | `#1a0308` | `#ffffff` |
| `--red` (Diagnostics failure only) | unreachable | `#ff6b6b` | — |

Derived values are written as `color-mix(in srgb, var(--x) N%, transparent)` throughout — keep that
technique, it is what makes one token set serve both themes. The mixes actually used: accent at
2/3/4/12/13/18/20/22/26/34/38/40/42/45/48/60/70/80%, green at 10/13/16/18/30/32/34/45/55/85%,
amber at 3/12/14/16/28/30/32%, `--txm` at 16%.

Preview/placeholder wells (where real video frames go) are `#05070a` with a diagonal hatch:
`repeating-linear-gradient(135deg,#0b0e12 0 10px,#101419 10px 20px)`; the light-theme equivalent is
`repeating-linear-gradient(135deg,#c9ccd2 0 8px,#d7dade 8px 16px)`.

## Typography

Two families, both IBM Plex (Google Fonts; self-host in the app):
**IBM Plex Sans** 400/500/600/700 for prose and UI, **IBM Plex Mono** 400/500/600 for labels,
metadata and every number.

| Role | Spec |
| --- | --- |
| Screen title (`Timeline`) | Sans 600 · 20px · `-.015em` |
| Project name (window header) | Sans 600 · 18px · `-.01em` |
| Section heading (`Suggested cuts`) | Sans 600 · 16px · `-.01em` |
| Panel/card title | Sans 600 · 14.5–15.5px |
| Body / help / rationale | Sans 400 · 13.5px · line-height 1.5 (12.5px inside dense cards, never below) |
| Row text, list items | Sans 400 · 13–13.5px |
| Numbers, timecodes, scores | Mono 600 · 15px · `font-variant-numeric: tabular-nums` |
| Inline metadata | Mono 400 · 10.5–12px |
| Meta label (`STEP 03 / 04`) | Mono 400 · 10px · `+.14em` · uppercase |
| Status pill | Mono 400 · 10–10.5px · `+.08em`–`+.1em` · uppercase |
| Status bar | Mono 400 · 11px · `+.04em` · uppercase |

Rules that keep new screens consistent:

- Every number a user compares or scrubs is Plex Mono with tabular figures — timecodes, scores,
  durations, file sizes, counts.
- Every label that names a region or a state is Plex Mono, uppercase, 10px, wide tracking.
- Prose is always Plex Sans. Nothing in the app uses a sans size below 12.5px.

## Geometry & density

- **Radii:** 6 chips · 8 rows, tiles, small buttons, inputs · 9–10 controls, buttons, cards ·
  12 panels and banners · 14 large cards · 16 dialog · 999 pills · 3–4 timeline bar segments.
- **Density:** rail row 34px min-height · rail padding 18/16 · row padding 9/10 · section gap 22 ·
  panel padding 18 · screen padding 24/28 · chrome band padding 16/24 and 20/28.
- **Rail:** expanded 264px, collapsed 68px, 1px divider, 26px toggle centred on the divider
  (`top:22px; left:-13px`).
- **Borders:** 1px everywhere. Elevation is inset rings (`box-shadow: inset 0 0 0 1px …`), not
  shadows; the only real shadows are accent/green glows on selected things
  (`0 4px 14px -6px`, `0 6px 18px -8px`, `0 10px 26px -14px`) and the Settings dialog.

## Interaction states

| State | Treatment |
| --- | --- |
| Selection | Accent gradient wash + hairline accent ring + soft accent glow. **Never a left bar.** Rows: `linear-gradient(90deg, accent 22%, accent 4%)` dark / `14% → 3%` light, ring `accent 45%`, glow `0 4px 14px -6px accent 60%`. Steps: `linear-gradient(100deg, accent 20%, accent 3%)` dark / `13% → 3%` light, ring `accent 42%`, glow `0 6px 18px -8px accent 70%`. |
| Hover | One surface step up (`bg1 → bg2`, or `transparent → elev`). No movement, no scale. |
| Focus | 2px accent ring at 45%, offset 2px, on the control's own radius. |
| Disabled | 55% opacity, text drops to `--txm`, border stays. Never hidden. A disabled primary in the action bar is `1px dashed var(--bds)` on transparent with `#5a6068` text, and **always carries its reason beside it**. |
| Destructive | Accent tint fill (`--accd`) with accent text and a 40% accent border — never solid accent. |
| Transitions | 140ms ease-out on `background-color`, `border-color`, `color`. |

**Accent budget — the rule that holds the design together:** exactly one solid accent element per
screen, the primary action in the bottom bar. Everything else accent-coloured is a tint, an
outline, a meter fill, or the playhead. When the primary action is blocked, the accent **moves** to
the button that unblocks it (see `5a`). Green means kept/complete, amber means stale; neither is
ever used for an action.

## Component specs

**Buttons** (all radius 10, Sans 13.5px):

| Variant | Spec |
| --- | --- |
| Primary | `padding:11px 22px`, bg `--acc`, 1px `--acc` border, ink `#1a0308` dark / `#fff` light, 600 |
| Secondary | `padding:11px 18px`, bg `--bg2`, 1px `--bd`, text `--txd` |
| Ghost | `padding:11px 18px`, transparent bg and border, text `--txd` |
| Destructive | `padding:11px 16px`, bg `--accd`, 1px `accent 40%`, text `--acc` |
| Disabled | secondary geometry, `opacity:.55`, text `--txm` |
| Toolbar / inline | `padding:6px 12px`–`8px 13px`, radius 8, bg `--bg2`, 1px `--bd`, 12.5–13px |

**Segmented control:** track `padding:3px`, radius 10, 1px `--bd`, bg `--elev`; items
`padding:7px 13px`, radius 7, Mono 10.5px `+.1em` uppercase. Active in dark = solid `--acc` with
`#1a0308` ink; active in light = `--bg2` with `--tx` and `0 1px 2px rgba(20,25,35,.12)`. (Review's
clip switcher uses the dark treatment, Import's uses the light one.)

**Status pill:** Mono 10.5px `+.08em` uppercase, `padding:4px 10px`, radius 999.
`queued` = 1px `--bd`, text `--txm` · `analyzed` = 1px `green 45%`, bg `green 10%`, text `--grn` ·
`running` = 1px `--acc`, bg `--accd`, text `--acc` · `connected` = bg `green 18%`, text `--grn` ·
`detected` = 1px `--bd`, text `--txd` · `config unreadable` = bg `amber 16%`, text `--ylw` ·
`not installed` = 1px `--bds`, text `--txm`, whole row at `opacity:.5`.

**Score meter:** grid `58px | 1fr | 30px`, gap 10. Label Mono 10px uppercase `--txm`; track 5px
tall, radius 999, bg `--bg2`; fill uses the score's tone; value Mono 11.5px 600 tabular, right
aligned, same tone. **Tone function is shared across the app:** `≥8 → --grn`, `≥5 → --ylw`,
`<5 → --acc`. Labels are `smooth`, `visual`, `combined`.

**Progress bar:** 8px tall, radius 999, track `--elev` (or `--bg2`), fill `--acc`.

**Timecode rail motif:** 20–26px tall; ticks
`repeating-linear-gradient(90deg, var(--bd) 0 1px, transparent 1px 22px)`; playhead 2px `--acc`
full height; end labels Mono 10px `--txm`.

**Assembled-cut bar motif:** 12px tall, radius 4, five or six flex segments
(`0 0 22% / 16% / 12% / 19%` then `flex:1`); first segment `--acc`, the rest alternate
`rgba(255,255,255,.34)` / `rgba(255,255,255,.2)`; each segment except the last has a 1px right
border in the bar's own background colour, which reads as the cut line.

**Perforation strip motif** (filmstrip edges):
`repeating-linear-gradient(135deg,#0b0e12 0 9px,#101419 9px 18px)` with
`inset 0 6px 0 -2px rgba(255,255,255,.05), inset 0 -6px 0 -2px rgba(255,255,255,.05)`.

**Banners** (`padding:13px 16px`, radius 12, no border, `inset 0 0 0 1px tint`):
`linear-gradient(120deg, tone 12–14%, tone 2–3%)` + Mono 10px uppercase tone label + 13px body.
Three tones: amber `stale`, green `exported`, accent `analyzing`.

## Screen anatomy — the shell (all four workflow screens)

Rows, top to bottom: **project header → body (rail | 1px divider | main) → action bar → status bar**.

1. **Project header** — `display:flex; gap:20px; padding:16px 24px`, bottom 1px `--bd`, bg `--bg1`.
   Project name (18/600), then the absolute path `flex:1` in Mono 12px `--txm`, then a count pill
   (Mono 11px uppercase, 1px `--bd`, radius 999, `padding:4px 10px`) e.g. `10 sources · 6.9 GB`,
   `8 items · 17.3s`, then a `Rename` toolbar button.

2. **Rail** — `grid-template-rows: auto auto auto 1fr auto; gap:22px`, bg `--surf`, right 1px `--bd`,
   `padding:18px 16px`.
   - Brand: 34×34 `logo.png` + `AI Clip Assembler` (14/600) + `local first · v0.2.0`
     (Mono 10px `+.12em` uppercase `--txm`); `padding-bottom:14px`, bottom 1px `--bd`.
   - `＋ Open Folder`: height 38, radius 10, 1px `--bds`, bg `--elev` (light) / `--bg2` (dark), 14/600.
   - `PROJECTS` group (Mono 10px `+.14em`): rows gap 2, min-height 34, radius 8, `padding:9px 10px`;
     6×6 radius-2 dot (`--bds`, accent when active), name 13.5px ellipsised, count Mono 10px.
     Active row gets the selection wash. Sample data: `14-06-26-Detox-hike-lilaste 22`,
     `Elvy.Ernest-introduction 16`, `ESTEPONA_03-05-26 31`, `imsoane-surf-morroco 44`,
     `sunday-biking-saulkrasti 18`.
   - `WORKFLOW` group: `<ol>` gap 4; each step is a grid `26px | 1fr | auto`, gap 12,
     `padding:9px 10px`, radius 10. Marker is 26×26, radius 8, holding a 24px line icon
     (stroke 1.8, round caps) when active/expanded or a `✓`/number otherwise. Label 14px, hint
     11.5px `--txm`, count Mono 10px. A 1px connector runs between markers
     (`position:absolute; left:23px; top:37px; bottom:-6px`), green-tinted after a completed step.
     Steps, verbatim: **Import** "Add your footage" `10` · **Review** "Pick the best clips" `16` ·
     **Timeline** "Arrange & trim" `9` · **Export** "Save your video" (no count).
     Marker states: active = fill `--acc`, ink `#1a0308`; done = fill `green 18%`, ink `--grn`;
     upcoming = fill `txm 16%`, ink `--txm`, numbered.
   - Rail footer (top 1px `--bd`): `◈ AI assistance` with `pi · cloud` in Mono 10px `--grn`, and
     `⚙ Settings`.
   - **Collapsed rail (68px):** labels hidden, everything centred, padding `18px 8px`, row padding
     `7px 0`; project dots become 26×26 radius-8 tiles carrying the project's initial; step markers
     show the icon only. Toggle glyph `‹` / `›`.

3. **Screen header** (inside `main`) — `padding:20px 28px`, bottom 1px `--bd`, bg `--bg1`,
   space-between. Left: `<h1>` 20/600 plus the step eyebrow `STEP 01 / 04` (Mono 10px `+.14em`
   uppercase `--acc`), and one line of 13.5px `--txd` explaining the step. Right: that screen's
   actions.

4. **Content** — `padding:24px 28px`, `gap:20–22px`, `overflow-y:auto`.

5. **Action bar** — `padding:14px 24px` (Timeline 16px 28px), top 1px `--bd`, bg `--bg1`.
   Left: four progress pips, height 4, radius 999 — current step 46px `--acc`, others 22px `--bds`,
   completed 22px `--grn`. Then a divider (`padding-left:20px; border-left:1px --bd`) with a
   13.5/600 status line and a Mono 11px `next: …` line. Right: an optional Mono 10px hint
   (`RUNS IN BACKGROUND`, `⌘ ↵`), a secondary/ghost button, and the single solid accent primary.

6. **Status bar** — 34px, bg `--bg1`, top 1px `--bd`, `padding:0 20px; gap:22px`, Mono 11px `+.04em`
   uppercase `--txm`: a 7px state dot + state text, a middle fact
   (`BACKEND v0.2.0 · LOCAL` or `HARNESS: PI AGENT (CLOUD AI, OPT-IN)`), and right-aligned
   `11 / 16 CLIPS KEPT` in `--txd`.

## Screen 2 — Import (`1d`, light theme)

Content, top to bottom:

1. **Toolbar row.** `Source videos` (16/600) + `10 files · 6.9 GB · 9:35 total runtime` (Mono 11px).
   Right: a `Search files` field (radius 10, 1px `--bd`, bg `--bg2`), the view segmented control
   `TABLE | THUMBS | COMPACT`, and a `Columns` button.

2. **Selection action bar.** `padding:10px 14px`, radius 10, 1px `--bd`, bg `--accd`:
   `10 SELECTED` (Mono 11px `+.1em` 600 `--acc`), then "All source videos will be analyzed.";
   right side — the **harness trigger** (1px `--acc` border, green 7px dot, `Pi Agent · cloud`, `⌄`),
   a 1px divider, `Unanalyzed only`, `Deselect all`, and solid accent `Analyze 10`.

3. **Source list, three interchangeable views** (state lives on the route):
   - **Table** (default): radius 12, 1px `--bd`, bg `--bg2`, header row on `--elev` in Mono 10px
     `+.12em` uppercase. Columns: checkbox (34px) · `Frame` (74px) · `File` · `Duration` · `FPS` ·
     `Resolution` · `Size ↓` · `Date` · `Analysis`, all numerics right-aligned Mono tabular. Rows
     `padding:10px 14px`, top 1px `--bd`. Frame cell is a 48×28 radius-5 hatched placeholder. File
     cell: 6×6 colour chip (per-source identity colour) + name 500 + `hevc` pill. Analysis cell
     carries the status pill.
   - **Thumbs:** 5-up grid, gap 14; card radius 12, 16/9 hatched well with a 16×16 accent checkbox
     top-left and a duration chip bottom-right (`rgba(10,12,16,.72)`), then name, `res · size`, pill.
   - **Compact:** single card, rows `padding:8px 14px` — checkbox, colour chip, name, duration, size,
     and a 9px state dot.
   - Sample source rows (10, verbatim in the reference): `DJI_20240324154822_0223_D.MP4 1:22.3
     29.97 2160×3840 908 MB 2024-03-24 15:48` … through `makonis-ending.MP4 1:36.8 29.97 2160×3840
     1.0 GB`. First row `running`, next four `analyzed`, rest `queued`.

4. **Analysis rail (two cards side by side).**
   - Left, accent-tinted (`linear-gradient(120deg, accent 12%, accent 2%)`, ring `accent 34%`, glow
     `0 10px 26px -14px accent 70%`), radius 14, `padding:18px 20px`: `ANALYZING` +
     `Video 1/10 · FFmpeg motion analysis` (14.5/600) + `00:07 elapsed · ~04:20 left` right-aligned
     Mono 12px; the current filename; the 8px progress bar; then the stage row
     `01 SCAN → 02 MOTION → 03 SCENES → 04 SCORE` (current stage in `--acc`, past in `--tx`) with an
     `Abort` button pushed right.
     ⚠ See `5b` card 6: the shipped backend phases are **motion → frames → scenes → scoring (pi)**,
     with `video 4/13` and `pi clips 7/12` counters. Prefer the shipped names.
   - Right, 340px, radius 12, 1px `--bd`, bg `--bg2`: `How clips are found` + `6 RULES`, then the six
     rule values in a 3-column grid (Mono 9.5px uppercase label, Mono 15px 600 value, bottom 1px
     `--bd` per row), then `Edit rules and re-scan`. Values: `min 2` · `max 8` · `steady 5` ·
     `turn °/s 30` · `per scene 7` · `per video 20`. Full labels/help for the settings form:
     Shortest clip (s) "Discard usable moments shorter than this." · Longest clip (s) "Split longer
     usable moments into shorter clips." · How steady (0–10) "Keep footage at or above this
     Smoothness Score." · Max camera turn (°/s) "Reject moments where the camera turns faster." ·
     Max clips per scene "Limit how many Candidate Clips one Scene can keep." · Max clips per video
     "Limit how many Candidate Clips one Source Video can keep."

Action bar: `Analyzing 10 sources — 16 clips so far` / `next: pick the keepers in Review`,
`RUNS IN BACKGROUND`, `Add more footage`, **`Continue to Review →`**.
Status bar: accent dot + `ANALYZING FOOTAGE…` · `HARNESS: PI AGENT (CLOUD AI, OPT-IN)` ·
`9 / 15 CLIPS KEPT`.

## Screen 3 — Review (`1b`, dark theme)

`main` splits into a fixed 320px chat aside and a scrolling column.

**Chat aside** (bg `--surf`, right 1px `--bd`): header `Ask the AI` + "Describe the cut you want" +
a `NEW SESSION` pill button. Messages `padding:11px 13px 12px`, `max-width:86%`, `width:fit-content`,
Sans 13.5px, line-height 1.5, with a per-role header (Mono 10px `+.12em` uppercase: `AI` / `YOU`
plus a tabular time). Agent bubbles: bg `--bg2`, 1px `--bd`, radius `4px 12px 12px 12px`,
left-aligned. Editor bubbles: bg `accent 12%`, 1px `accent 35%`, radius `12px 4px 12px 12px`,
right-aligned, right-aligned text. Composer: top 1px `--bd`, `padding:14px 18px`, input radius 9 on
`--bg2` with placeholder `Ask the AI…`, plus a solid accent `Send`.

**Suggested cuts section.** Heading 16/600 + "Complete edits the AI assembles from your clips.
Preview one, then apply." Right: a `Short | Medium | Long` segmented (accent active). Below it the
amber **stale banner**: "Your video or clip choices changed since these suggestions were made." with
an outlined amber `Refresh suggestions`. Then two (per `5b`: **three**) version cards, equal width,
gap 18, radius 14, 1px `--bd`, bg `--bg1`:

- 16/9 preview well (`#05070a` + hatch) with a Mono 11px `preview frame` centre label, a 12px
  perforation strip along the top, a 38px round play affordance bottom-left, and the total timecode
  chip top-right (`00:00:23:04`).
- Player strip on `#05070a`: the 12px assembled-cut bar (6 segments) and a Mono 11px tabular row —
  `0:00.0 / 0:23.0` · `clip 1 of 9 · <file>` · `<in point>`.
- Body `padding:18px`: title 15.5/600, `vibe` line Mono 11px `--txm`
  (e.g. "cinematic, exploratory, varied · 23s"), a `FOCUS` pill, the rationale (13px, `min-height:2.8em`
  so cards stay level), then a full-width `Apply to working timeline` in accent tint + an
  `OUT OF DATE` Mono amber label.
- Verbatim card 1: **Beginning in Motion** — "Builds from a cyclist into expansive coast, intimate
  cove, beach figures, and the cloud finale, without repeating a scene consecutively."
  Card 2: **Road to Horizon** — "Uses the cliff wide from DJI_20251021135541_0687_D.MP4 00:07–00:11
  as the hook, then intercuts human-scale cycling and beach imagery before the cloud ending."

**Your clips panel** (radius 14, 1px `--bd`, bg `--surf`, `padding:18px`): `Your clips` +
`16 found · 11 kept · scene cap 1/13` (Mono 11px), right side `GRID | LIST | FILMSTRIP` segmented and
`Sort **Combined score**`. Three views over the same candidates:

- **Grid** (3-up, gap 18): card radius 12, 1px `--cbd`, bg `--bg1`. 16/9 well with `#N` rank chip
  (top-left), a state badge (top-right) and duration (bottom-right). Then the **source-track bar** —
  8px tall, radius 3, 1px `--bd` on `--bg2`, a faint `rgba(255,255,255,.14)` block for the source
  span and an accent block for this clip's span — with the range under it in Mono 10px
  (`01:46.2–01:49.6 of 01:49.5`). Body: colour chip + filename (13/600, ellipsised) + `3 of 9` pill;
  three score meters; the clip reason (12.5px, line-height 1.45); footer above a 1px rule with the
  primary action and a Mono `scores` button.
  **Accepted vs candidate:** accepted card ring `--grn` + `0 0 0 1px green 30%`, badge solid green
  with `#04130c` ink, action `Remove from working timeline` in ghost; candidate card ring `--bd`,
  badge `rgba(5,7,10,.72)`, action `Add to working timeline` in accent tint.
  Verbatim clips: `#1 DJI_20240324170430_0235_D.MP4 · 3.4s · ◆ TL #1 · "Steady descending push over
  the ridge — the cleanest wide in the set."` · `#2 DJI_20251021135541_0687_D.MP4 · 4.0s · PROPOSED ·
  "Cliff wide with slow lateral drift; strong hook for the opening."` · `#3 IMG_0172.MOV · 2.8s ·
  2 SIMILAR · "Handheld beach figures — usable, slight softness on the pan out."`
  (`2 SIMILAR` is the Look Group badge — the panel shows the best clip per Look Group.)
- **List:** rows `padding:12px 14px`, 1px `--bd` between; rank, 96×54 hatched thumb with duration,
  name + range + one-line reason, then the three scores as 56px stacked columns (value / 4px bar /
  label), then a compact `Add` / `Remove`.
- **Filmstrip:** one flex row on `#05070a`, `padding:14px`, gap 12; each item a 16/9 tile with
  perforation strips top and bottom, `#N`, and `score · duration` beneath.

## Screen 4 — Timeline (`3a`, dark theme)

Header actions: `Undo`, `Redo`, and a right-aligned two-line readout — `8 · 17.3s` (Mono 15/600
tabular) over `ITEMS · RUNTIME`.

Body is `grid-template-columns: minmax(0,1fr) 320px`.

**Left (bg `#05070a`, right 1px `--bd`):**
- Preview: centred, `padding:18px`, a 9/16 hatched well (portrait drone footage) with the source
  filename bottom-left in Mono 11px.
- Transport bar (`padding:12px 20px`, top 1px `--bd`, bg `--bg1`): 34×34 radius-9 buttons `◀◀` and
  `■`, then a 38×34 solid accent `▶`; the position `0:00.0 / 0:17.3` (Mono 15/600 tabular, the total
  in `--txm` 400); the current filename; right side `ZOOM` label, a 120px range input with
  `accent-color: var(--acc)`, and `32 px/s`.
- Track area (`padding:14px 20px 18px`, bg `--bg0`, top 1px `--bd`): a 20px ruler of four equal
  cells with left 1px borders labelled `0:00.0 / 0:05.0 / 0:10.0 / 0:15.0`; then the clip blocks —
  flex row, gap 3, each block `flex: <seconds>`, height 66, radius 8, hatch + a
  `linear-gradient(180deg, accent 26%, accent 8%)` wash, ring `accent 42%`, `#N` top-left and the
  duration bottom-left in Mono 9.5px; the 2px accent playhead spans the row. Block durations:
  `2.7 2.6 1.4 2.5 2.8 1.5 2.3 1.5`.
  Below: Mono 10px hints `DRAG TO REORDER · EDGES TO TRIM · WHEEL TO ZOOM` and right-aligned key
  chips `J K L`, `⇧ ← →`, `⌫` (`padding:3px 7px`, radius 5, 1px `--bd`).

**Right inspector (bg `--surf`):** header `SELECTED ITEM · #1` + filename (14/600) + a `SILENT`
pill. Then a 2×2 grid of labelled Mono inputs — `In 10`, `Out 12.7`, `Speed 1.0×`, `Zoom 1.0×`
(`padding:9px 10px`, radius 8, bg `--bg2`; labels Mono 10px `+.12em` uppercase). A read-back box
(radius 10, 1px `--bd`, bg `--bg2`, Mono 11.5px): `source 0:10.0 → 0:12.7` / `timeline 0:00.0 · 2.7s`.
Actions: `Split`, `Duplicate` (equal flex, secondary) and a destructive `Remove`. Then `ALL ITEMS` —
compact rows `padding:7px 9px`, radius 8, index / filename / duration; the selected row carries the
selection wash.

Action bar: two green pips, accent pip, one resting; `Timeline ready — 8 items · 17.3s` /
`next: export FCPXML, Resolve XML or EDL`; `⌘ ↵`, `Back to Review`, **`Continue to Export →`**.

## Screen 5 — Export (`3b`, dark theme)

Header: `Export`, `STEP 04 / 04`, "6 items in the timeline · 20.3s total. Media paths stay relative
to the project folder." and a `Reveal in Finder` button.

Content grid `minmax(0,1fr) 380px`, gap 24.

**Format cards** under `CHOOSE A FORMAT` — 3-up, gap 14, each `padding:16px`, radius 12, gap 8:
kicker (Mono 10px `+.12em` uppercase), name (15/600), note (12.5px `--txd`), extension (Mono 10.5px
`--txm`). Selected card: 1px `accent 48%`, `linear-gradient(160deg, accent 18%, accent 3%)`, glow
`0 8px 24px -12px accent 80%`, kicker in `--acc`. Unselected: 1px `--bd`, no fill.
Verbatim: **DaVinci Resolve** / `selected` / "Resolve-flavoured FCP7 XML with speed and zoom baked
in." / `timeline.xml` · **Final Cut Pro** / `fcpxml` / "FCPXML 1.9 with relative media references."
/ `timeline.fcpxml` · **Plain EDL** / `edl` / "CMX3600 cut list for anything else in the chain." /
`timeline.edl`.

**Result receipt** — green banner treatment, radius 14, `padding:18px 20px`: `EXPORTED` +
`DaVinci Resolve XML` (15/600), `6 items · 20.3s effective · just now` (Mono 11px); a path row
(radius 9, 1px `--bd`, bg `--bg2`) with the full export path ellipsised in Mono 12px, a `Copy`
button and a solid accent `Open in DaVinci Resolve`; a `REVIEW EXPORT PAYLOAD` disclosure.

**Hand-off aside** (380px, radius 12, 1px `--bd`, bg `--surf`, `padding:18px`) under
`WHAT YOU'RE HANDING OFF`: four label/value rows separated by 1px rules — `Timeline items 6`,
`Effective runtime 20.3s`, `Source videos used 4`, `Speed ramps applied 2` — then `SOURCE FILES`,
each a colour chip + filename + item count (`2 items`, `1 item`).

## Screen 6 — Settings (`6a`, `6b`)

A 1380px dialog, radius 16, `grid-template-columns: 246px minmax(0,1fr)`, shadow
`0 30px 70px rgba(5,7,10,.55)`. **The three current tabs become four named panels in a left rail:**
`AI assistance` (badge `CLOUD`), `Connections` (`2`), `Diagnostics` (green dot), `General`. Active
rail item: bg `--accd` + `inset 2px 0 0 var(--acc)` — the one place a left bar is allowed, because
it is a rail item, not a selection. Rail footnote: "Settings are per machine. Cloud consent is per
project."

**AI assistance** — the panel the app is missing. Header `AI assistance` (18/600) + "Who scores your
footage and answers in Review. Changes take effect on the next request." + a 30×30 `✕`.
Under `SCORING ENGINE`, three radio cards (`padding:16px 18px`, radius 12, grid `20px | 1fr`, gap 14):

1. **Rule-based · local** + `DEFAULT` pill. "vidstab and OpenCV motion, blur and exposure
   thresholds. No semantic understanding, and nothing leaves this Mac."
   Facts row (Mono 10.5px): `seconds per video` · `free` · `works offline`.
2. **Pi Agent · cloud** (selected — accent-tinted card, `OPT-IN` pill, and
   `● consent granted · 1 project` in green). "Sends up to 4 sampled frames per candidate clip
   through your own Pi login, and judges visual interest only. Smoothness stays local — vidstab
   remains authoritative." Facts: `≈4s per clip` · `billed to your provider` · `needs network`.
   Nested account row (indented 34px, radius 10, bg `--surf`): `CONNECTED` pill, "Signed in to
   ChatGPT", `pi 0.8.1 · credentials in ~/.pi/agent/auth.json · never sent to the backend`, and
   `Reconnect` / `Sign out`.
3. **Local model · Qwen 3-VL** — disabled at `opacity:.5`, dashed radio.

**Connections** — MCP desktop clients only (the model account moved to AI assistance): "Let an
MCP-capable desktop client inspect candidates and edit the open timeline." Rows `padding:14px 16px`,
radius 12, bg `--bg2`, ring by state: **Claude Desktop** `connected` (green ring) + config path +
`Reconnect` · **Codex** `detected` + `~/.codex/config.toml` + solid accent `Connect` ·
**Cursor** `config unreadable` (amber ring) + "Malformed JSON at line 12 — fix or let the app
rewrite it from a backup." + `Reveal file` · **Windsurf** `not installed`, 50% opacity.
Then a written-config receipt: `WRITTEN` + "Restart Claude Desktop to finish. Previous config backed
up.", a `<pre>` on `#05070a` in Mono 10.5px showing the `"ai-clip-assembler"` server block, and the
backup filename in Mono 10px.

**Diagnostics** — "Sends a tiny prompt to the configured provider and model to confirm it answers."
plus `RAN 2 MIN AGO`. Success card: green ring, `REACHABLE` pill, `Replied "OK" in 5.0s`,
`Run again`; then a `<dl>` grid `150px | 1fr` — Provider `openai-codex`, Model `gpt-5.6-terra`,
Executable `/opt/homebrew/bin/pi`, Round trip `5.0s of 180s budget`.
**Failure card** (the state the app never designed): ring `red 34%`, `NOT REACHABLE` pill in
`--red`, "Timed out after 180s", a solid accent `Run check again`, the raw reason in Mono 11px
(`model "gpt-5.6-terra" not available to provider openai-codex`), then a **How to fix this**
ordered list (pick a routable model via AI assistance → Model; confirm the login; check `pi` on
PATH) and the note: "Environment-variable steps only take effect after quitting and reopening the
app. Until then Import falls back to rule-based scoring, so your project still works."

## Screen 7 — Harness choice on Import (`6c`)

The same decision as a toolbar popover instead of a bare `Harness` select. Trigger: 1px `--acc`,
bg `--accd`, green dot, `Scored by Pi Agent`, `⌄`. Popover (radius 12, bg `--surf`, ring `--bds`,
`0 18px 40px rgba(5,7,10,.55)`) headed `WHO SCORES THIS ANALYSIS`, with the three options as rows
(`padding:12px 13px`, radius 9; selected row `--accd` + ring `accent 38%`), each carrying its
consequences in Mono 10.5px: `seconds per video · nothing leaves this Mac` /
`≈4s per clip · 4 frames per clip leave this Mac · consent granted` (+ `READY` in green) /
`postponed in this build` (disabled). Footer: "Applies to this analysis run." +
`Open AI settings`. Copy rule: toolbar, status bar, Settings and Diagnostics all say
**"Pi Agent · cloud"** — never "harness", "pi_agent", or "AI review model" for the same thing.

## Interactions & Behavior

**Step gating (`5a`) — implement this; the current build renders `Continue to Review` as a plain
always-live link.** Gate in precedence order:

1. `sources === 0` → blocked · "Open a folder or drop MP4/MOV files first." — accent moves to
   `Open Folder`.
2. `clips === 0 && phase === 'analyzing'` → blocked · "Waiting for the first clip candidate…"
3. `clips === 0 && phase === 'complete'` → blocked · "No clip passed your rules." — accent moves to
   `Loosen rules and re-scan`; the sub-line states the thresholds that produced zero
   (`how steady 7.0 · max turn 12°/s · scene min 1.5s`).
4. `clips === 0` → blocked · "Analyze at least one video — Review has nothing to show." — accent
   moves to `Analyze N videos`; with nothing selected that button reads `Select videos to analyze`
   and is itself inert.
5. `clips > 0` → allowed. Warning notices ride along and never block: a harness fallback shows
   `16 clip candidates — scored by local rules` with an amber sub-line
   "pi agent unreachable · vidstab smoothness kept, visual interest not enhanced" and offers
   `Retry with Pi Agent` beside a live `Continue to Review →`.

Same shape for the two later gates, also ungated today: **Timeline** needs `acceptedCount > 0`,
**Export** needs `timelineItems.length > 0`. A blocked primary is always dashed + disabled with its
reason in an amber chip beside it — never a bare dead button, never a native alert after the click.

**Agent behaviour to add (`5b`)** — six things the app already does that the screens above don't
show:

1. **Harness picker** on the Import toolbar (screen 7) instead of status-bar text only.
2. **Cloud consent as a designed gate**, not a system confirm: "Let Pi Agent score this project in
   the cloud?" + what is sent ("up to 4 sampled frames per candidate clip — never whole videos,
   never audio"), the route ("your own Pi login: openai-codex / gpt-5.4-mini"), the boundary
   ("Smoothness stays local; the cloud only judges visual interest"), then `Keep it local` /
   `Allow for this project` and `REVOCABLE IN SETTINGS`. Ungranted consent reveals this inline in
   the popover rather than after the Analyze click.
3. **Proposal cards in the chat** — the Review agent runs in propose mode. Card: `AI · PROPOSAL` +
   time, a bulleted operation list, `timeline items 9 → 11 · revision 24`, `Accept` (solid accent) /
   `Reject`, and an `UNDOABLE` marker. Plus a three-dot "the AI is thinking…" indicator.
4. **Turn failure & retry** — a right-aligned user bubble keeps the typed message with
   `not sent · retry` in amber, and an amber `AI · ERROR` bubble says "The review agent could not
   complete that turn. Your clip decisions are untouched."
5. **All four version states**, not just "out of date": `IN WORKING TIMELINE` (green ring, "applied
   at revision 24"), `CURRENT SUGGESTION`, `OUT OF DATE` (amber), `UNAVAILABLE` (72% opacity, Apply
   inert, "missing source clips: …"). The agent returns three versions, not two.
6. **Analysis phases named as shipped**: `motion → frames → scenes → scoring · pi`, with
   `video 4/13` and `pi clips 7/12` counters and the footnote "vidstab keeps smoothness · pi judges
   interest".

**Other behaviour**

- Rail collapse is a persisted preference; it changes width 264 → 68 and swaps labels for centred
  icons/initials (values in *Screen anatomy*).
- View-mode switchers (Import table/thumbs/compact; Review grid/list/filmstrip) are per-screen,
  persisted, and swap only the list body.
- Analysis runs in the background — partial results are usable, so `Continue` stays live once one
  candidate exists; `Abort` is always reachable from the analysis card and the action bar.
- Every accepted/removed clip updates three places at once: the card state, the `Your clips` counts,
  and the status bar `N / M CLIPS KEPT`.
- Timeline gestures: drag blocks to reorder, drag edges to trim (trim may extend past the original
  candidate bounds, clamped to the source duration), wheel to zoom, `J K L` transport,
  `⇧ ← →` nudge, `⌫` delete. Every mutation is an undoable operation (`Undo`/`Redo` in the header).
- Motion is restrained: 140ms colour transitions, no movement on hover, no card lift. The only
  ambient animation in the reference is a `scan` keyframe for progress shimmer; respect
  `prefers-reduced-motion`.

## State Management

Nothing new at the data layer — the backend stays authoritative for the Timeline Document. UI state
the restyle needs:

| State | Scope | Notes |
| --- | --- | --- |
| `theme: 'dark' \| 'light'` | app, persisted | default **dark**, honour `prefers-color-scheme` on first run; two token maps on one markup tree |
| `railCollapsed: boolean` | app, persisted | 264 / 68 |
| `importView: 'table' \| 'thumbs' \| 'compact'` | Import, persisted | |
| `clipView: 'grid' \| 'list' \| 'filmstrip'` | Review, persisted | |
| `selectedSourceIds: Set<string>` | Import | drives the selection bar and `Analyze N` |
| `selectedHarness` + `effectiveHarness` + consent | project | the picker shows *selected*; the status bar and fallback notice show *effective* |
| `analysisPhase` + per-video / per-clip counters | Import | `motion / frames / scenes / scoring` |
| `gateState` | derived | from `sources`, `clips`, `phase`, `notices` — see the precedence list |
| `selectedTimelineItemId` | Timeline | inspector target |
| `settingsPanel: 'ai' \| 'connections' \| 'diagnostics' \| 'general'` | Settings modal | replaces the three tabs |
| `diagnosticsResult` | Settings | must model the failure branch, not only success |

## Assets

- `assets/logo.png` — the app mark, rendered 34×34 in the rail. Included here; the repo copy is
  `assets/logo.png` / `frontend/src/renderer/src/assets`.
- **No icon library.** The four workflow icons are inline 24×24 SVGs, `fill:none`,
  `stroke:currentColor`, `stroke-width:1.8`, round caps/joins — Import: down arrow into a baseline;
  Review: eye; Timeline: three stacked rounded rects; Export: up arrow over a baseline. Exact paths
  are in the `ICONS` block near the end of `app-reference.dc.html`. Everything else is a text glyph
  (`＋ ⚙ ◈ ✓ ✕ ▶ ■ ◀◀ ‹ › ⌄ ◆ →`) — replace with the codebase's icon component if one exists, keeping
  the same 26px marker and 34px button boxes.
- **Video frames are placeholders.** Every 16/9 and 9/16 well is a hatched placeholder labelled
  `clip frame` / `preview frame`. Real thumbnails come from the app's own frame extraction; keep the
  hatch as the loading/empty state.
- Fonts: IBM Plex Sans + IBM Plex Mono (Google Fonts in the reference; self-host and subset to Latin
  in the app).

## Responsive / window resizing

The mock is fixed at 1440px. In the app:

- The rail is fixed (264 / 68); `main` takes the remainder with `minmax(0,1fr)` and every inner
  column uses `min-width:0` so long filenames ellipsise instead of pushing layout.
- Import table → below ~1200px drop `FPS` then `Date`, keep `File`, `Duration`, `Size`, `Analysis`.
  Thumbs grid: 5 → 4 → 3 columns.
- Review: the 320px chat aside collapses to an icon toggle below ~1180px; the clip grid goes 3 → 2
  columns; version cards stack below ~1080px.
- Timeline: the 320px inspector is the last thing to collapse; the track area keeps its full width
  and scrolls horizontally at high zoom.
- Export: the 380px aside drops under the format cards below ~1100px.
- Nothing below 12.5px, ever; the mono meta line is the first thing to drop when space is tight.

## Known deltas to settle before/while building

These are open questions, not instructions — check with the design owner:

1. **Terminology.** The designs use product-facing words that `UBIQUITOUS_LANGUAGE.md` lists as
   aliases to avoid: "Suggested cuts" and "Your clips" (spec: **Candidate Clips**), the Review
   screen (spec: **Review Board**), "Rule-based · local" (spec: **Manual Harness**). The design's
   position is that the editor-facing UI should not speak the code's vocabulary. Keep the design copy
   verbatim unless the owner rules otherwise, but use the spec terms in code identifiers.
2. **Selected vs Effective Harness.** `5a` state 05 covers the fallback notice; the rest of the
   screens show only one harness. Wire both values.
3. **Look Groups** appear only as a `2 SIMILAR` badge. There is no designed "show the other 2" view.
4. **Not designed at all:** Undo History as a surface, external-agent activity over the MCP server,
   empty states for Review/Timeline/Export, and `UpdateBanner` / `UpdateSection`.
5. **Versions:** the reference draws 2 cards, the agent returns 3.

## Files

| File | What it is |
| --- | --- |
| `README.md` | this document — self-sufficient spec |
| `app-reference.dc.html` | the design reference; open in a browser at ≥1440px, or read the inline styles as the source of truth |
| `support.js` | runtime the reference needs to render — not app code, do not port |
| `image-slot.js` | drag-and-drop image placeholder used by the reference canvas — not app code |
| `assets/logo.png` | app mark used in the rail |

Reference ids inside the file: `4a` `4b` (system) · `1d` (Import) · `1b` (Review) · `3a` (Timeline)
· `3b` (Export) · `6a` `6b` (Settings) · `6c` (harness popover) · `5a` (gating) · `5b` (agent gaps)
· `1c` `1a` (current build, for comparison only).

The sibling folder `design_handoff_landing_page/` carries the marketing page for the same product on
the same token set.
