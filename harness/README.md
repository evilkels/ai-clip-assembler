# AI Harnesses

Each subdirectory contains a pluggable AI harness implementation.

All harnesses must implement the interface defined in `../docs/HARNESS_SPEC.md`.

## Directory Structure

```
harness/
├── claude/       # Claude Code agent harness
├── codex/        # OpenAI Codex agent harness
├── pi_agent/     # Pi agent harness
├── local/        # Local vision model harness (Qwen, LLaVA)
└── manual/       # Rule-based harness (no AI)
```

## Adding a New Harness

1. Create a new subdirectory
2. Implement `analyze()` function matching the spec
3. Add config.json with harness metadata
4. Register in `config.json`

See `local/` for the reference implementation.
