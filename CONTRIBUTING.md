# Contributing to AI Clip Assembler

Thanks for helping improve AI Clip Assembler. This project is an early local-first video editor, so small, well-tested changes are easier to review than broad rewrites.

## Ways to contribute

- Report reproducible bugs with setup details, sample-media characteristics, and logs.
- Improve local setup, troubleshooting, and user documentation.
- Add focused backend tests for analysis, timeline, harness, and export behavior.
- Improve export compatibility for Final Cut Pro, DaVinci Resolve, and EDL workflows.
- Polish the desktop UI while preserving the current local-first workflow.

## Before you start

1. Search existing issues and pull requests.
2. For larger work, open an issue first so the approach can be discussed.
3. Keep changes scoped to one problem.
4. Do not commit private footage, generated media, credentials, `.env` files, or local project output.

## Development setup

Follow [docs/DEVELOPER_SETUP.md](docs/DEVELOPER_SETUP.md) for full setup.

Common commands:

```bash
cd backend
PYTHONPATH=. .venv/bin/python -m pytest
```

```bash
cd frontend
npm run typecheck
npm run build
```

```bash
# from the repo root
backend/.venv/bin/python scripts/synthetic_e2e_qa.py
```

## Pull request checklist

- The PR has a clear description of the problem and solution.
- User-facing behavior is documented when it changes.
- Backend changes include focused tests where practical.
- Frontend changes pass `npm run typecheck` and `npm run build`.
- Export, timeline, or analysis changes include a manual or automated validation note.
- The PR does not include unrelated formatting churn.

## Code style

- Follow the existing code style in nearby files.
- Keep modules focused and avoid unrelated refactors.
- Prefer explicit project data structures over ad hoc string parsing.
- Preserve the privacy model: footage should not leave the user's machine unless the user explicitly configures a provider-backed harness.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
