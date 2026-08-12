# Plan 024: Source audio in exports

Status: TODO · Priority P1 · Effort M · Risk HIGH · Category export correctness
Depends on Plan 021 · Planned 2026-08-12

## Why and current evidence

Every export writer is currently video-only. `parse_ffprobe_metadata` already
receives `-show_streams` output but selects only the first video stream, so the
audio stream is discarded before export. This is a missing capability, not a
regression: the existing Resolve XML has only a sequence `<video>` branch and
video-only file media; FCPXML assets have only `hasVideo="1"`; EDL events use
`V` unconditionally.

The priority handoff is the Resolve XMEML export. A valid XML document can still
import as video-only if the audio track declarations, source tracks, or link
groups are wrong, so the implementation must be checked against Apple's FCP7
XMEML schema and then against a real DaVinci Resolve import. Silent source files
remain valid first-class inputs: they must produce video-only items without
invented audio.

## Target data contract and boundaries

Extend `VideoMetadata` with these serialized fields, all defaulted so old
metadata remains readable:

```python
has_audio: bool = False
audio_channels: Optional[int] = None
audio_sample_rate: Optional[int] = None
audio_codec: Optional[str] = None
audio_bit_depth: Optional[int] = None
```

`has_audio` means that an audio stream exists. The other fields describe the
first audio stream returned by ffprobe. Parse `channels`, `sample_rate`,
`codec_name`, and the best positive value from `bits_per_sample` or
`bits_per_raw_sample`; use XMEML's legal fallback depth `16` when a compressed
codec does not expose a sample depth. A missing stream produces
`has_audio=False` and all optional audio fields `None`.

This plan supports the normal camera/drone container contract of one audio
stream, including mono, stereo, and more-than-two channel audio represented as
one stream. Multiple independent audio streams are not silently merged: record
the limitation in the implementation review and stop for a small follow-up if
real footage exposes them. Do not claim multi-source audio passthrough merely
because `audioSources="1"` is present in FCPXML.

The project manifest (`clipassembler/project.json`) stores filenames and does
not store `VideoMetadata`; folder projects re-probe source media on open.
Analysis results persist clips/timeline, not the source metadata. Therefore no
`project_store.py` schema bump or migration is needed. Pydantic defaults must
still make old in-memory/upload metadata and any old serialized
`VideoMetadata` payloads validate; missing audio fields mean “unknown/absent”
and must not create audio in an export. There is no separate API-model file:
the API serializes `VideoMetadata.model_dump()` directly.

## Execution steps

### 1. Add tolerant audio metadata at the probe boundary

**Files:**

- Modify: `backend/src/models.py:VideoMetadata`
- Modify: `backend/src/video_probe.py:parse_ffprobe_metadata`
- Test: `backend/tests/test_video_probe.py`
- Inspect only: `backend/src/project_store.py`, `backend/src/api.py`

**Interfaces:**

- Consumes: ffprobe's existing `payload["streams"]` array.
- Produces: `VideoMetadata` with the five audio fields above, serialized by
  the existing upload and folder-project API paths.

- [ ] **Step 1: Define the backward-compatible fields.** Keep all new fields
  optional/defaulted as specified above. Do not make an audio field required;
  old project results, test doubles, and source records without audio keys must
  continue to validate and export video-only.

- [ ] **Step 2: Parse the first audio stream independently of video order.**
  Select the first `codec_type == "audio"` stream, whether it appears before or
  after video. Convert valid positive numeric strings to integers. Treat absent,
  zero, malformed, or negative channel/rate/depth values as unavailable rather
  than raising while probing an otherwise usable video. Set `has_audio` from
  stream existence, not from whether optional fields happened to parse.

- [ ] **Step 3: Add probe tests.** Cover audio-before-video with AAC, 2 channels,
  48,000 Hz, and missing bit depth; assert `has_audio`, channels, rate, codec,
  and the depth fallback. Cover a payload containing only a video stream and
  assert `has_audio is False` plus `None` optional fields. Cover an old
  `VideoMetadata`-shaped dict with no new keys and assert Pydantic validation
  succeeds with the silent defaults.

**Acceptance criteria:** `parse_ffprobe_metadata` preserves the current video
fields and returns deterministic audio metadata; no-audio footage probes
successfully; old metadata validates without a project-store migration; and the
focused probe tests pass.

### 2. Build Resolve XMEML audio as linked, per-channel tracks

**Files:**

- Modify: `backend/src/export_engine.py:generate_resolve_xml` and focused XML
  helpers
- Modify: `backend/src/api.py:export_project` only if the EDL warning/signature
  change in Task 5 requires the shared call site update
