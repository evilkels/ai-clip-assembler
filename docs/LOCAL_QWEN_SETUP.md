# Local Qwen3-VL Setup Guide — MacBook Pro M5 Pro

Complete walkthrough for running the local Qwen3-VL vision harness on
Apple Silicon with Ollama and MLX acceleration.

## Hardware Requirements

| Component | Requirement |
|-----------|-------------|
| Mac | MacBook Pro with M5 Pro (or any Apple Silicon Mac) |
| RAM | 16 GB minimum, 32 GB+ recommended for 30B model |
| Disk | 10 GB free for 8B model, 25 GB for 30B model |
| macOS | Sequoia 15.0 or later |

## Model Selection

| Model | Ollama tag | Size | Min RAM | Quality | Speed on M5 Pro |
|-------|-----------|------|---------|---------|-----------------|
| Qwen3-VL 8B | `qwen3-vl:8b` | 6.1 GB | 16 GB | Good | ~15-20 tok/s |
| Qwen3-VL 30B | `qwen3-vl:30b` | 20 GB | 32 GB | Excellent | ~5-8 tok/s |
| Qwen3-VL 4B | `qwen3-vl:4b` | 3.3 GB | 8 GB | Decent | ~25-35 tok/s |

**Recommended for M5 Pro (48 GB unified memory):** `qwen3-vl:8b` for fast
iterative QA, `qwen3-vl:30b` for production-quality analysis.

> Qwen2.5-VL is **deprecated** and no longer available on Ollama. Always use
> Qwen3-VL, which offers better spatial understanding, OCR, and structured
> JSON output.

## Step 1: Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Verify:

```bash
ollama --version
# Requires Ollama >= 0.12.7 for Qwen3-VL support
```

If your package manager installed an older version:

```bash
brew upgrade ollama
```

## Step 2: Pull the Vision Model

```bash
ollama pull qwen3-vl:8b
```

For the larger model:

```bash
ollama pull qwen3-vl:30b
```

Verify the model is available:

```bash
ollama list
# Should show: qwen3-vl:8b (6.1 GB) or qwen3-vl:30b (20 GB)
```

## Step 3: Verify MLX Acceleration

Ollama on macOS automatically uses Apple's MLX framework for GPU
acceleration on Apple Silicon. No separate MLX installation is needed.

Verify MLX is active:

```bash
ollama run qwen3-vl:8b "Describe this image" --image /path/to/test-frame.jpg
```

The first run will be slower (model loading). Subsequent runs should show
GPU-accelerated inference. If you see CPU-only speeds (< 5 tok/s for 8B),
check:

```bash
# Ensure Ollama is using the Metal backend
ollama ps
```

The output should show the model running with the Metal/MPS backend.

## Step 4: Test with a Video Frame

```bash
# Extract a single frame from your drone footage
ffmpeg -i /path/to/drone-footage.mp4 -vf "select=eq(n\,100)" -frames:v 1 /tmp/test-frame.jpg

# Test vision model with structured output
ollama run qwen3-vl:8b \
  "You are a video quality analyst. Score this frame (0-10) for: 1) smoothness/stability, 2) visual interest. Respond ONLY with JSON: {\"smoothness\": N, \"visual_interest\": N, \"reason\": \"brief explanation\"}" \
  --image /tmp/test-frame.jpg
```

Expected output:

```json
{"smoothness": 8, "visual_interest": 7, "reason": "Stable aerial shot with good composition and warm lighting"}
```

## Step 5: Run the Backend with Local Qwen Harness

Start Ollama (if not already running):

```bash
ollama serve
```

In a separate terminal, start the backend:

```bash
cd /Users/elvijs/DEV/personal/ai-clip-assembler/backend
source .venv/bin/activate
PYTHONPATH=. uvicorn src.api:app --reload --port 8000
```

Create a project and upload video:

```bash
PROJECT_ID=$(curl -s -X POST http://127.0.0.1:8000/projects | python3 -c 'import json,sys; print(json.load(sys.stdin)["project_id"])')
curl -s -F "file=@/path/to/drone-footage.mp4" "http://127.0.0.1:8000/projects/${PROJECT_ID}/videos" | python3 -m json.tool
```

Run analysis with the local Qwen harness:

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

### Override Model or URL

```bash
OLLAMA_MODEL=qwen3-vl:30b PYTHONPATH=. uvicorn src.api:app --reload --port 8000
```

Or for a remote Ollama instance:

```bash
OLLAMA_URL=http://other-machine:11434 OLLAMA_MODEL=qwen3-vl:8b PYTHONPATH=. uvicorn src.api:app --reload --port 8000
```

## Step 6: Validate Output

Check the response for:

1. **`metadata.local`** is `true` — AI enhancement was applied
2. **`metadata.model_used`** — should show `qwen3-vl:8b` or your configured model
3. **Each clip has `visual_interest_score`** and `ai_reason` fields
4. **Clips are re-ranked** by blended `overall_score` (70% technical + 30% visual interest)

If you see `"warning"` in metadata instead, Ollama was unavailable and the
backend fell back to manual rule-based results.

## Using MLX Directly (Advanced)

If you want to run the model outside Ollama using Apple's MLX framework
directly, you can use the MLX community models from HuggingFace:

```bash
pip install mlx-vlm

# Download and run the 4-bit quantized 8B model
python -m mlx_vlm.generate \
  --model mlx-community/Qwen3-VL-8B-Instruct-4bit \
  --image /tmp/test-frame.jpg \
  --prompt "Score this frame for smoothness (0-10) and visual interest (0-10). Respond in JSON." \
  --max-tokens 200
```

This approach gives you more control over quantization and memory usage,
but requires setting up a compatible API server to replace Ollama's
`/api/generate` endpoint. For most use cases, Ollama with its built-in
MLX backend is simpler and sufficient.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `warning: Local Qwen fallback` | Ollama not running | `ollama serve` |
| `model not found` | Model not pulled | `ollama pull qwen3-vl:8b` |
| Very slow inference (< 3 tok/s) | CPU fallback, no Metal | Update Ollama to 0.12.7+; restart |
| `score count mismatch` | Model returned wrong number of scores | Reduce batch size; try `qwen3-vl:4b` for more reliable output |
| OOM / crash | Model too large for RAM | Use smaller model (`qwen3-vl:4b`) or close other apps |
| JSON parse error | Model hallucinated format | Add `"format": "json"` in Ollama payload (already set) |

## Performance Benchmarks (M5 Pro, 48 GB)

| Model | Batch 8 frames | Batch 4 frames | Memory usage |
|-------|----------------|----------------|-------------|
| qwen3-vl:4b | ~2.5 s | ~1.3 s | ~6 GB |
| qwen3-vl:8b | ~5.0 s | ~2.8 s | ~10 GB |
| qwen3-vl:30b | ~18 s | ~9 s | ~24 GB |
