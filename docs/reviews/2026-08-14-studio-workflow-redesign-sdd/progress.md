# SDD ledger — plan: docs/plans/2026-08-14-studio-workflow-redesign.md

Branch: redesign/studio-workflows
Baseline: typecheck PASS; 61 main-process tests PASS.
Design inspected via Playwriter on 2026-08-14.

Task 1: complete (commits abc0530..a8a4d7a, review clean for Critical/Important)
Deferred Minor for final review: restore the explicit `main.left >= sidebar.right`
overlap guard in `project-shell-regressions.spec.ts` while retaining full-edge
workspace containment.

Task 2: complete (commits 468c0c7..0d56228, review clean for Critical/Important)
Deferred Minor for final integrated UX review: source selection is now explicit
through native checkboxes; whole-row pointer selection was removed to avoid invalid
nested interactive semantics. Decide whether a semantic non-nested row affordance is
worth restoring.

Task 3: complete (commits cffdf6e..722d4cf, review clean)

Task 4: complete (commit 76d4fec; independent review clean; typecheck/lint pass
and focused Review E2Es 7/7 pass).

Task 5: complete (commits 6dcd6a8..d8c45a9; independent final re-review clean;
typecheck/lint pass, main tests 64/64, focused Timeline/preview E2Es 24/24).
Visual conformance checked against the supplied local Claude Design HTML.

Task 6: complete (commit 07f15a6; independent re-review clean; typecheck/lint
pass, main tests 69/69, focused Export E2Es 4/4 and Timeline suite 23/23).

Task 7: complete (integrated E2E 2/2 at 1440×900 and 1024×768 in dark/light;
full frontend gate green: lint, typecheck, main 69/69, backend 404 passed/1
skipped, E2E 64/64, build). Restored the explicit `main.left >=
sidebar.right` geometry guard. Source selection remains native checkbox-only;
whole-row affordance was not restored because the browser rows contain preview
controls and adding a nested interactive target would regress semantics.
Human Electron/macOS and real-footage/NLE checks remain pending; see
`docs/reviews/2026-08-14-studio-workflow-redesign.html`.
