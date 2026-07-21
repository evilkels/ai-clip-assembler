# Going-public roadmap — Codex CLI flow

Status: ACTIVE (2026-07-02). Owner: Elvijs. Move from local success to public
release in order; do not market phase 3 while phase-1 trust is open.

## Working loop

Branch from protected main; use Codex for implementation; verify backend tests,
frontend typecheck/build, and synthetic E2E; review with a fresh session; fix,
PR, merge, then update the plan index. One task per branch/PR. Implementers do
not review themselves, and “done” requires command evidence.

## Roadmap

1. **Trust — DONE:** PR #37 / `72a195b` made Manual Harness default, added
   saved consent, and corrected the claim that cloud-backed Pi scoring was local.
2. **Installability — ACTIVE:** graceful no-vidstab degradation shipped in PR
   #36 / `f7f88eb`; bundling still needs compliance, Intel proof, signing,
   notarization, and clean-machine testing (`self-contained-runtime-tools.md`).
   Backend orphan/port hardening shipped in PR #38 / `b625a82`.
3. **Presentability:** add rights-cleared README/demo media; reconcile plan status
   continuously rather than claiming completed drafts.
4. **Architecture debt:** generated FE/BE contracts and analysis extraction
   shipped in PR #35; take later debt only through scoped advisor plans.
5. **Launch/monetize:** soft-launch to the drone niche after phases 1–3. Paid
   hypothesis: MIT core + signed build ($29–59) + optional hosted-AI upsell;
   validate rather than treating this as a decided tier.

New findings enter `docs/plans/README.md`; they do not expand the current task.
