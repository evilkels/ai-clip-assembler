# Plan 032: Valid FCPXML, and exports verified in the real NLEs

Status: TODO · Priority P1 · Effort M · Risk MED · Category correctness + handoff
Created 2026-09-11 against `e94783c` (v0.3.1). Opened from
[issue #80](https://github.com/evilkels/ai-clip-assembler/issues/80), the first
outside bug report this project has received.

> **For agentic workers:** Phase 0 is a decision only the owner can make and it
> changes Phases 1 and 3 — do not start coding before it is answered. Phases 1–4
> are code and can be done by an agent. Phase 5 is human QA in applications an
> agent cannot drive; record its results in this file rather than claiming them.

## Why

An outside reporter exported a 4K 60 fps timeline as FCPXML 1.10 and Final Cut
Pro refused it, first on DTD validation and then with a format warning. They
fixed both by hand and the same timeline imported cleanly.

Both claims reproduce by running the generator — no need to take the report on
trust. For a 4K60 project the current output is:

```xml
<format id="r1" name="FFVideoFormat3840x2160p60.0" frameDuration="100/6000s" width="3840" height="2160" />
<asset id="asset-IMG_3607.MOV" name="IMG_3607.MOV" src="file:///Users/x/proj/IMG_3607.MOV" duration="11305/1000s" hasVideo="1" .../>
```

Verifying that turned up four defects, two of them unreported.

1. **`<asset>` carries `src` and has no `<media-rep>` child.**
   `export_engine.py:437` puts the path straight on the element. The FCPXML 1.10
   DTD expects `(media-rep+, metadata?)` as the asset's content and declares no
   `src` attribute on it, so Final Cut rejects the document before it gets to the
   timeline.

2. **The predefined format name is interpolated from a rounded float.**
   `export_engine.py:424` builds `f"FFVideoFormat{width}x{height}p{round(fps, 2)}"`.
   A rate sweep gives `p60.0`, `p29.97`, `p59.94`, `p23.98` and `p30.0` — none of
   which are Apple identifiers. The reporter hit only the 60 case.

3. **23.976 fps exports as a 24 fps timeline.** *(unreported)*
   `fcpx_frame_duration` (`export_engine.py:28`) special-cases 29.97 and 59.94,
   then falls back to `round(fps)`, so 23.976 yields `100/2400s` — exactly 1/24 s
   instead of `1001/24000s`. That is ~3.6 s of drift per hour of timeline. The
   same fallback mishandles 47.952 and 119.88.

4. **Media paths are bare relative paths, not URLs.** *(unreported)*
   `path_to_asset_src` (`export_engine.py:65`) returns `../../IMG_3607.MOV`
   whenever the project has a folder, which is the normal case. That value is
   written to the FCPXML `src` **and** to FCP7 XMEML's `<pathurl>`
   (`export_engine.py:322`), where a URL is expected. This is the prime suspect
   for the relink prompt the owner hit in DaVinci Resolve after importing a
   timeline — which is a direct failure of success criterion 3 in
   [drone-workflow-qa-flows](drone-workflow-qa-flows.md): *"opening the exported
   DaVinci timeline resolves all media with zero relink prompts."* Not yet
   confirmed; Phase 3 confirms or refutes it before changing anything.

### Why this shipped

`backend/tests/test_export_engine.py` parses the generated XML and asserts the
shape it currently produces — `test_generate_fcpxml_references_assets_and_timeline_clips:80`
asserts `asset.attrib["src"]`. The tests lock the invalid structure in place, so
CI stays green while Final Cut refuses the file. The reporter's own last
suggestion is the right one: validate against schema behaviour, not only against
"does ElementTree parse it".

`export_engine.py` has not changed since before v0.2.0, so every release is
affected, including v0.3.1.

## Phase 0 — Decide the media path policy (owner)

- [ ] **Step 0.1** Decide how exports reference source media. This is a product
      decision with no safe default, and Phases 1 and 3 both depend on it.
      - *Absolute `file://` URL* — resolves in both NLEs with no ambiguity, and
        breaks the moment the project folder moves to another volume.
      - *Relative, as a proper URL* — keeps QA Flow C portability, but each NLE
        resolves relative references against a different base, so it must be
        verified in both rather than assumed.
      Record the decision here, with the reason. If it changes the portability
      promise, it needs an ADR alongside
      [ADR 0004](../adr/0004-editable-export-and-edl-degradation.md).

## Phase 1 — Make FCPXML structurally valid

- [ ] **Step 1.1** Emit `<media-rep kind="original-media" src="..."/>` as a child
      of each `<asset>` and stop writing `src` on the asset element.
- [ ] **Step 1.2** Rewrite the tests that asserted the old shape so they assert
      the structure the DTD requires — a `media-rep` child exists, carries the
      path, and `<asset>` has no `src` attribute. Update
      `test_generate_fcpxml_can_reference_assets_relative_to_export_dir` to look
      in the same place.

## Phase 2 — Stop inventing format identifiers and frame rates

- [ ] **Step 2.1** Replace the interpolated name with a lookup of rates the
      project can actually name. Where there is no known identifier, omit the
      `name` attribute rather than guess it: Final Cut falls back to
      `frameDuration`, `width` and `height`, so an absent name cannot be wrong
      while a fabricated one can.
- [ ] **Step 2.2** Give `fcpx_frame_duration` an explicit table for the NTSC
      family — 23.976 → `1001/24000s`, 29.97 → `1001/30000s`, 47.952 →
      `1001/48000s`, 59.94 → `1001/60000s`, 119.88 → `1001/120000s` — and keep
      the integer path only for integer rates.
- [ ] **Step 2.3** Tests across the full rate table: 23.976, 24, 25, 29.97, 30,
      50, 59.94, 60. Assert the exact `frameDuration` string, and that no name is
      emitted for a rate the table does not cover.

## Phase 3 — Media paths in both exporters

- [ ] **Step 3.1** Reproduce the Resolve relink prompt locally before changing
      anything. Resolve is installed on the dev machine; export a timeline from a
      real project folder, import it, and record whether media resolves. This
      either confirms defect 4 or sends it back for diagnosis.
- [ ] **Step 3.2** Apply the Phase 0 decision to the FCPXML `media-rep` and the
      XMEML `<pathurl>` together. They are the same helper today and should stay
      that way unless the NLEs prove otherwise.
- [ ] **Step 3.3** EDL carries no media paths — it references reel names — so it
      needs no change here. Confirm that is still true rather than assuming it.

## Phase 4 — Test at the schema level, not the parser level

- [ ] **Step 4.1** Add a conformance test over generated FCPXML that asserts the
      element structure the DTD requires, not the attributes the generator
      happens to emit. If Apple's DTD can be lawfully vendored into the repo,
      validate against it directly; if not, encode its constraints explicitly and
      say in a comment why the DTD is not present.
- [ ] **Step 4.2** Golden fixtures for one 4K60 and one 23.976 project, so a
      future change to the generator shows up as a diff a human can read.
- [ ] **Step 4.3** Full gates: backend, ruff, lint, typecheck, `test:main`,
      Playwright.

## Phase 5 — Verify in the real NLEs (human QA, scheduled)

No automated test can stand in for this, and nobody on this project has ever
opened an export in Final Cut Pro. That gap is the reason issue #80 exists.

**Cadence: once per minor release, and always before announcing a release that
touched `export_engine.py`.** Record each pass in the table below rather than in
a commit message; an unrecorded pass did not happen.

- [ ] **Step 5.1** Get Final Cut Pro access — trial, borrowed Mac, or the
      reporter verifying a build. Until one of those exists, FCPXML ships
      unverified and the plan says so out loud.
- [ ] **Step 5.2** Export each of the three formats from one real project and
      open each in its NLE: Resolve XML and FCPXML in Resolve, FCPXML in Final
      Cut, EDL in both.
- [ ] **Step 5.3** Cover the cases that broke: 4K 60 fps, a 23.976 source, a
      mixed-rate project, a vertical source, an audio-bearing clip and a silent
      one.
- [ ] **Step 5.4** Move the project folder to another volume and repeat — QA
      Flow C. Zero relink prompts is the bar.
- [ ] **Step 5.5** Record the results and reply on issue #80 with a build the
      reporter can check.

| Date | Version | NLE | Format | Result |
|---|---|---|---|---|
| — | — | — | — | Not run |

## Done criteria

- [ ] Final Cut Pro imports a generated FCPXML with no DTD error and no format
      warning, verified by a human in the application.
- [ ] DaVinci Resolve imports both the Resolve XML and the FCPXML with zero
      relink prompts, before and after the project folder moves.
- [ ] A 23.976 fps source produces a 23.976 fps timeline, not 24.
- [ ] No export contains a format identifier the project cannot cite a source for.
- [ ] The generator's structure is covered by tests that fail when `<asset>`
      regains a `src` attribute.
- [ ] Issue #80 is answered with a verified build.
