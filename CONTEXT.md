# AI Clip Assembler Context

AI Clip Assembler is a local-first desktop tool for turning raw drone/action
footage into an editable timeline of accepted candidate clips, then exporting
that timeline as FCPXML or EDL.

Use the vocabulary in [UBIQUITOUS_LANGUAGE.md](UBIQUITOUS_LANGUAGE.md) when
working in this repo. The current implementation centers on:

- **Source Videos** imported into a local FastAPI backend.
- **Frame Samples** extracted with FFmpeg and scored for technical quality.
- **Candidate Clips** assembled by the Manual Harness, optionally enhanced by
  the active AI Harness.
- **Review Board** decisions that turn candidate clips into **Accepted Clips**.
- **Timeline** ordering and trims that are sent to export.

The active default harness is `manual`, which keeps analysis local and
rule-based. The optional `pi_agent` cloud-backed harness drives the `pi` CLI to
add visual-interest scoring only after per-project consent is saved. The
`local_qwen` Local AI Harness is retained in code but postponed and disabled
until the local-model path is ready.

Architectural details live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
the harness contract lives in [docs/HARNESS_SPEC.md](docs/HARNESS_SPEC.md).
