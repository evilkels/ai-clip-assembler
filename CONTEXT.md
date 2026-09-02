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

The default **Selected Harness** is `manual`, which keeps analysis local and
rule-based. The optional `pi_agent` cloud-backed harness drives the `pi` CLI to
add visual-interest scoring only after per-project consent is saved. The
`local_qwen` Local AI Harness is retained in code but postponed and disabled
until the local-model path is ready.

The **Selected Harness** and the **Effective Harness** are not the same thing:
a run can fall back to the rule-based result, and re-deriving clips from cached
Frame Scores rebuilds them without any AI step. The **In-App Review Agent** is
configured independently of either — one per-project cloud-AI consent gates
both surfaces. See [ADR 0005](docs/adr/0005-harness-and-review-agent-are-independent.md).

Architectural details live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
the harness contract lives in [docs/HARNESS_SPEC.md](docs/HARNESS_SPEC.md).
