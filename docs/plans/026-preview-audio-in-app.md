# Plan 026: Hear source audio in the app

Status: TODO · Priority P2 · Effort S · Risk MED · Category preview fidelity
Depends on Plan 024 · Planned 2026-08-13

## Why and current evidence

Every preview in the app is silent by construction, not by choice. Both video
elements hardcode the attribute: `ClipPreview.tsx:130` (Timeline sequence
player and VersionPlayer) and `ClipCard.tsx:127` (Review candidates). Nothing
in the UI reads `has_audio`, so a phone-filmed clip with dialogue looks
identical to a drone clip with no audio stream, and the editor cannot tell
which accepted clip will carry sound into the Resolve handoff that Plan 024
now emits.

Drone footage genuinely has no audio stream, which is why the app got away
with this. Phone and camera footage effectively always has one. Judging a clip
without hearing it is the gap: an otherwise good clip with wind roar, a voice
over the top, or a clipped transient is a bad clip, and today that is invisible
until Resolve.

Plan 024 landed the data this needs. `VideoMetadata` carries `has_audio`,
`audio_channels`, `audio_sample_rate`, `audio_codec`, and `audio_bit_depth`;
they reach the renderer through the generated types and
`UploadedVideo.metadata` (`types/clip.ts:61-66`). No new backend endpoint,
probe change, or model change is required by this plan.

## Target behavior and boundaries

- Sound is **off by default** and enabled by an explicit user action. A tool
  that starts making noise while scrubbing a timeline is worse than a silent
  one.
- One preference for the whole app — mute state plus volume — persisted in
  `localStorage` next to the existing `ai-clip-assembler:timeline-preview-height:v1`
  key, so Review and Timeline never disagree.
- A clip whose source has `has_audio === false` stays muted regardless of the
  preference, and says so in the UI.
- Missing audio metadata (legacy projects, `has_audio === undefined`) is
  **unknown, not silent**: no badge is shown and the preference applies. The UI
  must never claim "Silent" for a source it never probed.
- Out of scope: waveform rendering, per-clip volume, audio meters, audio-aware
  scoring, and any change to what the exporters emit.

## Execution steps

### 1. Add the shared preview-audio preference

**Files:**

- Add: `frontend/src/renderer/src/state/usePreviewAudio.ts`
- Test: `frontend/e2e/preview-audio.spec.ts`

**Testing note for every task below:** this repo has no renderer unit-test
runner. Renderer behavior is covered by Playwright specs in `frontend/e2e/`
(`timeline-playback.spec.ts` is the closest model) and `frontend/tests/main`
holds node tests for the main process only. Do not introduce Vitest as part of
this plan; assert against the rendered DOM and the media element's `muted`,
`volume`, and `paused` properties via `page.evaluate`.

**Interfaces:**

- Consumes: `window.localStorage`.
- Produces: `{ muted, volume, setMuted, setVolume }` shared by every preview.

- [ ] **Step 1: Define the persisted shape.** Key
  `ai-clip-assembler:preview-audio:v1`, storing `{ muted: boolean; volume: number }`
  with `muted: true` and `volume: 0.8` as defaults. Clamp volume to `0..1` on
  read; treat malformed or absent JSON as the default rather than throwing.
- [ ] **Step 2: Share one instance across routes.** Reads must not diverge
  between a Review card and the Timeline transport within a session. Either
  subscribe to a module-level store or put it on the existing context — do not
  give each component its own independent `useState` seeded from storage.
- [ ] **Step 3: Test persistence and tolerance.** Assert the default when
  storage is empty, a round trip through set/read, and that a garbage value
  yields the default instead of an exception.

**Acceptance criteria:** the preference survives a reload, is identical in both
routes, and never throws on corrupt storage.

### 2. Make the preview elements able to sound

**Files:**

- Modify: `frontend/src/renderer/src/components/ClipPreview.tsx`
- Modify: `frontend/src/renderer/src/components/ClipCard.tsx`
- Test: `frontend/e2e/preview-audio.spec.ts`

- [ ] **Step 1: Replace the hardcoded attribute with a prop.** `ClipPreview`
  takes `muted?: boolean` (default `true`) and `volume?: number`, applying
  `volume` through the element property in an effect — `volume` is not a valid
  HTML attribute and setting it in JSX silently does nothing.