- Test: `backend/tests/test_export_engine.py`

**Interfaces:**

- Consumes: `clips`, `videos_by_id`, and normalized `VideoMetadata` audio
  fields.
- Produces: XMEML v5 with a sequence audio branch only when at least one
  timeline source has audio.

- [ ] **Step 1: Preserve the existing video branch and add explicit source
  media typing.** Each video sequence `clipitem` gets
  `<sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>`.
  Keep the existing video timing, relative paths, Basic Motion, and source-file
  deduplication behavior.

- [ ] **Step 2: Declare audio on each first-use source file.** Under the
  existing `<file><media>`, add this shape only for an audio-bearing source:

  ```xml
  <media>
    <video>...</video>
    <audio>
      <channelcount>2</channelcount>
      <format>
        <samplecharacteristics>
          <depth>16</depth>
          <samplerate>48000</samplerate>
        </samplecharacteristics>
      </format>
    </audio>
  </media>
  ```

  `channelcount` is a direct child of `audio`; `depth` and `samplerate` belong
  under `audio/format/samplecharacteristics`. Do not invent an XMEML audio
  codec element: the v5 schema defines audio sample characteristics as depth
  and sample rate, while the parsed codec remains useful source metadata. A
  repeated file reference must continue to be only `<file id="..."/>`, while
  its first declaration carries both video and audio media.

- [ ] **Step 3: Add the sequence audio branch.** Under the sequence's existing
  `<media>`, add `<audio>` after `<video>` when any timeline item has audio.
  Add an audio `<format><samplecharacteristics>` using the first audio-bearing
  source's positive sample rate and bit depth, with 48,000/16 fallbacks. Create
  one sequence `<track>` per source channel up to the maximum channel count
  present in the timeline. This deliberately represents stereo as two mono
  tracks (source track indices 1 and 2), matching Apple's XMEML stereo example
  and preserving left/right channel identity instead of asking Resolve to
  reinterpret one multichannel item. A mono source occupies track 1; a mixed
  timeline leaves absent channel tracks empty for that item.

- [ ] **Step 4: Mirror every audio-bearing video item.** For a timeline item
  with `N` source channels, create one audio `clipitem` in each of the first
  `N` sequence audio tracks. Each mirrored item must carry the same
  `<name>`, `<duration>`, `<rate>`, `<start>`, `<end>`, `<in>`, and `<out>` as
  its video item, reference the same file id, and contain:

  ```xml
  <sourcetrack>
    <mediatype>audio</mediatype>
    <trackindex>1</trackindex>
  </sourcetrack>
  ```

  Use the corresponding 1-based channel index for each audio track. Give the
  video and its mirrored audio items the same deterministic `id` based on the
  existing item index (for example, `clipitem-1`) so they use XMEML's
  documented shared-id convention and are one linked edit in Resolve.

- [ ] **Step 5: Emit the link group on each video clipitem.** For a stereo
  item, emit three links on the video clipitem, in this order:

  ```xml
  <link><mediatype>video</mediatype><trackindex>1</trackindex><clipindex>1</clipindex></link>
  <link><mediatype>audio</mediatype><trackindex>1</trackindex><clipindex>1</clipindex><groupindex>1</groupindex></link>
  <link><mediatype>audio</mediatype><trackindex>2</trackindex><clipindex>1</clipindex><groupindex>1</groupindex></link>
  ```

  `clipindex` is the 1-based item position in the sequence, not the source
  frame. Use one shared `groupindex` for the stereo pair; omit `groupindex`
  for a mono channel. For more than two channels, pair 1/2, 3/4, etc. only
  where a true pair exists and link every emitted audio track. Do not use
  `linkclipref` as a substitute unless a Resolve smoke test proves the
  explicit media-type/track-index form is insufficient. This structure follows
  Apple's XMEML `link` example and avoids Resolve's silent unlinked-audio
  failure mode.

- [ ] **Step 6: Omit audio completely for silent items.** A silent source gets
  no mirrored audio clipitems and no audio links. If the whole timeline is
  silent, omit sequence `<audio>` entirely. Its source `<file><media>` remains
  video-only. This keeps V1/A1 counts truthful for drone footage without a
  recording stream.

**Acceptance criteria:** XML parsing finds the exact sequence/file audio
  branches, channel/sample/depth values, audio `sourcetrack` values, and link
  groups; a mixed timeline has audio items only for audio-bearing clips; a
  silent-only timeline remains video-only; existing path and transform tests
  remain green; and no test relies only on a substring search.

### 3. Make retime behavior explicit for Resolve and FCPXML

**Files:**

