# 032: Exports that open in Final Cut Pro and DaVinci Resolve

FCPXML opens in Final Cut Pro and Resolve XML opens in DaVinci Resolve with no
relink dialog, from an export of the Timeline as it is; a DTD check and golden
fixtures in CI guard both files on every PR.

## Context

Roadmap milestone 1b ([../ROADMAP.md](../ROADMAP.md)). Opened from
[issue #80](https://github.com/evilkels/ai-clip-assembler/issues/80), the first
outside bug report: a 3840x2160 60 fps FCPXML 1.10 export, Final Cut Pro
rejected it on DTD validation (`Element asset content does not follow the DTD,
expecting (media-rep+ , metadata?)`, `No declaration for attribute src of
element asset`), then warned on `sequence/@format`. Hand-fixing both made it
import cleanly. Research triage
(`vision-2026-10-08/research-a.md`, Export and NLE rows) adds that empty
authoritative Timelines fall back to old clips and that NLE import, relinking,
audio and framing equivalence are unverified.

Defects, re-verified against `main` at 2874cd1 on 2026-10-08:

1. `<asset>` carries `src` and has no `<media-rep>` child
   (`backend/src/export_engine.py:437`). Reproduced: running today's generator
   through `xmllint --dtdvalid FCPXMLv1_10.dtd` gives exactly the two errors in
   the report; moving `src` into `<media-rep kind="original-media">` and
   dropping the format `name` makes the same document validate.
2. The format `name` is interpolated from a rounded float
   (`export_engine.py:424`): `p60.0`, `p29.97`, `p59.94`, `p23.98`. None is an
   Apple identifier.
3. 23.976 fps exports as 24 fps: `fcpx_frame_duration` (`export_engine.py:28`)
   handles 29.97 and 59.94 and rounds everything else, so 23.976 becomes
   `100/2400s`. Times are written as milliseconds (`seconds_to_fcpx_duration`,
   `:23`), not frame-aligned to any rate. Resolve XML counts frames at the
   integer timebase (`seconds_to_frames`, `:208`), so 23.976 and 59.94 sources
   drift 0.1 % against their real frame positions.
4. Media paths are relative (`path_to_asset_src`, `:65`) whenever the project
   has a folder, and the route always passes `media_base_path`
   (`backend/src/api.py:1413`, `:1426`). FCPXML `src` and XMEML `<pathurl>`
   (`:322`) both expect a URL. The relink dialog the owner saw in Resolve
   matches this.
5. Export prefers the Timeline Document only when it has items, else the legacy
   clip list (`api.py:1393`). A Timeline the Editor emptied exports the old
   clips.
6. Asset ids are `asset-<file_id>`; for folder projects `file_id` is the file
   name, so a name with a space is not a valid XML `ID`.

`backend/tests/test_export_engine.py` asserts the invalid shape
(`asset.attrib["src"]` at line 80, relative paths at 192–221 and 608–639), so CI
stays green while Final Cut refuses the file.

Owner decisions (2026-10-08): media paths are absolute file URLs, no
relative-path option in v1.0.0; exports must pass in Resolve and Final Cut;
Premiere and EDL are best-effort (keep EDL working, no Premiere-specific
work); an empty authoritative Timeline never falls back to old clips; 23.976
exports as 24000/1001 rational timing. Plan [036](036-proper-tests-and-checks.md)
explicitly leaves DTD validation to this plan; this plan owns the DTD fixture,
the validator helper and every export test. Plan 039 (milestone 5) later adds
Marker export to the same two generators; the structure fixed here leaves room
for it (see Decisions).

### Decisions

- **FCPXML version 1.10.** The reporter's Final Cut accepted 1.10 once fixed,
  Resolve 18+ imports 1.10, and Apple publishes the 1.10 DTD at
  <https://developer.apple.com/documentation/professional-video-applications/document-type-definition>.
  No newer feature is needed.
- **DTD vendored, validated with lxml.** `backend/tests/fixtures/fcpxml/FCPXMLv1_10.dtd`,
  copied from Apple's page (identical to the copy iMovie ships at
  `/Applications/iMovie.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd`,
  SHA-256 `32cbad28022f9a2033acdc25d0583b16d2e12745dc5efe4fa8f16e27aa59ff53`,
  40480 bytes). A `README.md` beside it records source URL, date and hash.
  `lxml==5.3.0` goes in `backend/requirements.txt`; the helper
  `assert_valid_fcpxml(xml_text)` in `backend/tests/support.py` parses with
  `lxml.etree` and raises with the DTD error log. lxml, not `xmllint`, because
  it runs identically in the venv locally and on the CI runner with no apt step.
