# Plan 013: Make browser E2E signals deterministic and meaningful

> **Executor instructions:** Follow this plan step by step. Run every verification command. If a STOP condition occurs, stop and report rather than broadening the change.
>
> **Drift check:** `git diff --stat cca2c3b..HEAD -- frontend/e2e frontend/playwright.config.ts`. If either test has changed, re-check the current-state excerpts before editing.

## Status

- **Status:** TODO
- **Priority:** P1
- **Effort:** S
- **Risk:** LOW
- **Depends on:** none
- **Category:** tests
- **Planned at:** commit `cca2c3b`, 2026-07-09

## Why this matters

The browser suite currently reports product failures for assertions that do not describe the current UI contract. A public desktop release needs a red E2E run to mean a user-visible regression, not an ambiguous locator or a fixture assumption invalidated by richer Candidate Clip generation.

## Current state

- `frontend/e2e/compare-versions.spec.ts:264` calls `getByText('Proposed in A/C')`. The Source Clips panel renders that valid label on multiple Candidate Clip cards, so Playwright strict mode fails with three matches.
- `frontend/e2e/timeline-playback.spec.ts:160-189` calls `setupTimeline` with two Source Videos, includes up to six Candidate Clips, then assumes the first Timeline Item is immediately followed by a different file. The rendered timeline can contain several `seq-fixture-a.mp4` items first, so the assertion times out although playback continues correctly.
- Keep the domain terms **Source Video**, **Candidate Clip**, **Timeline Item**, and **Timeline Document** from `UBIQUITOUS_LANGUAGE.md`; do not weaken the test into a fixed delay or a selector-count assertion unrelated to playback.

## Commands

| Purpose | Command | Expected result |
|---|---|---|
| Focused version test | `cd frontend && npx playwright test e2e/compare-versions.spec.ts --reporter=line` | 1 passed |
| Focused playback test | `cd frontend && npx playwright test e2e/timeline-playback.spec.ts --reporter=line` | 7 passed |
| Full browser suite | `cd frontend && npm run test:e2e` | 9 passed |
| Typecheck | `cd frontend && npm run typecheck` | exit 0 |

## Scope

**In scope:**

- `frontend/e2e/compare-versions.spec.ts`
- `frontend/e2e/timeline-playback.spec.ts`

**Out of scope:** production React components, analysis rules, Playwright global timeouts, and changes that force a particular Candidate Clip count.

## Steps

### Step 1: Characterize the current failures

- [ ] Run both focused commands above and retain the failure messages in the PR description.
- [ ] Confirm the version-test failure is Playwright strict mode and the playback-test timeline contains more than one `seq-fixture-a.mp4` Timeline Item before its first `seq-fixture-b.mp4` item.

**Verify:** both commands fail for those exact reasons before any edit.

### Step 2: Make the version-label assertion card-scoped

- [ ] Replace the ambiguous assertion at line 264 with an assertion scoped to a single known Source Clip card:

```ts
await expect(timelineSourceCard.getByText('Proposed in A/C')).toBeVisible();
```

- [ ] Do not use `.first()` on the panel-wide locator: that would hide an incorrect label placement.

**Verify:** `cd frontend && npx playwright test e2e/compare-versions.spec.ts --reporter=line` exits 0.

### Step 3: Make cross-file playback select an actual file boundary

- [ ] In `setupTimeline`, return enough information for callers to identify the first timeline card whose visible filename differs from the first card, or add a focused helper in `timeline-playback.spec.ts` that finds it after setup.
- [ ] Replace the assumption that `.tl-clip.first()` transitions directly to another file. Scrub to the end of the Timeline Item immediately before the first differently named Timeline Item, capture both names, and assert that playback changes to that known second name while `video.paused === false`.
- [ ] Keep the assertion event-driven with `expect.poll`; do not add an arbitrary wait.

**Verify:** `cd frontend && npx playwright test e2e/timeline-playback.spec.ts --reporter=line` exits 0 twice consecutively.

### Step 4: Run release-relevant frontend checks

- [ ] Run the full browser suite and typecheck.
- [ ] Report the green commands and commit SHA to the controller; the controller updates `docs/plans/README.md` after merge so parallel plan branches do not conflict.

**Verify:** `cd frontend && npm run test:e2e && npm run typecheck` exits 0.

## Done criteria

- [ ] Both original failures are replaced by assertions of the intended UI contract.
- [ ] `npm run test:e2e` reports 9 passed.
- [ ] `npm run typecheck` exits 0.
- [ ] No production files changed.

## STOP conditions

- The timeline never contains a Source Video transition after importing both fixture files.
- A cross-file boundary requires changing production playback code to test it.
- The suite still fails on a product behaviour after the locator/fixture corrections.

## Maintenance notes

When Candidate Clip generation rules change, tests must discover boundaries from rendered Timeline Items or an explicit fixture contract—not positional assumptions about the generated sequence.