- [ ] **Step 2: Force silence for silent sources.** The caller passes
  `sourceHasAudio`; the element is muted when the user preference is muted
  **or** the source is known to have no audio. A source with unknown audio
  metadata follows the preference.
- [ ] **Step 3: Survive a blocked play().** Chromium refuses unmuted
  `play()` without a user gesture, and the Timeline advances between segments
  on its own clock. On rejection, retry once muted rather than leaving the
  playhead stalled, and reflect that the app fell back to muted so the state
  shown matches what is audible. Do not swallow the rejection silently as the
  current `.catch(() => {})` does.
- [ ] **Step 4: Pin the retime pitch behavior.** Set `preservesPitch`
  explicitly rather than depending on the browser default, so a 0.5x or 2.0x
  clip sounds the same in every build. Time-stretched (pitch preserved) is the
  default choice: it matches Resolve's own retime behavior and keeps dialogue
  intelligible.

**Acceptance criteria:** a clip from an audio-bearing source can be heard, a
clip from a silent source is muted with no console error, and playback never
stalls because audio was blocked.

### 3. Show which clips carry sound

**Files:**

- Modify: `frontend/src/renderer/src/components/ClipCard.tsx`
- Modify: `frontend/src/renderer/src/components/TimelineItemRow.tsx`
- Test: `frontend/e2e/preview-audio.spec.ts`

- [ ] **Step 1: Resolve the source per clip.** Look up the clip's `file_id` in
  the uploaded videos and read `metadata.has_audio`. The lookup must be by
  `file_id`, not by name — two folders can hold the same file name.
- [ ] **Step 2: Render three honest states.** Audio-bearing gets an audio
  badge including the channel count when known (`Audio · 2ch`); a known-silent
  source gets a muted-source badge; unknown metadata gets nothing. Badges carry
  a `title`/`aria-label`, not colour alone.
- [ ] **Step 3: Cover all three states** in the Playwright spec, including the
  unknown case, which is the one that regresses silently.

**Acceptance criteria:** a mixed project visibly distinguishes phone clips from
drone clips before playback, and a legacy project shows no false claim.

### 4. Add the transport control

**Files:**

- Modify: `frontend/src/renderer/src/components/Timeline.tsx`
- Modify: the Review route header
- Test: `frontend/e2e/preview-audio.spec.ts`

- [ ] **Step 1: Add a mute toggle plus volume slider** to the Timeline
  transport, next to the existing playback controls, with `aria-pressed` on the
  toggle and a labelled range input for volume.
- [ ] **Step 2: Give Review the same control** so candidates can be auditioned
  without visiting the Timeline. Both drive the single preference from Task 1.
- [ ] **Step 3: Keep the control usable when nothing has audio.** If no source
  in the project has audio, the control stays visible but disabled with a
  reason — a missing control reads as a bug.

**Acceptance criteria:** sound can be enabled and adjusted from either route,
the two agree, and the state is keyboard reachable and announced.

### 5. Verify

- [ ] Run the frontend gates:

  ```bash
  cd frontend
  npm run typecheck
  npm run lint:frontend
  npm run test:main
  npm run test:e2e
  npm run build
  ```

- [ ] Manual pass with real footage: a phone clip is audible in Review at the
  chosen volume; a drone clip plays silently with no error; a retimed clip is
  time-stretched, not chipmunked; muting persists across a reload; and playing
  a mixed timeline does not stall at the first segment boundary.
- [ ] Record the segment-boundary click. Swapping the element source between
  segments produces an audible discontinuity. This plan accepts it; a volume
  ramp at segment start is the follow-up if it proves distracting in real use.

**Acceptance criteria:** all frontend gates pass, sound is off until asked for,
silent sources stay silent, and no preview stalls because of autoplay policy.

## Genuine uncertainties

1. Whether Electron's autoplay policy blocks the unmuted segment-to-segment
   `play()` in the packaged app as well as in dev. Task 2 Step 3 makes the
   failure survivable either way; if it does block, the fix is
   `autoplayPolicy: 'no-user-gesture-required'` in `webPreferences`
   (`frontend/src/main/index.ts:441`), which should be set only if the manual
   pass demonstrates the need.
2. How bad the segment-boundary click is with real footage. Measured in the
   manual pass, not guessed.