- **Resources.** `<format>` elements first, `r1` = the sequence format, then one
  per distinct source `(width, height, frameDuration)` that differs, `r2..`.
  No `name` attribute anywhere (`#IMPLIED` in the DTD; Final Cut derives the
  format from `frameDuration`, `width`, `height`, so an absent name cannot be
  wrong). Assets are `a1..aN` in `videos_by_id` order, each with `name`,
  `start="0s"`, `duration` (frame-aligned at the source rate), `hasVideo="1"`,
  `format="rN"` of its source, and when the source has audio `hasAudio="1"`,
  `audioSources="1"`, `audioChannels`, `audioRate`. The only child is
  `<media-rep kind="original-media" src="file:///…"/>`.
- **Sequence and clips.** `<sequence format="r1" tcStart="0s" tcFormat="NDF">`
  plus `audioLayout` = `mono` (max 1 channel), `stereo` (2) or `surround`
  (3+), omitted when no source has audio. Each `<asset-clip>` keeps `ref`,
  `name`, `offset`, `duration` (sequence rate), `start` (source rate),
  `audioRole="dialogue"` when the source has audio, and `format="rN"` when the
  source format is not `r1`. Child order stays `timeMap`, `adjust-transform`;
  plan 039 inserts `<marker>` after `adjust-transform`, which is where the DTD
  puts `%marker_item;`.
- **Rational time.** `fcpx_frame_duration(fps) -> Fraction`: 23.976 → 1001/24000,
  29.97 → 1001/30000, 47.952 → 1001/48000, 59.94 → 1001/60000, 119.88 →
  1001/120000, matched within ±0.02 (ffprobe gives 59.9400599 for
  `60000/1001`); any other rate rounds to an integer `n` and gives
  `100/(100 n)`. `fcpx_time(seconds, fps) -> str` rounds to the nearest frame
  and writes `frames*num/den` over the frame duration's own denominator,
  `0s` for zero: 10 s at 23.976 is `240240/24000s`. `seconds_to_fcpx_duration`
  is deleted. The exact rate `fps_exact(fps) -> Fraction` (24000/1001 for
  23.976, `n` for integers) is shared with the XMEML frame counter.
- **Media URLs.** FCPXML `src` = `path_to_file_url` (`file:///Users/…`,
  percent-encoded, `Path.absolute()`); XMEML `<pathurl>` =
  `file://localhost/Users/…`, the form FCP7 XML defined and Resolve itself
  writes. `path_to_asset_src` and the `media_base_path` parameters are
  deleted.
- **Resolve XML.** Still XMEML version 5 with the `<!DOCTYPE xmeml>` header.
  Frame counts use `fps_exact`, so a 23.976 source keeps `timebase 24`,
  `ntsc TRUE` and frames at 24000/1001. There is no DTD to validate against;
  `assert_well_formed_xmeml(xml_text)` in `support.py` checks the structure
  listed in task 3.2.
- **Authoritative Timeline.** Export always reads
  `get_timeline_controller(project_id).document` (the controller already
  migrates a legacy `timeline` on first load). An empty document exports an
  empty but valid file with `clip_count: 0` and the warning
  `The Timeline is empty, so this export has no clips.` in `warnings`.
- **EDL.** Unchanged except by the shared helpers; it carries reel names, not
  paths. `round_edl_fps` stays (23.976 → 24 NDF).
