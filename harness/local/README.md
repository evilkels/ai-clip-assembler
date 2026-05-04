# Local Model Harness

Default harness using locally-run vision models via Ollama or MLX.

## Supported Models

- Qwen2.5-VL (7B, 32B)
- Qwen3-VL (when available)
- LLaVA (fallback)

## Setup

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull model
ollama pull qwen2.5-vl:7b

# Test
ollama run qwen2.5-vl:7b "Describe this image" --image /path/to/frame.jpg
```

## Config

Edit `config.json`:

```json
{
  "model": "qwen2.5-vl:7b",
  "provider": "ollama",
  "provider_url": "http://localhost:11434",
  "batch_size": 8,
  "max_frames_per_video": 100,
  "prompt_template": "Score this video frame (0-10) for: 1) smoothness/stability, 2) visual interest. Respond in JSON: {\"smoothness\": N, \"visual_interest\": N, \"reason\": \"...\"}"
}
```

## MLX Path (Apple Silicon)

For faster inference on Mac:

```bash
pip install mlx-vlm
python -m mlx_vlm.generate --model qwen2.5-vl-7b --image /path/to/frame.jpg
```
