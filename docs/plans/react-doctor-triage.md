# React Doctor Triage

Status: partially implemented; state refactors and current warnings remain active.

**Goal:** Work through `react-doctor` findings on `frontend/` in safe, ordered batches (mechanical first, judgment-call refactors last).

Reconcile note (2026-07-21): historical score/count snapshots below are not a
safe execution baseline. The last recorded mechanical pass reduced findings
from 47 to 33 on local react-doctor 0.2.14. Re-run the installed tool and
refresh file/line evidence before selecting another batch.

**History:** score bounced between snapshots (88/100 → 90/100 staged →
44/100 after the codebase grew with the agent-operable-timeline UI) — treat
none of these counts as current. Batch 1 quick wins (`button-has-type` on 14
buttons, one em-dash fix) took issue count 75→60, build green, no behavior
change. Skipped as stale: `js-tosorted-immutable` (needs tsconfig `lib` bump
to es2023); `async-defer-await`/`no-initialize-state` in `App.tsx` (refactored
since, findings gone). Remaining findings are dominated by judgment-call
refactors (`no-giant-component`, `no-derived-state`, `prefer-use`, a11y).

Each finding has a fix recipe at
`https://www.react.doctor/prompts/rules/<rule>.md`. Re-run
`cd frontend && npm run doctor -- --verbose --diff` after each batch.

Side effects of installing react-doctor: a git pre-commit hook now runs
doctor on every commit (remove if unwanted); 3 npm vulnerabilities landed in
new transitive deps; doctor flags itself as an unused dev dependency until a
script/hook uses it.

## Batches (roughly in PR order)

1. **Quick wins** (mechanical, ~20 lines, near-zero risk).
2. **Accessibility** — labels/roles on Review/Import controls; the clickable
   `<div>` at Import.tsx:84 collapses 3 findings if changed to a `<button>`.
3. **List keys** — Import.tsx:119, use a stable id, not array index.
4. **State refactors** (behavior-affecting, own PRs) — `prefer-useReducer` +
   `no-cascading-set-state` in `ReviewContext.tsx`/`Timeline.tsx`; split
   `Timeline.tsx` (391 lines) while there. Do *after* the project-folder-model
   backend work, since it changes the data shape.
5. **React 19 migration** — `useContext`→`use()` only if committing to React
   19+; audit `forwardRef` too.
6. **Style/judgment, skip unless wanted** — 11px text in Review/Export matches
   FCP/Resolve/Premiere secondary-metadata sizing; suppress rather than
   upsize. `async-await-in-loop` in Import.tsx may be a false positive if
   imports must be sequential.
7. **False positive** — `deslop/unused-dev-dependency` on react-doctor
   itself; resolves once a script/hook uses it.

After batches 2+3, expected score ~96/100; after batch 4, remaining should
be judgment calls only.