- **Fixtures.** Golden files under `backend/tests/fixtures/export/`, generated
  from synthetic metadata that mirrors real footage, compared as exact text:
  `estepona-1080p5994.fcpxml` and `.xml` (four 1920x1080 59.94 HEVC stereo
  sources, one rotated 90°, a 0.5x retime and a 1.2x zoom, like
  `~/Movies/DRONE_VIDEO/ESTEPONA_03-05-26`); `iphone-4k60-mixed.fcpxml` (3840x2160
  at 60 and 30 fps, stereo, the #80 case); `cinema-23976-silent.fcpxml` and
  `.xml` (1920x1080 at 23.976, one silent and one mono source). Inputs live in
  `fixtures/export/inputs.py`. The real Estepona folder is the human QA
  project; it is never read by tests.
- **Portability.** With absolute URLs, moving the project folder breaks the
  links in an existing export by design. The promise becomes: reopen the moved
  folder in the app and export again. ADR 0009 records this and amends the
  "exports live next to footage" reasoning in
  [done/project-folder-model.md](done/project-folder-model.md).

## Phase 1: Absolute media paths and the Timeline as exported

- [ ] 1.1 Write absolute file URLs in both generators and remove relative paths.
  Delete `path_to_asset_src` and the `media_base_path` parameters of
  `generate_fcpxml` and `generate_resolve_xml`; add `path_to_fcp7_pathurl`
  (`file://localhost` prefix); drop the two `media_base_path` lines in
  `export_timeline` (`api.py:1413`, `:1426`). Done when
  `test_generate_fcpxml_links_media_by_absolute_file_url` (path with a space
  and a non-ASCII letter → percent-encoded `file:///…`),
  `test_generate_resolve_xml_pathurl_is_absolute_localhost_url`, and the
  rewritten `test_export_folder_project_*` assertions in
  `backend/tests/test_api.py` (lines 1402 and 1441) pass, and the two relative
  tests in `test_export_engine.py` (lines 192 and 608) are gone.
- [ ] 1.2 Export reads only the Timeline Document (`api.py:1390–1396`); delete
  `clips_in_timeline_order` if nothing else calls it. Done when
  `test_export_empty_timeline_document_does_not_fall_back_to_legacy_clips`
  (legacy `timeline.clips` holds one clip, every document item removed through
  the controller, export of each format returns `clip_count == 0` and the
  empty-Timeline warning) passes, and
  `test_export_timeline_keeps_present_but_empty_edited_timeline_empty` still
  passes.
- [ ] 1.3 Update copy and scripts that promise relative paths. Export page
  description (`frontend/src/renderer/src/routes/Export.tsx:195`) becomes
  `Exports link to your original files by their full path. Keep the footage
  where it is, or export again after moving it.`; `docs/USER_GUIDE.md:156`,
  `docs/MANUAL_QA_GUIDE.md:107–110`, `docs/QA.md:93–95` and
  `scripts/synthetic_e2e_qa.py:230–231` say and check `file://` absolute URLs.
  Done when `grep -rn "relative" docs/USER_GUIDE.md docs/MANUAL_QA_GUIDE.md
  docs/QA.md frontend/src/renderer/src/routes/Export.tsx` finds no media-path
  sentence and `python3 scripts/synthetic_e2e_qa.py` passes its export checks.
- [ ] 1.4 Write `docs/adr/0009-exports-link-media-by-absolute-file-url.md`
  (status Accepted; context: relative paths produced invalid URLs and a relink
  dialog; decision: absolute URLs in both XML formats, re-export after a move;
  consequences: QA Flow C becomes H4 here) and add it to `docs/adr/README.md`.
  Done when both files exist and `python3 scripts/plans.py check` passes.

## Phase 2: FCPXML that validates against the 1.10 DTD

- [ ] 2.1 Vendor the DTD, pin lxml, add `assert_valid_fcpxml` to
  `backend/tests/support.py`, and add
  `test_generate_fcpxml_validates_against_the_1_10_dtd` on the Estepona-shaped
  inputs. Done when the DTD file, its README with the SHA-256, and
  `lxml==5.3.0` are in place and the new test fails on the current generator
  with the `media-rep` error from #80.
- [ ] 2.2 Restructure resources as decided: `<media-rep>` child, no `src` on
  `<asset>`, `a1..aN` asset ids, `format="rN"` on assets, `start="0s"`, no
  format `name`. Done when 2.1's test passes,
  `test_generate_fcpxml_asset_has_media_rep_and_no_src`, and
  `test_generate_fcpxml_ids_are_valid_for_file_names_with_spaces` (file id
  `My clip.MOV`, document still DTD-valid) pass, and the asserts at
  `test_export_engine.py:80` and `:127` are rewritten to the new shape.
- [ ] 2.3 Rational timing (after 2.2). Implement `fcpx_frame_duration` as a
  `Fraction`, `fps_exact`, and `fcpx_time`; use them for every `offset`,
  `start`, `duration`, `timept` and asset `duration`. Done when
  `test_fcpx_frame_duration_covers_the_rate_table` asserts the exact strings
  for 23.976, 24, 25, 29.97, 30, 47.952, 50, 59.94, 60 and 119.88,
  `test_fcpx_time_is_frame_aligned` asserts `240240/24000s` for 10 s at 23.976
  and `0s` for zero, and `test_generate_fcpxml_23976_source_exports_24000_1001`
  asserts `frameDuration="1001/24000s"` and a `timept` on a frame boundary.
- [ ] 2.4 Mixed sources (after 2.3). One `<format>` per distinct source shape,
  `format` on each `<asset>` and on `<asset-clip>` when it differs from `r1`,
  `audioLayout` on the sequence. Done when
  `test_generate_fcpxml_mixed_30_and_60_sources_get_their_own_formats` (two
  formats, the 30 fps clip's `start` at 30 fps and its `offset` at 60 fps) and
  `test_generate_fcpxml_sequence_audio_layout_follows_sources` (stereo,
  mono, surround, absent) pass and the document is DTD-valid in each.
- [ ] 2.5 Golden FCPXML fixtures (after 2.4). Add `fixtures/export/inputs.py`
  and the three `.fcpxml` files; `test_fcpxml_golden_fixtures_are_unchanged`
  compares generated text to each file and runs `assert_valid_fcpxml` on
  each; a `--update-export-fixtures` pytest option rewrites them. Done when
  the test passes and a one-character change to `generate_fcpxml` fails it
  with a readable diff.

## Phase 3: Resolve XML structure checks

- [ ] 3.1 Count XMEML frames at the exact rate: `seconds_to_frames` uses
  `fps_exact`. Done when `test_seconds_to_frames_uses_exact_ntsc_rate`
  (60 s at 23.976 → 1438 frames, at 59.94 → 3596) passes and
  `test_generate_resolve_xml_builds_xmeml_timeline` still passes unchanged.
- [ ] 3.2 Add `assert_well_formed_xmeml` to `support.py` and
  `test_generate_resolve_xml_passes_structure_checks` over the Estepona-shaped
  inputs. Checks: `<!DOCTYPE xmeml>` header; `xmeml@version == "5"`; sequence
  `duration` equals the last video clipitem `end`; every `<rate>` has
  `timebase` and `ntsc`; each `file@id` has exactly one full definition with a
  `pathurl` starting `file://localhost/`; for each clipitem with speed 1,
  `end - start == out - in`; each audio clipitem shares its video clipitem's
  id, `start` and `end`; every `<link>` points at an existing track index and
  clip index. Done when the test passes and removing `pathurl` from the
  generator fails it.
- [ ] 3.3 Golden XMEML fixtures (after 3.1): `estepona-1080p5994.xml` and
  `cinema-23976-silent.xml` in the same golden test as 2.5, each also run
  through `assert_well_formed_xmeml`. Done when the test passes on both.

## Phase 4: EDL, docs and gates

- [ ] 4.1 Confirm EDL is untouched by the helper changes:
  `test_export_timeline_uses_source_fps_for_edl_timecode` and
  `test_generate_edl_*` pass; add `test_generate_edl_has_no_media_paths`
  (no `file:` or `/` path in any event line). Done when all EDL tests pass.
- [ ] 4.2 Update `docs/ARCHITECTURE.md` Export section and `GLOSSARY.md`'s
  FCPXML entry to name version 1.10 and the DTD fixture; point
  [drone-workflow-qa-flows](drone-workflow-qa-flows.md) Flow C at H4 here.
  Done when `grep -n "1.10" docs/ARCHITECTURE.md GLOSSARY.md` finds both and
  `python3 scripts/plans.py check` passes.
- [ ] 4.3 Full gates: `npm run lint`, `npm run typecheck`, `npm run test:backend`,
  `npm run test:main`, `npm run test:e2e` from `frontend/`. Done when all pass
  locally and `.github/workflows/test.yml` is green on the PR.

## Human tasks

- [ ] H1 Get Final Cut Pro: the Mac App Store trial (90 days) on the dev Mac,
  or a borrowed Mac. Record the Final Cut version used.
- [ ] H2 DaVinci Resolve QA on the Estepona project
  (`~/Movies/DRONE_VIDEO/ESTEPONA_03-05-26`), after Phases 1–3 ship. Before
  exporting, note on the Export page: N = Timeline items, R = Effective runtime,
  and which items carry Speed or Transform. Then:
  1. Export for DaVinci Resolve; open `exports/davinci/timeline.xml` with
     File → Import → Timeline (or the Open in DaVinci Resolve button).
  2. Expect: no relink or "media offline" dialog; a timeline named
     `AI Clip Assembler`; exactly N clips on V1; timeline duration within one
     frame of R; timeline frame rate 59.94; resolution 1080x1920 if the first
     source is the rotated DJI file, else 1920x1080.
  3. Every clip from a stereo source shows waveforms on A1 and A2, linked to
     its video; a silent source adds no audio clip.
  4. A retimed item shows the matching speed in the Retime controls; a zoomed
     item shows the matching Zoom and Position in the Inspector; untouched
     items show 100 % and Zoom 1.0.
  5. Scrub the first and last clip: picture matches the Review preview at the
     item's in and out points.
  Record date, app version, Resolve version and pass/fail per step as a
  sub-bullet here. A failure reopens Phase 3 with the symptom.
- [ ] H3 Final Cut Pro QA (after H1 and Phases 1–2), same project plus, if
  available, one 3840x2160 60 fps iPhone clip and one 23.976 clip in a second
  folder:
  1. Export FCPXML; in Final Cut, File → Import → XML…, choose
     `exports/fcp/timeline.fcpxml`.
  2. Expect: no DTD error dialog and no format warning sheet; a library event
     and a project both named `AI Clip Assembler`.
  3. Project properties: 1080x1920 (or 1920x1080) at 59.94p; for the second
     folder 3840x2160 at 60p and 1920x1080 at 23.98p respectively.
  4. N clips in the primary storyline; project duration within one frame of R;
     each clip's start matches the Review item's in point.
  5. Audio: stereo clips show waveforms with role Dialogue; silent clips show
     none. Retime: the slowed item shows its percentage. Transform: the zoomed
     item shows the matching Scale and Position in the Video inspector.
  Record date, app version, Final Cut version and pass/fail per step. A
  failure reopens Phase 2 with the exact dialog text.
- [ ] H4 Moved-folder check (after H2): move the Estepona folder to another
  disk, open it in the app from its new location, export Resolve XML again and
  import it. Expect zero relink prompts. Also open the old export to confirm
  the expected behaviour: Resolve asks to relink, and Relink to the new folder
  succeeds. Record both outcomes.
- [ ] H5 Reply on issue #80 with the release that contains H3's build and ask
  the reporter to try their own footage; close the issue with a link to this
  plan when they confirm or after two weeks without reply.
