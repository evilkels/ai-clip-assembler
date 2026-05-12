# Local Model Harness

Optional harness that enhances rule-based candidate clips using a locally-run
vision model (Qwen3-VL) via Ollama.

> **The manual / rule-based harness remains the default reliable mode.**
> The local Qwen harness is an optional enhancement. If Ollama or the model is
> unavailable, the backend automatically falls back to the manual harness with
> a warning in the response metadata.

## How It Works

1. The deterministic manual pipeline runs first (motion analysis, frame
   extraction, scene detection, rule-based scoring, clip assembly).
2. For each candidate clip, representative frames are sampled evenly across
   its duration.
3. Batches of up to 8 frames are sent to the local Ollama vision model.
4. The model returns structured JSON scores (`smoothness`, `visual_interest`,
   `reason`) for each frame.
5. Scores are averaged per clip and blended into the existing `overall_score`
   (70 % original technical score + 30 % visual interest).
6. Clips are re-ranked by the new `overall_score` and returned with enriched
   `ai_reason` text.

## Prerequisites

- [Ollama](https://ollama.com) installed and running locally
- A vision-capable model pulled (e.g. `qwen3-vl:8b`)

## Setup

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the vision model
ollama pull qwen3-vl:8b

# Verify the model is available
ollama list
```

## Configuration

Environment variables (with sensible defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_MODEL` | `qwen3-vl:8b` | Model tag to use |
| `OLLAMA_TEMPERATURE` | `0.2` | Model sampling temperature. Fixed at 0.2 by default for deterministic scoring. Override for experimentation only. |

Configuration is via environment variables only. No config file is required or loaded.

## API Usage

Use `harness_id: "local_qwen"` when calling the analyze endpoint:

```bash
curl -s \
  -H "Content-Type: application/json" \
  -X POST "http://127.0.0.1:8000/projects/${PROJECT_ID}/analyze" \
  -d '{
    "project_id": "'"${PROJECT_ID}"'",
    "harness_id": "local_qwen",
    "preferences": {
      "sample_fps": 1,
      "smoothness_threshold": 7,
      "min_clip_duration_sec": 3,
      "max_clip_duration_sec": 15,
      "target_duration_sec": 120
    }
  }' \
  | python3 -m json.tool
```

### Fallback Behavior

If Ollama is not running or the model is missing, the API still returns HTTP
200 with the manual rule-based results and a metadata warning:

```json
{
  "status": "complete",
  "harness_id": "local_qwen",
  "clips": [...],
  "metadata": {
    "warning": "Local Qwen fallback: Ollama/model unavailable"
  }
}
```

## MLX Path (Apple Silicon)

Ollama on macOS automatically uses Apple's MLX/Metal framework for GPU
acceleration on Apple Silicon. No separate MLX installation is needed.

For direct MLX usage (advanced), see `docs/LOCAL_QWEN_SETUP.md`.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `warning: Local Qwen fallback` | Ollama not running | Start `ollama serve` |
| Empty `visual_interest_score` | Model returned unparsable JSON | Check Ollama logs; try a different model tag |
| Slow analysis | Large batch size or slow GPU | Reduce `batch_size` in config or use a smaller model |
