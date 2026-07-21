# AI Harness Interface Specification

## Design Principles

1. **Provider-agnostic** — any AI system that can analyze images can be a harness
2. **Standardized contract** — single input format, single output format
3. **Pluggable at runtime** — switch harnesses without restarting the app
4. **Graceful degradation** — if a harness fails, fall back to manual/rule-based

## Input Format

Harness input is a JSON payload keyed by `project_id` and `harness_id`, carrying
per-video metadata (`file_id`, `file_path`, `duration_sec`, `fps`, `resolution`,
`codec`), a `frames` array (timestamp, frame path, motion/blur/brightness/contrast
scores, scene id, keyframe flag), detected `scenes`, and an optional
`audio_transcript`. A `preferences` block carries editing targets (target/min/max
clip duration, pacing, focus, music BPM) and a `context` block carries prior
suggestions and free-text user feedback.

## Output Format

Harness output returns `harness_id`, `harness_version`, `processing_time_sec`,
and a `clips` array. Each clip carries `clip_id`, `file_id`, `file_name`,
`start_sec`/`end_sec`/`duration_sec`, `smoothness_score`, `visual_interest_score`,
`overall_score`, a human-readable `ai_reason`, `suggested_speed`,
`suggested_transition`, and `tags`. A `sequence` block lists the assembled clip
order and total duration; a `metadata` block records which model was used, token
usage, and whether processing was local.

## Score Definitions

| Score | Range | Meaning |
|-------|-------|---------|
| `smoothness_score` | 0-10 | Motion stability (10 = perfectly smooth) |
| `visual_interest_score` | 0-10 | How visually engaging (composition, lighting, subject) |
| `overall_score` | 0-10 | Weighted composite of all factors |

## Harness Implementations

### 0. Pi Coding-Agent Harness (Optional)

**ID:** `pi_agent`
**Status:** Optional cloud-backed AI harness; requires per-project consent.
**Input:** Sampled frame image paths per candidate clip.

Rule-based candidate clips are sampled (up to 4 representative frames each) and
scored by spawning the `pi` CLI in non-interactive print mode
(`pi --provider <p> --model <m> --print --mode text --no-session`), which reads
the frames via its built-in `read` tool and returns a JSON score for smoothness
and visual interest. The harness blends that score (70% original technical +
30% visual interest) and re-ranks clips, falling back to the rule-based result
if the CLI is unavailable or every clip fails to score.

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

**ID:** `local_qwen`. Sends batches of frames plus OpenCV metrics to a local
Qwen3-VL model via Ollama/MLX, prompting it to score smoothness and visual
interest and flag camera shake, then aggregates scores across frames.
Configuration is via environment variables only: `OLLAMA_URL` (default
`http://localhost:11434`), `OLLAMA_MODEL` (default `qwen3-vl:8b`), and
`OLLAMA_TEMPERATURE` (default `0.2`, fixed for deterministic scoring).

### 2. Claude Code Harness

**ID:** `claude_code`. Spawns a Claude Code subprocess with an analysis script
that reads frames and calls the Claude API for scoring, returning structured
JSON. Config: `api_key`, `model`, `max_frames`.

### 3. Codex Harness

**ID:** `codex`. Spawns the Codex CLI, which generates analysis via the OpenAI
API and returns structured JSON. Config: `api_key`, `model`, `max_frames`.

### 4. Manual / Rule-Based Harness

**ID:** `manual`
**Status:** Default local harness.

Uses OpenCV/vidstab motion scores and blur/brightness/contrast thresholds only
— no semantic understanding. It discovers a bounded Candidate Clip pool across
eligible detected Scenes, keeps one honestly scored fallback when a Scene has no
threshold-passing range, and leaves non-overlap, target duration, and
scene-density constraints to draft selection.

Candidate discovery uses Frame Sample intervals when a range ends at a quality
boundary, so three one-second samples cover approximately three seconds rather
than being measured only from first timestamp to last timestamp. The default
pool is capped at 12 Candidate Clips per Source Video before Pi enhancement.

Config: `min_smoothness`, `min_brightness`, `max_blur`, `scene_min_duration`.

## Harness Registration

Harnesses are registered in the `GET /harnesses` API endpoint (see `backend/src/api.py`).
The endpoint returns the list of available harnesses with their enabled/disabled status.

The local Qwen harness reads configuration from environment variables only:
`OLLAMA_URL`, `OLLAMA_MODEL`, and `OLLAMA_TEMPERATURE`. See the Local Model Harness
section above for details.

## Error Handling

If a harness fails: log the error with context, return partial results if
available, fall back to the `manual` harness, and notify the user in the UI.

## Versioning

Harness interface is versioned independently from the app:
- Interface spec: `v1.0`
- Each harness declares its compatible interface version
- Breaking changes require major version bump