- Modify: `backend/src/export_engine.py`
- Test: `backend/tests/test_export_engine.py`

**Interfaces:**

- Consumes: `suggested_speed` and the existing `effective_duration()` policy.
- Produces: audio and video with matching timeline bounds in formats that can
  carry retime information.

- [ ] **Step 1: Apply Resolve Time Remap to both linked media types.** When
  `suggested_speed != 1.0`, emit the existing percentage speed effect on the
  video clipitem and an equivalent Time Remap effect on each mirrored audio
  clipitem, with `mediatype` set to the relevant media type. Keep identical
  source `in/out`, timeline `start/end`, and `effective_duration()` frame
  calculations for both. The audio follows the retime; pitch preservation is
  Resolve's audio-retime policy and must be observed in manual QA, not
  asserted by XML alone. Silent clips get no audio effect.

- [ ] **Step 2: Keep FCPXML's retime on the composite asset clip.** For an
  audio-bearing asset, retain the existing `timeMap` and set `audioRole="dialogue"`
  on the `asset-clip`; `asset-clip` includes all media components of the asset,
  so no separate audio story element is needed. The time map's final `timept`
  must use the raw source `end` at the effective timeline duration, preserving
  audio/video sync. Silent assets omit `audioRole` and remain video-only.

- [ ] **Step 3: Add retime assertions.** Parse Resolve XML and assert the
  retime effect/value exists on both video and audio clipitems and that their
  timing elements match. Parse FCPXML and assert the audio asset attributes,
  `audioRole`, `timeMap`, and effective duration coexist. Keep the existing EDL
  test proving EDL deliberately flattens speed.

**Acceptance criteria:** Resolve and FCPXML retain the same effective duration
for audio and video; silent sources never gain audio; and the plan's only
known retime uncertainty is the audible pitch behavior, covered by manual QA.

### 4. Add FCPXML audio asset declarations

**Files:**

- Modify: `backend/src/export_engine.py:generate_fcpxml`
- Modify: `backend/tests/test_export_engine.py`

**Interfaces:**

- Consumes: source metadata from `videos_by_id`.
- Produces: version 1.10 assets whose `asset-clip` can pull embedded source
  audio.

- [ ] **Step 1: Emit audio attributes only for audio-bearing assets.** Keep
  `hasVideo="1"`. For audio sources add exactly:

  ```xml
  hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"
  ```

  using the parsed channel count and sample rate. Do not add these attributes
  to silent assets. `audioSources="1"` is the explicit one-audio-stream scope
  from the target data contract.

- [ ] **Step 2: Mark audio-bearing asset clips.** Add `audioRole="dialogue"`
  to an audio-bearing `asset-clip`. Do not add a nested `<audio>` element:
  FCPXML 1.10's `asset-clip` implicitly includes all available audio and video
  components from the referenced asset. Preserve `start`, `duration`, `offset`,
  transforms, and existing source-relative path behavior.

- [ ] **Step 3: Test mixed and silent assets structurally.** Assert exact asset
  attributes for a stereo source and absence of every audio attribute for a
  silent source. Assert the corresponding asset-clip role/ref/start/duration
  and that a mixed timeline references both assets without adding audio to the
  silent one.

**Acceptance criteria:** FCPXML imports audio-bearing assets as composite
  audio/video clips, silent assets remain video-only, and the focused XML tests
  inspect parsed attributes/elements rather than string presence.

### 5. Change EDL channel codes and degradation warnings

**Files:**

- Modify: `backend/src/export_engine.py:edl_flatten_warnings`,
  `generate_edl`
- Modify: `backend/src/api.py:export_project` call sites
- Test: `backend/tests/test_export_engine.py`
- Add/update API coverage only if the changed function signature is not covered
  by the existing export endpoint tests: `backend/tests/test_api.py`

**Interfaces:**

- Consumes: `clips` plus `videos_by_id` audio metadata.
- Produces: a CMX3600 event whose channel column truthfully describes the
  source media, and warnings returned through the existing export response.

- [ ] **Step 1: Centralize channel-code selection.** Pass `videos_by_id` into
  `generate_edl` and `edl_flatten_warnings` from `export_project`. Preserve a
  backwards-compatible optional default for direct callers/tests that do not
  provide source metadata. Use these CMX semantics:

  | Code | Meaning | Use here |
  |------|---------|----------|
  | `V` | video only | no audio stream or missing legacy audio metadata |
  | `B` | audio channel 1 plus video | one-channel source |
  | `AA/V` | audio channels 1 and 2 plus video | stereo source |
  | `A` / `AA` | audio-only channel 1 / channels 1+2 | not emitted; this writer always carries video |

  Do not use `B` for stereo and do not keep hardcoded `V` when the source has
  audio. For `audio_channels > 2`, emit `AA/V` for the representable first two
  channels and make the loss visible.

