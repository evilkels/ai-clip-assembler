# AI Harness Interface Specification

## Design Principles

1. **Provider-agnostic** — any AI system that can analyze images can be a harness
2. **Standardized contract** — single input format, single output format
3. **Pluggable at runtime** — switch harnesses without restarting the app
4. **Graceful degradation** — if a harness fails, fall back to manual/rule-based

## Input Format

```json
{
  "project_id": "uuid",
  "harness_id": "local_qwen",
  "videos": [
    {
      "file_id": "uuid",
      "file_path": "/Users/ernesto/Videos/DJI_001.MP4",
      "file_name": "DJI_001.MP4",
      "duration_sec": 1847.3,
      "fps": 60,
      "resolution": [3840, 2160],
      "codec": "h264",
      "frames": [
        {
          "timestamp": 45.2,
          "frame_path": "/tmp/frames/DJI_001_045200.jpg",
          "motion_stability": 8.5,
          "blur_score": 7.2,
          "brightness": 0.78,
          "contrast": 0.65,
          "scene_id": 3,
          "is_keyframe": true
        }
      ],
      "scenes": [
        {"scene_id": 3, "start": 42.0, "end": 68.5}
      ],
      "audio_transcript": [
        {"start": 45.2, "end": 48.1, "text": "look at this amazing view"}
      ]
    }
  ],
  "preferences": {
    "target_duration_sec": 120,
    "min_clip_duration_sec": 3,
    "max_clip_duration_sec": 15,
    "pacing": "fast",
    "focus": "smooth_motion",
    "music_bpm": null
  },
  "context": {
    "previous_suggestions": [],
    "user_feedback": "more drone shots, less walking"
  }
}
```

## Output Format

```json
{
  "harness_id": "local_qwen",
  "harness_version": "1.0.0",
  "processing_time_sec": 45.2,
  "clips": [
    {
      "clip_id": "uuid",
      "file_id": "uuid",
      "file_name": "DJI_001.MP4",
      "start_sec": 45.2,
      "end_sec": 52.8,
      "duration_sec": 7.6,
      "smoothness_score": 8.5,
      "visual_interest_score": 7.2,
      "overall_score": 7.8,
      "ai_reason": "smooth drone pan over water, golden hour lighting, no shake detected",
      "suggested_speed": 1.0,
      "suggested_transition": "crossfade",
      "tags": ["drone", "water", "golden_hour", "smooth"]
    }
  ],
  "sequence": {
    "total_duration_sec": 118.4,
    "clips": ["clip_id_1", "clip_id_2", "clip_id_3"]
  },
  "metadata": {
    "model_used": "qwen3-vl-8b",
    "tokens_used": 15234,
    "local": true
  }
}
```

## Score Definitions

| Score | Range | Meaning |
|-------|-------|---------|
| `smoothness_score` | 0-10 | Motion stability (10 = perfectly smooth) |
| `visual_interest_score` | 0-10 | How visually engaging (composition, lighting, subject) |
| `overall_score` | 0-10 | Weighted composite of all factors |

## Harness Implementations

### 0. Pi Coding-Agent Harness (Default)

**ID:** `pi_agent`
**Status:** Optional cloud-backed AI harness; requires per-project consent.
**Input:** Sampled frame image paths per candidate clip.
**Process:**
1. For each rule-based candidate clip, sample up to 4 representative frames.
2. Spawn the `pi` CLI in non-interactive print mode (`pi --provider <p> --model <m> --print --mode text --no-session`).
3. `pi` reads the frame images with its built-in `read` tool and returns a JSON object scoring smoothness and visual interest.
4. Blend the score (70 % original technical + 30 % visual interest) and re-rank clips.
5. Fall back to the rule-based result if the CLI is unavailable or every clip fails to score.

Still-frame enhancement judges semantic Visual Interest only. The response keeps
a neutral `smoothness` compatibility field, but the application ignores it;
vidstab/OpenCV remains authoritative for Smoothness Score. In Review, the same
Pi configuration receives at most 12 labelled, scene-diverse Frame Samples plus
recent conversation history and may propose validated complete Versions.

