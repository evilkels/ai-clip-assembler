# 040: Release QA

Every release passes these human checks on the packaged app before it is tagged.

## Context

Human-only; no automated test covers any of it. These checks first collected
for v0.4.0.

The other release checks live in their owning plans: clean-Mac DMG →
[self-contained-runtime-tools](self-contained-runtime-tools.md) H1; NLE
import and moved project folder → [032](032-valid-fcpxml-and-nle-verification.md)
H2–H4; real footage →
[drone-workflow-qa-flows](drone-workflow-qa-flows.md).

## Human tasks

- [ ] H1 Review scripting — run the checklist in [`MANUAL_QA_GUIDE.md`](../MANUAL_QA_GUIDE.md#review-scripting) on the packaged app.
- [ ] H2 Keyboard pass — a keyboard-only pass over the shell and all routes on the packaged app: visible focus everywhere, no traps.