- [ ] **Step 2: Extend warnings without warning for silence.** Keep existing
  Speed and Transform flatten warnings. Add an audio warning only when a
  source has more than two channels, stating that CMX3600 output carries only
  channels 1–2. A silent source is not degradation: `V` faithfully says that
  there is no source audio and must not produce a warning. Missing audio keys in
  legacy metadata are treated as silent/unknown and remain warning-free.

- [ ] **Step 3: Preserve current EDL timing policy.** EDL remains a flattened
  interchange format: use raw source `start_sec`/`end_sec` and raw clip duration
  for record timing, emit no M2 speed command, and warn for Speed. Audio uses
  the same source and record timecodes as video, so retimed audio is also
  flattened to 100% in EDL. Transforms never affect the channel code.

- [ ] **Step 4: Test all channel cases and a mixed timeline.** Assert exact event
  lines for mono (`B`), stereo (`AA/V`), and silent (`V`) clips. Assert a mixed
  timeline has contiguous record times and one event per video clip, not a
  second audio-only event. Assert no warning for silent/stereo audio, an audio
  warning for more-than-two channels, and combined Speed/audio warnings when
  both degradations occur.

**Acceptance criteria:** API-generated EDLs carry source audio where CMX3600
  can represent it, silent footage remains clean video-only, unsupported
  channel loss is visible through `edl_flatten_warnings`, and existing GUI
  warning plumbing receives the expanded list.

### 6. Update focused and compatibility tests

**Files:**

- Modify: `backend/tests/test_export_engine.py`
- Modify: `backend/tests/test_video_probe.py`
- Modify only if needed for serialized defaults: `backend/tests/test_api.py` or
  `backend/tests/test_project_store.py`

- [ ] **Step 1: Introduce shared fixtures with explicit metadata.** Add one
  stereo video fixture (`has_audio=True`, 2 channels, 48,000 Hz, AAC, 16-bit)
  and one silent fixture (`has_audio=False`, no optional audio values). Keep
  existing fixtures valid to prove old callers remain tolerant.

- [ ] **Step 2: Replace broad Resolve clipitem assertions with track-scoped
  assertions.** Once audio clipitems exist, `root.findall(".//clipitem")` is no
  longer a video count. Scope video assertions to
  `./sequence/media/video/track/clipitem`, audio assertions to each audio track,
  and file declarations to the first-use video file.

- [ ] **Step 3: Add the required structural cases.** Cover one stereo source,
  one silent source, a mixed two-item timeline, repeated source-file references,
  no-audio entire timeline, stereo links, mono links, file audio declarations,
  FCPXML asset attributes/roles, EDL channel codes/warnings, and Resolve/FCPXML
  retime synchronization. Every XML test parses with `ElementTree` and asserts
  parent/child paths, counts, values, and link relationships.

- [ ] **Step 4: Run the focused suite.** Run:

  ```bash
  cd backend
  PYTHONPATH=. .venv/bin/python -m pytest tests/test_video_probe.py tests/test_export_engine.py -q
  ```

  Expected: all focused tests pass, including old no-audio fixtures.

**Acceptance criteria:** the test suite proves emitted structure and mixed/no-
audio behavior, not merely the presence of the word `audio`; old project/API
fixtures remain valid; and the focused command exits 0.

### 7. Perform real Resolve QA and reconcile the documented workflow

**Files:**

- Modify: `docs/MANUAL_QA_GUIDE.md`
- Modify: `docs/plans/drone-workflow-qa-flows.md`

- [ ] **Step 1: Update the product/flow contract.** Remove audio from the
  drone-flow explicit out-of-scope list. State that Resolve XML must preserve
  linked source audio for audio-bearing clips and must keep silent-source clips
  video-only. Keep EDL's explicit flattening/degradation warning language.

- [ ] **Step 2: Run the exact Resolve check on a mixed real-footage project.**
  Use at least one `.MOV`/`.MP4` with a known stereo source waveform and one
  drone clip with no audio stream. In the app: create/open the folder project,
  analyze, accept at least one clip from each source, place them in a mixed
  timeline, set one audio-bearing clip to Speed 0.5 or 2.0, export Resolve XML,
  and retain the generated `exports/davinci/timeline.xml`.

