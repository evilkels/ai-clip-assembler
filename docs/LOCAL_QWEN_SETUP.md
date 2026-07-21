# Local Qwen3-VL Setup — POSTPONED

This workstream (running vision scoring locally via Ollama + Qwen3-VL on
Apple Silicon, `harness_id: "local_qwen"`) is **postponed**. The default
local harness is `manual`; the optional `pi_agent` path uses cloud inference
after per-project consent. Keep this only as a resume guide.

## Why postponed

Qwen2.5-VL was deprecated on Ollama; the harness needs revalidating against
Qwen3-VL before it's trustworthy again. Not scheduled — no target date.

## What you need to resume

| Component | Requirement |
|-----------|-------------|
| Mac | Apple Silicon, 16 GB+ RAM (32 GB+ for the 30B model) |
| Disk | 10 GB (8B model) / 25 GB (30B model) |
| macOS | Sequoia 15.0+ |
| Ollama | >= 0.12.7 (`brew upgrade ollama` if older) |

Recommended model: `qwen3-vl:8b` for iteration, `qwen3-vl:30b` for quality.
Qwen2.5-VL is deprecated — always use Qwen3-VL.

## Quick resume steps

```bash
# Install & pull model
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3-vl:8b        # or qwen3-vl:30b

# Sanity check (Ollama uses Apple's MLX/Metal backend automatically)
ollama run qwen3-vl:8b "Describe this image" --image /path/to/test-frame.jpg
ollama ps   # confirm Metal/MPS backend

# Run the backend against it
ollama serve &
cd backend && source .venv/bin/activate
PYTHONPATH=. uvicorn src.api:app --reload --port 8000
```

Trigger analysis with `"harness_id": "local_qwen"` on `POST
/projects/{id}/analyze`. Config is env-vars only, no config file:
`OLLAMA_URL` (default local), `OLLAMA_MODEL` (default `qwen3-vl:8b`),
`OLLAMA_TEMPERATURE` (default 0.2).

Validate output via `metadata.local == true`, `metadata.model_used`, and
per-clip `visual_interest_score` / `ai_reason`. A `"warning"` in metadata
means Ollama was unreachable and the backend fell back to rule-based scoring.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `warning: Local Qwen fallback` | Ollama not running | `ollama serve` |
| `model not found` | Model not pulled | `ollama pull qwen3-vl:8b` |
| Very slow (< 3 tok/s) | CPU fallback, no Metal | Update Ollama; restart |
| `score count mismatch` | Model returned wrong count | Try `qwen3-vl:4b` |
| OOM / crash | Model too large for RAM | Use smaller model / close apps |
| JSON parse error | Model hallucinated format | Ollama payload already sets `"format": "json"` |

## Advanced: MLX directly (bypassing Ollama)

Possible via `pip install mlx-vlm` and
`mlx-community/Qwen3-VL-8B-Instruct-4bit`, but requires standing up a
replacement API server for Ollama's `/api/generate`. Not recommended unless
Ollama itself becomes the blocker.
