# Issue tracker: plans in `docs/plans/`

Work for this repo is tracked as Markdown **plans** in `docs/plans/`, one file
per plan. GitHub Issues are only the **inbox** for reports from outside the
repo (bugs, requests); triage turns an accepted report into a plan or a task in
an existing plan, then closes the issue with a link to it.

## Plan format

```markdown
# NNN: Title

One or two sentences: the outcome this plan delivers.

## Context

Why, constraints, decisions already made, links. Optional.

## Phase 1: Name

- [ ] 1.1 Task in one line. Done when <checkable criterion>.
- [x] 1.2 Shipped task (PR #91)

## Phase 2: Name

- [ ] 2.1 …

## Human tasks

- [ ] H1 Only what a person must do (manual QA, buying a certificate, a decision).
```

- A new plan is `NNN-slug.md`, numbered after the highest existing plan in
  `docs/plans/` and `docs/plans/done/`. Older named plans keep their names.
- Every task is one checkbox line numbered `<phase>.<n>`. Notes go in indented
  sub-bullets under it, never in a status paragraph.
- `## Human tasks` is optional and always last. Agents never tick an `H` box.
- A plan replaced by another gets a line `Superseded by: [NNN](NNN-slug.md)`
  under the title.
- There is no `Status:` line. Status is derived from the boxes:

| Status | Rule |
|---|---|
| 🔴 TODO | no box ticked |
| 🟡 IN PROGRESS | a box ticked, a phase task open |
| 🟣 HUMAN | every phase task ticked, a human task open |
| 🟢 DONE | every box ticked; the file belongs in `done/` |
| ⚪ SUPERSEDED | has a `Superseded by:` line; the file belongs in `done/` |

## Parked plans

A plan the roadmap puts after v1.0.0 lives in `docs/plans/later/`.
`scripts/plans.py` does not read that folder, so parked plans have no index row
and no status. To un-park one, `git mv` it back to `docs/plans/` and run `sync`.

## Lifecycle

- Tick a task in the same PR that ships it, with the PR number, e.g.
  `- [x] 2.1 … (PR #95)`. Status-only PRs are not needed.
- Then run `python3 scripts/plans.py sync`: it moves DONE and SUPERSEDED plans
  to `done/`, rewrites links to moved files, and regenerates the index table in
  `docs/plans/README.md`. Never hand-edit that table.

## When a skill says "publish to the issue tracker"

Write a new plan in the format above. A spec (`to-spec`) goes into the plan's
title, opening sentences and `## Context`; its work becomes phases and tasks.

## When a skill says "publish tickets" (`to-tickets`)

Tickets become tasks in the parent plan, one checkbox line each, in dependency
order: a phase boundary is a blocking edge, and a task blocked by something in
its own phase says `(after 1.2)`. Never create one file per ticket.

## When a skill says "fetch the relevant ticket"

Read the plan file named by the user; a task is addressed as `NNN 2.1`.

## Triage labels

Labels apply to inbox issues only (see `triage-labels.md`). A plan needs no
label: a task with a "Done when" criterion is ready for an agent.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one plan file; its **child tickets** are
tasks in it.

- **Map**: the plan's `## Context` holds Notes, Decisions so far and Fog as
  sub-headings.
- **Child ticket**: a task line whose text starts with its type in brackets:
  `- [ ] 1.3 [research] Which DTD does Final Cut 11 accept?`.
- **Blocking**: phase order, or `(after 1.2)` on the task line.
- **Frontier**: the first open task whose blockers are ticked and that is not
  claimed.
- **Claim**: append `(claimed)` to the task line and save before any work.
- **Resolve**: tick the box, put the answer in an indented sub-bullet, and add
  a one-line pointer to Decisions so far.
