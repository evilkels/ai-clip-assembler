# Plan 024 implementation notes

## Writers

- Resolve XMEML declares audio-bearing source files with channel count, sample
  depth, and sample rate. The sequence has one audio track per source channel;
  mirrored audio clipitems share ids with their video clipitems and use explicit
  media-type/track-index links. Silent items receive no audio clipitems or
  links, and a silent-only sequence has no audio branch.
- FCPXML assets with audio emit `hasAudio`, `audioSources`, `audioChannels`,
  and `audioRate`; their `asset-clip` elements use `audioRole="dialogue"`.
  Silent assets omit all audio attributes and role. Retime remains on the
  composite asset clip.
- EDL emits `B` for mono, `AA/V` for stereo, and `V` for silent or legacy
  metadata. It keeps one video event per timeline clip and warns when a source
  has more than two channels because CMX3600 carries only channels 1–2.

## Scope limitation

The probe and export contract uses the first audio stream from ffprobe. Multiple
independent audio streams are not merged or silently passed through; they need
a follow-up once real footage demonstrates that requirement. A single stream
with multiple channels is supported.

## Verification boundary

ElementTree structural tests, the focused suite, the full backend suite, and
Ruff were run. DaVinci Resolve import, audible waveform/link verification,
retime pitch behavior, portability without relink prompts, and separate EDL
import could not be verified because they require a human Resolve session.