**Runtime configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_BIN` | `pi` | Path/name of the pi executable |
| `PI_PROVIDER` | `openai-codex` | pi provider to route through (e.g. `openai-codex`, `opencode`) |
| `PI_MODEL` | `gpt-5.4-mini` | Model pattern/ID for that provider |
| `PI_TIMEOUT_SEC` | `180` | Per-clip subprocess timeout in seconds |

Environment variables provide defaults. Provider, model, and timeout can be
edited in Settings and are persisted in `.ai-clip-assembler/settings.json`;
`PI_BIN` remains environment/main-process resolved and read-only in the UI.

For `openai-codex`, the renderer calls three token-free preload methods. Electron
main owns the OAuth state machine, opens the external browser, receives the
loopback callback on `127.0.0.1:1455`, and uses Pi's credential storage. Pi CLI
and the embedded Pi SDK share `~/.pi/agent/auth.json`; the renderer and FastAPI
HTTP API never receive OAuth credentials. Terminal `pi /login` and supported
provider environment variables remain advanced alternatives. Authentication
does not replace the backend's required per-project cloud AI consent check.

### 1. Local Model Harness (Postponed)

> **Status:** Postponed and disabled in `GET /harnesses`. The local-model path
> (Ollama/MLX) is not fully figured out yet. The code in
> `backend/src/local_qwen_harness.py` is retained for future re-enablement but is
> not a selectable harness in `/analyze`.

**ID:** `local_qwen`
**Input:** Frame images + OpenCV metrics
**Process:**
1. Send batch of frames to local Qwen3-VL via Ollama/MLX
2. Prompt: "Score this video frame for smoothness and visual interest. Is there camera shake?"
3. Parse structured JSON response
4. Aggregate scores across frames

**Config:**
Configuration is via environment variables only (no config file):

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `qwen3-vl:8b` | Model tag to use |
| `OLLAMA_TEMPERATURE` | `0.2` | Model sampling temperature (fixed at 0.2 by default for deterministic scoring) |

### 2. Claude Code Harness

**ID:** `claude_code`
**Input:** Frame paths + analysis metadata
**Process:**
1. Spawn Claude Code subprocess with analysis script
2. Script reads frames, calls Claude API for scoring
3. Returns structured JSON

**Config:**
```json
{
  "api_key": "sk-ant-...",
  "model": "claude-opus-4-6",
  "max_frames": 50
}
```

### 3. Codex Harness

**ID:** `codex`
**Input:** Frame paths + analysis metadata
**Process:**
1. Spawn Codex CLI subprocess
2. Script generates analysis, calls OpenAI API
3. Returns structured JSON

**Config:**
```json
{
  "api_key": "sk-...",
  "model": "gpt-5.3-codex",
  "max_frames": 50
}
```

### 4. Manual / Rule-Based Harness

**ID:** `manual`
**Status:** Default local harness.
**Input:** OpenCV metrics only (no AI vision model)
**Process:**
1. Use vidstab motion scores
2. Use blur/brightness/contrast thresholds
3. Discover a bounded Candidate Clip pool across eligible detected Scenes
4. Keep one honestly scored fallback when a Scene has no threshold-passing range
5. Leave non-overlap, target duration, and scene-density constraints to draft selection
6. No semantic understanding

Candidate discovery uses Frame Sample intervals when a range ends at a quality
boundary, so three one-second samples cover approximately three seconds rather
than being measured only from first timestamp to last timestamp. The default
pool is capped at 12 Candidate Clips per Source Video before Pi enhancement.

**Config:**
```json
{
  "min_smoothness": 7.0,
  "min_brightness": 0.3,
  "max_blur": 100.0,
  "scene_min_duration": 2.0
}
```

## Harness Registration

Harnesses are registered in the `GET /harnesses` API endpoint (see `backend/src/api.py`).
The endpoint returns the list of available harnesses with their enabled/disabled status.

The local Qwen harness reads configuration from environment variables only:
`OLLAMA_URL`, `OLLAMA_MODEL`, and `OLLAMA_TEMPERATURE`. See the Local Model Harness
section above for details.

## Error Handling

If a harness fails:
1. Log error with context
2. Return partial results if available
3. Fall back to `manual` harness
4. Notify user in UI

## Versioning

Harness interface is versioned independently from the app:
- Interface spec: `v1.0`
- Each harness declares its compatible interface version
- Breaking changes require major version bump
