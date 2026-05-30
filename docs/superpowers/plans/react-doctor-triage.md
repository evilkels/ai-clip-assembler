# React Doctor Triage

Source: `npx react-doctor@latest --verbose` on `frontend/` (v0.2.14).
Score: **88 / 100**, 40 issues across 19 rules.
Snapshot at `/tmp/claude-501/react-doctor-209912ac-9bb7-427d-8b5b-844077d758cc`.

## How To Use This Doc

Each finding has a **canonical fix recipe** at `https://www.react.doctor/prompts/rules/<rule>.md` — fetch and follow it before editing. Re-run `npm run doctor -- --verbose --diff` after each batch.

Status legend: ✅ quick win · 🛠 refactor · 🤔 needs judgment · 🧹 false-positive

## Side Effects Of Installing react-doctor (flag for awareness)

1. **Git pre-commit hook installed** at `.git/hooks/pre-commit`. It will run doctor on every commit — could block your flow. Inspect or remove if unwanted.
2. **3 npm vulnerabilities** in new transitive deps (1 moderate, 2 high). Run `npm audit` to inspect.
3. Doctor now flags itself as `deslop/unused-dev-dependency` until something uses it. Drops score 89 → 88. Resolves automatically once a script or hook is wired up (the hook already does).

---

## Batch 1 — Quick Wins (mechanical, behavior-preserving) ✅

Recommended first PR. ~20 lines of changes total, near-zero risk.

| Rule | Count | Files | Fix |
|---|---|---|---|
| `button-has-type` | 15 | ClipCard.tsx, Review.tsx, Import.tsx, Export.tsx, Timeline.tsx | Add `type="button"` to every `<button>` not inside a `<form>`'s submit position. |
| `js-tosorted-immutable` | 1 | Review.tsx:7 | `[...arr].sort()` → `arr.toSorted()`. |
| `async-defer-await` | 1 | App.tsx:18 | Move the synchronous early-return guard above the `await`. |
| `no-initialize-state` | 1 | App.tsx:23 | Pass the initial value directly to `useState()` instead of setting it from a mount-only effect. |
| `design-no-em-dash-in-jsx-text` | 1 | Review.tsx:140 | Replace `—` with `,` `:` `;` or `()` in visible UI copy. |

**Total: 19 findings in one PR, all mechanical.**

---

## Batch 2 — Accessibility ✅ (mostly mechanical, one judgment call)

Recommended second PR. Important for a desktop app you want to feel professional.

| Rule | Count | Files | Notes |
|---|---|---|---|
| `control-has-associated-label` | 4 | Review.tsx:34, 48, 122; Import.tsx:96 | Add visible text or `aria-label`. |
| `label-has-associated-control` | 1 | Review.tsx:33 | Add `htmlFor` or nest the input inside the `<label>`. |
| `click-events-have-key-events` | 1 | Import.tsx:84 | Pair `onClick` with `onKeyDown`. |
| `no-static-element-interactions` | 1 | Import.tsx:84 | Same element as above — change `<div onClick>` to `<button>`, or add `role="button"` + `tabIndex={0}`. Prefer the semantic element. |

Import.tsx:84 is one clickable `div`; fixing it as a `<button>` collapses three findings.

---

## Batch 3 — List Keys ✅

Recommended third PR. Likely bug-fixing, not just lint.

| Rule | Count | Files | Notes |
|---|---|---|---|
| `no-array-index-key` | 1 | Import.tsx:119 | Same line as below. |
| `no-array-index-as-key` | 1 | Import.tsx:119 | Use a stable id from the imported video (path, hash, filename). One change, two findings gone. |

---

## Batch 4 — State Refactors 🛠

These are larger and behavior-affecting. Each gets its own PR.

| Rule | Where | Why it matters |
|---|---|---|
| `prefer-useReducer` | `state/ReviewContext.tsx:47` (10 useState calls), `components/Timeline.tsx:47` | Both are central to the Review flow. Consolidating reduces re-render fanout and makes the project-folder-model migration cleaner. |
| `no-cascading-set-state` | `state/ReviewContext.tsx:85`, `components/Timeline.tsx:102` | 6 `setState` calls inside a single `useEffect` → likely redundant renders, possible stale-state bugs. Same components as `prefer-useReducer` — address together. |
| `rerender-state-only-in-handlers` | `components/Timeline.tsx:53` | `direction` is `useState` but never read in render → `useRef`. Trivial once you're in this file. |
| `no-giant-component` | `components/Timeline.tsx` (391 lines) | Split during the same Timeline pass. |

**Suggested grouping:** one PR for `ReviewContext.tsx`, one PR for `Timeline.tsx`. Both should land *after* the project-folder-model backend work, because the data shape feeding these components will change.

---

## Batch 5 — React 19 Migration 🤔

| Rule | Where | Decision needed |
|---|---|---|
| `no-react19-deprecated-apis` | `state/ReviewContext.tsx:4` | Replace `useContext(X)` with `use(X)` from React 19. Only do this if you're committing to React 19+; check current React version in `frontend/package.json` first. If you upgrade, audit for `forwardRef` usage too. |

---

## Batch 6 — Style / Judgment 🤔

Skip unless you want them — these are subjective.

| Rule | Where | Verdict |
|---|---|---|
| `no-tiny-text` (11px) | Review.tsx:29, Export.tsx:182 | Honest call: 11px is fine for secondary metadata in a video editor (FCP, Resolve, Premiere all use 10-11px chrome). I'd suppress these two rather than upsize. |
| `no-inline-exhaustive-style` | Export.tsx:176 | Worth extracting to a CSS module if you're already touching Export. Otherwise low priority. |
| `async-await-in-loop` | Import.tsx:40 | Check whether the operations are truly independent. If imports must be sequential (e.g. backend rate limits), this is a false positive — suppress with a comment explaining why. |

---

## Batch 7 — False Positive 🧹

| Rule | Where | Action |
|---|---|---|
| `deslop/unused-dev-dependency` | `package.json` (react-doctor itself) | Disappears once the pre-commit hook or `npm run doctor` is considered "use". Ignore. |

---

## Suggested PR Order

1. **PR 1** — Batch 1 (quick wins, 19 findings)
2. **PR 2** — Batch 2 + 3 (a11y + keys, 8 findings, one shared fix)
3. *Wait for project-folder-model backend (phases 1-3 in the other plan)*
4. **PR 3** — Batch 4a: ReviewContext refactor
5. **PR 4** — Batch 4b: Timeline split + state refactor
6. **PR 5** — Batch 5 if upgrading to React 19
7. Decide on Batch 6 case by case

After PR 2, expected score: ~96 / 100. After PR 4, the remaining issues should be judgment calls only.

## Re-Run Command

```bash
cd frontend && npm run doctor -- --verbose --diff
```

The `--diff` form scopes to changed files, which is what the pre-commit hook runs.
