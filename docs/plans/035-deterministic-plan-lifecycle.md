# 035: Deterministic plan lifecycle

A plan's status, its row in the index and its move to `done/` follow
mechanically from its checkboxes, so plan statuses stop drifting and need no
reconciliation passes.

## Context

Plan status has been reconciled by hand four times (PR #39, `41964fd`,
`43b1a78`, PR #90 folded into #91). It lived in three places that drifted
apart: the README row, a free-text `Status:` header and the checkboxes. Moving
a plan to `done/` broke its relative links (`8437eb4`).

The plan format and status rules are in
[`docs/agents/issue-tracker.md`](../agents/issue-tracker.md). Decisions for
`scripts/plans.py`:

- Python 3 standard library only. Paths resolve from the repo root (found from
  `__file__`); a `--root DIR` flag overrides it for tests.
- **Parsing.** Active plans are `docs/plans/*.md` except `README.md`; closed
  plans are `docs/plans/done/*.md` and are never parsed for tasks. The title is
  the first `# ` line. A task is a column-0 line matching
  `^- \[( |x|X)\] (\S+) (.*)$`. A task is human when its id starts with `H` or
  it sits under `## Human tasks`. A plan is superseded when it has a line
  starting `Superseded by: `.
- **Status** follows the table in the tracker doc. An active plan with no task
  lines is MALFORMED.
- **`status`** (the default) prints one line per active plan: status, file,
  ticked/total phase tasks, open human tasks.
- **`sync`** moves every DONE or SUPERSEDED active plan to `done/` (`git mv`
  when the file is tracked, otherwise a plain rename). It then rewrites every
  relative Markdown link in tracked `*.md` files (`git ls-files '*.md'`) that
  resolved to the old path so it resolves to the new one, and regenerates the
  index. Running it twice changes nothing the second time.
- **Index.** In `docs/plans/README.md`, `sync` replaces everything between
  `<!-- plans:index:start -->` and `<!-- plans:index:end -->` with a table
  `| | Plan | Progress | Next |`. Rows are ordered 🟣, 🟡, 🔴, MALFORMED (⚠️),
  then by file name. Plan is `[Title](file)` with any leading `NNN: ` dropped
  from the title. Progress is `ticked/total`, plus ` · N human` when human
  tasks are open. Next is the first open phase task's text (the first open
  human task for 🟣), cut to 90 characters at a word boundary with `…`. When
  the markers are missing, `sync` exits 1 and says to add them.
- **`check`** changes no files and exits 1 with one line per problem: a
  MALFORMED active plan, a DONE or SUPERSEDED plan outside `done/`, or an index
  that differs from what `sync` would write.
- **Tests** live in `scripts/tests/test_plans.py` (`unittest`). They build
  fixture repos in temp directories with `git init`.

## Phase 1: Tooling and spec

- [x] 1.1 Write the tracker spec in `docs/agents/issue-tracker.md`. Done when
  it defines the format, the five statuses, the lifecycle, and how each skill
  operation maps onto plans (PR #92).
- [x] 1.2 Add `scripts/plans.py` with `status`, `sync` and `check` as decided
  above. Done when `python3 scripts/tests/test_plans.py -v` passes and covers
  every status rule, MALFORMED, the move with link rewrite, idempotent `sync`,
  missing markers, and each `check` failure (PR #92).
- [x] 1.3 Run the script's tests in CI next to the release-workflow contract
  step in `.github/workflows/test.yml`. Done when that step runs in CI and
  passes (PR #92).

## Phase 2: Migrate the active plans (after PR #91 merges)

- [ ] 2.1 Convert every active plan to the format, keeping all content: status
  prose and "Reconciled" notes go into `## Context`, remaining work becomes
  tasks, and shipped work is ticked with its PR number, using the statuses
  re-verified in PR #91. Done when `python3 scripts/plans.py status` shows no
  MALFORMED plan.
- [x] 2.2 Move the README's "Release QA — v0.4.0" checks into the Human tasks
  of a `release-qa` plan. Done when the README has no hand-written status
  table. (PR #TBD)
- [x] 2.3 Replace the README's hand-written Active table and "In flight"
  section with the index markers, then run `sync`. Done when `check` passes.
  (PR #TBD)
- [x] 2.4 Run `python3 scripts/plans.py check` in CI and in the versioned
  pre-commit hook when `docs/plans/` is staged (hook from plan 036). Done when
  a hand-edited index row fails CI. (PR #TBD)

## Human tasks

- [ ] H1 Skim the migrated plans for tasks ticked or left open wrongly.