- [ ] **Step 3: Verify Resolve import.** In DaVinci Resolve, first import the
  real source files into the Media Pool and confirm their Audio badges and
  waveforms. Use `File > Import Timeline > Pre-generated Timeline` (wording may
  vary by Resolve version) and select `exports/davinci/timeline.xml`; choose
  the existing Media Pool clips when prompted and do not accept a relink path
  that hides a bad URL. On the Edit page verify:

  - V1 contains the same item count and order as the app timeline;
  - audio-bearing items appear on A1/A2 with waveforms, while the silent item
    contributes no audio clip;
  - source in/out and record timing match the app, and the retimed item's audio
    remains aligned with its video for the full effective duration;
  - selecting/moving a video item with linked selection enabled moves its audio
    companions, and unlinking is not required to make the initial handoff work;
  - playback shows audio meters/waveform for the audio clips and genuine silence
    only for the no-audio source.

- [ ] **Step 4: Verify portability and EDL separately.** Copy the project folder
  to another location, repeat XML import, and confirm zero relink prompts. Then
  import the EDL with source media available and confirm `AA/V` or `B` audio
  events appear for audio-bearing sources and `V` for the silent source. Record
  Resolve version, OS, source codecs/rates/channel counts, clip counts, whether
  audio was linked, and any import warning in the existing QA record.

**Acceptance criteria:** a human can demonstrate linked, audible Resolve audio
  from real source media, no-audio clips remain clean, retimed audio is aligned,
  and a moved folder still imports without relink. Any Resolve-version-specific
  failure is recorded with the smallest XML sample and is not papered over by
  weakening structural tests.

### 8. Run the full verification gate and close the plan only with evidence

**Files:**

- Inspect: `backend/src/export_engine.py`, `backend/src/video_probe.py`,
  `backend/src/models.py`, `backend/src/api.py`
- Inspect: all tests and QA docs listed above

- [ ] Run the complete backend checks used by the repository:

  ```bash
  cd backend
  PYTHONPATH=. .venv/bin/python -m pytest --ignore=tests/test_codex_cli_harness.py
  PYTHONPATH=. .venv/bin/ruff check src tests
  ```

- [ ] Search for stale video-only assumptions in the touched export path:

  ```bash
  rg -n "hasVideo|hasAudio|audioSources|audioChannels|audioRate|<audio>|AA/V|sourcetrack|mediatype" backend/src backend/tests docs/MANUAL_QA_GUIDE.md docs/plans/drone-workflow-qa-flows.md
  ```

  Confirm the API passes source metadata to EDL generation/warnings and that no
  writer manufactures audio for a source whose metadata says `has_audio=False`.

- [ ] Record focused-test output and the manual Resolve result before marking
  this plan done. Automated XML validity is not evidence that Resolve imported
  linked audio.

**Acceptance criteria:** full backend tests/lint pass, all three writers have
  explicit audio/no-audio behavior, compatibility defaults are covered, and
  the manual Resolve evidence proves the priority handoff.

## Schema references and genuine uncertainties

- [Apple's FCP7 XMEML Elements Catalog](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Elements/Elements.html): `media` may contain `video`/`audio`; `audio/channelcount` is direct; audio `depth`/`samplerate` are under `format/samplecharacteristics`; `sourcetrack` and `link` carry media type and track identity.
- [Apple's XMEML sequence/link examples](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Basics/Basics.html): stereo is represented by two audio tracks and linked with audio `trackindex` plus shared `groupindex`.
- [Apple's FCPXML asset reference](https://developer.apple.com/documentation/professional-video-applications/asset): `hasAudio`, `audioSources`, `audioChannels`, and `audioRate` describe the asset; [the asset-clip reference](https://developer.apple.com/documentation/professional-video-applications/asset-clip) says an asset clip includes the asset's audio and video components.
- [CMX channel-code reference](https://device.report/m/153088eaf2c79be0e43e413a869bd14399ac155f97f5783ced7aa52af107b3a2): `B` is channel 1 plus video and `AA/V` is channels 1+2 plus video. This is a secondary copy of a post-conform guide; validate the exact emitted codes in Resolve during Task 7.

The two items to verify rather than guess are (1) whether the target Resolve
version requires shared clipitem ids or accepts the explicit link tuple with
unique ids, and (2) how that Resolve version handles pitch while audio is
retimed. The structural choice above follows Apple's schema; if Resolve rejects
it, preserve the smallest failing fixture and adjust only after the manual
import demonstrates the required variant.

## Verification and done criteria

The plan is done only when the probe, export, focused/full backend tests, and
manual Resolve import all pass; a mixed timeline has audible linked audio and a
silent source has no audio item; FCPXML carries audio asset declarations;
EDL uses truthful channel codes and warns only for representational loss; and
the QA docs no longer describe audio as out of scope.
