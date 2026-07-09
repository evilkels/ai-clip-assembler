# 0001: Local-first processing with explicit per-project cloud consent

## Status

Accepted.

## Context

AI Clip Assembler is a local-first desktop tool: source footage and project
data live on the Editor's machine, and the app has no database service. The
default scoring path, the Manual Harness, is deterministic and rule-based and
never leaves the machine. A provider-backed harness (`pi_agent`) can add
Visual Interest Score by sending sampled frames or clip metadata to an
externally configured provider. The app must not send that data anywhere
without the Editor knowing and agreeing, and that agreement must be scoped to
one project rather than a single global toggle.

## Decision

The Manual Harness is the default for every project. A provider-backed
harness is refused by the backend until the Editor has saved explicit,
per-project consent through the `PUT /projects/{project_id}/cloud-ai-consent`
route; consent is persisted in the project manifest, not just in memory.
Reviewing the chosen provider's own data policy is the Editor's
responsibility, not a guarantee this app makes on the provider's behalf.

## Consequences

- Analysis defaults to fully local processing; enabling cloud scoring is an
  opt-in, reversible, per-project action.
- Backends and harness implementations must check saved consent before
  invoking any provider-backed harness, not just at first analysis.
- The app cannot promise privacy properties of third-party providers; it can
  only gate whether data is sent to them at all.

## References

- [CONTEXT.md](../../CONTEXT.md)
- [README.md](../../README.md) — Privacy model
- `backend/src/api.py` — `PUT /projects/{project_id}/cloud-ai-consent`
- [docs/HARNESS_SPEC.md](../HARNESS_SPEC.md) — Pi Coding-Agent Harness
