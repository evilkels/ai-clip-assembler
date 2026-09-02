# Literal design conformance review

**Date:** 2026-09-02
**Branch:** redesign/studio-workflows
**PR:** [#68](https://github.com/evilkels/ai-clip-assembler/pull/68)
**Result:** App and landing implementation accepted against the approved references, with packaged-app and real-NLE checks still human-only.

This record supersedes the earlier “complete” wording in the studio and landing plans. Those records covered implementation slices and functional checks; this record is the evidence for literal conformance and the final repository gate.

## Review basis

The app was compared side by side at 1440×1000 and 1024×768, in light and dark, against the read-only Claude export sections #1d Import, #1b Review, #3a Timeline, and #3b Export. Reference captures are retained outside tracked baselines at .superpowers/sdd/2026-09-01-literal-design-conformance/design-references/. The landing page was compared at 1440px against docs/design/2026-09-01-landing-page-reference.html; responsive states were checked at 1200, 900, 500, and 390px in both themes.

Inputs consulted for this record include the Task 6 and Task 7 implementer reports under .superpowers/sdd/2026-09-01-literal-design-conformance/, the earlier workflow Task 6/7 reports under .superpowers/sdd/2026-08-14-studio-workflow-redesign/, the staged review packages under the conformance SDD directory, the prior HTML review record, the two implementation plans, the approved spec, the branch commit history, and PR #68's review/comments.

### Findings and disposition

| Surface | Finding against the reference | Disposition/evidence |
| --- | --- | --- |
| Shared shell | Earlier shell used the wrong rail/header proportions, had a broken development logo, and did not expose the reference workflow chrome. | Fixed: compact project header, approximately 264px expanded rail, 64px collapsed rail, branded logo, workflow footer, status rail, approved Plex/token system. The visual matrix checks geometry in both themes and sizes. |
| Import (#1d) | Source aggregates, compact toolbar, selected-source actions, analysis/rules composition, and persistent footer needed to match the designed hierarchy. | Fixed while retaining search, filters, view modes, columns, stable selection, harness, analysis, abort, rescan, and navigation. The select-all regression hidden by filtering is separately covered. |
| Review (#1b) | Your Clips had to be visible with Ask AI, Suggested Versions, source tracks, scores, and the designed browser density. | Fixed with grid/list/filmstrip projections and the existing decision/version/chat behavior. Suggested Versions fixtures and visual states are deterministic. |
| Timeline (#3a) | Workspace proportions and selected-item inspector needed the reference preview/track/item-rail composition. | Fixed with preview and transport pinned visibly at 1024px while track/inspector continue below in the scrollable body; item-ID authority, trim, reorder, playback, undo/redo, speed, and transform remain intact. |
| Export (#3b) | Format cards, handoff summary, persistent EDL warning, receipt, payload disclosure, and footer needed the designed hierarchy. | Fixed. The receipt snapshots buildExportPayload() at handoff; duplicate display names remain distinct by stable file_id. EDL warning stays conditional on non-identity speed/transform. |
| Landing | The old page advertised stale app captures and did not match the handoff palette/structure. | Fixed: dark default/light toggle, self-hosted fonts, contact sheet, ruler, three steps, corrected Review well, retained Local-first/FAQ contract sections, and responsive adaptations. |

### Accepted deviations and limitations

- The grid Candidate Clip view retains one rich video per ClipCard; the new list/filmstrip and Import thumbnails avoid eager video mounting. Removing grid media belongs to the separate poster-first work described by plan 017.
- Navigation rows retain a 2px inset active accent. The conformance rule is enforced for semantic status surfaces, which use wash, hairline outline, and restrained glow without a solid left bar.
- The fixed-width design is adapted below its canonical size: the 1024px Timeline keeps preview/transport visible and moves the editor below; Export's handoff summary stacks and format cards become one column below 720px. No controls or behavior are removed.
- The landing contact sheet never drops below two columns. CTAs stack, the ruler shortens, and the closing band stacks below 768px; navigation, anchors, downloads, focus, reduced motion, and no-JS dark rendering remain usable.

## Electron capture and smoke evidence

Task 7 used a separate built Electron profile and a neutral fixture copied from checked-in test media:

~~~text
/tmp/clip-assembler-demo/project/source-01.mp4
/tmp/clip-assembler-demo/project/source-02.mp4
/tmp/clip-assembler-demo/project/source-03.mp4
/tmp/clip-assembler-demo/project/source-04.mp4
~~~

The built renderer was launched without a dev server, connected through CDP, then imported/analyzed and opened at Review:

~~~text
npm run build
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron out/main/index.js --remote-debugging-port=9231 --user-data-dir=/tmp/clip-assembler-electron-task7
agent-browser --session electron-neutral connect 9231
agent-browser --session electron-neutral open file:///path/to/worktree/frontend/out/renderer/index.html#/playwriter?fixture=review-grid
~~~

CDP metrics were width=1440, height=1040, deviceScaleFactor=2, mobile=false; the renderer reported innerWidth=1440, innerHeight=1040, and devicePixelRatio=2. Both logical crops are 1440×1040 and both physical captures are 2880×2080, with no debug labels or overlays. The built smoke pass imported/analyzed all four neutral sources, opened Review, and captured both themes successfully.

## Screenshot provenance

PNG sources were /tmp/review-dark-neutral-2x.png and /tmp/review-light-neutral-2x.png. They were encoded losslessly with:

~~~text
/opt/homebrew/bin/cwebp -quiet -lossless /tmp/review-dark-neutral-2x.png -o site/img/review-dark.webp
/opt/homebrew/bin/cwebp -quiet -lossless /tmp/review-light-neutral-2x.png -o site/img/review-light.webp
~~~

| Asset | Dimensions | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| site/img/review-dark.webp | 2880×2080 | 210326 | 661fe9f84366e2f45b2cd6f1ada8c967b4a84c954de6aa6f7dfdc87ffb15cdc2 |
| site/img/review-light.webp | 2880×2080 | 157222 | a0f5b5dee61035d7be7898505a70bf63b6997eccccdcb726f8ee5f0b1196c90c |

The fixture project and captures contain no personal paths, filenames, faces, locations, or debug overlays. Landing visual snapshots are retained under .superpowers/sdd/2026-09-01-literal-design-conformance/task-7-landing-visuals/ for the required responsive/theme matrix.

## Fresh verification gate (2026-09-02)

Commands were run on this tree after the implementation commits. Counts are from the command output, not inherited plan claims.

| Command | Result |
| --- | --- |
| npm run lint (from frontend/) | PASS; frontend ESLint and backend Ruff, 0 lint errors/warnings |
| npm run typecheck (from frontend/) | PASS; generated types fresh and tsc --noEmit clean |
| npm run test:main (from frontend/) | PASS; 69 passed, 0 failed |
| npm run test:backend (from frontend/) | PASS; 404 passed, 1 skipped, 3 deprecation warnings |
| CI=1 npm run test:e2e -- --workers=1 (from frontend/) | PASS; 100 passed, 0 failed |
| npx playwright test visual-conformance.spec.ts --update-snapshots (from frontend/) | PASS; 31 passed |
| npx playwright test visual-conformance.spec.ts (repeat, from frontend/) | PASS; 31 passed, 0 failed |
| npm run build (from frontend/) | PASS; typecheck, asset staging, Electron/Vite production build, and asset copy |
| python3 -m unittest scripts.tests.test_site_contract (repo root) | PASS; 7 tests, OK |

The earlier Task 6 run recorded one configured-flaky Review fixture route race (route.fetch after page close): 99 passed, 1 flaky, 0 failed, with the retry passing. The fresh full run above exercised 100 tests and had no flaky result.

## Commit and review trace

The conformance implementation commits, in order, are:

~~~text
1987698 test(ui): add literal design conformance harness
16b43fb test(ui): harden visual fixture determinism
ac5b8fe test(ui): tighten fixture footer geometry
b867448 feat(ui): rebuild studio shell from design
b8ca353 fix(ui): address shell review findings
1cb8366 fix(ui): harden collapsed studio rail
2dabfef feat(ui): match import workstation design
cb9ec92 fix(ui): refine import conformance review
d149c8e feat(ui): match review workstation design
ca0480a fix(ui): refine review workstation conformance
39af24c feat(ui): match timeline workspace design
6f027cd feat(ui): complete studio design conformance
6b11c47 feat(site): finish landing with redesigned app captures
d697d86 fix(site): sanitize and recapture review screenshots
28662ec fix(site): sanitize review fixture filenames
8a5ab9a test(e2e): synchronize review route teardown
6244883 fix(site): link downloads to release assets
81c332a fix(ui): align final shell and visual fixtures
8bb3bc9 test(ui): align shell conformance assertions
8134589 fix(site): keep download menu flat
721f8b5 test(ui): pin visual fixture summaries
~~~

The two-axis Standards/Spec review and Copilot review findings are recorded in the conformance reports and implementation plan. Valid findings fixed include the export payload snapshot, explicit analysis-running predicate, SourceTrack reuse, control radii, filtered select-all state, per-file ordering, and neutral E2E fixture paths. The pointer trim comment was rejected with evidence: trim is initiated by onMouseDown, while onPointerDown only stops propagation, so the matching mousemove/mouseup listener pair is intentional.

## Human-only checks

Completed human inspection recorded for this pass: side-by-side app/reference review, landing 1440px comparison, landing responsive/theme snapshots, keyboard focus visibility, reduced-motion layout, JavaScript-disabled dark rendering, and Electron fixture capture inspection.

Still required before release approval:

- Install and launch the packaged macOS build on a clean machine, including the unsigned Gatekeeper warning and bundled-backend startup.
- Check real footage metadata, analysis progress/Abort, and all Import views.
- Exercise Review with real footage, including grid/list/filmstrip, decisions, versions, and chat.
- Scrub/play audio and trim with trackpad and mouse; verify Timeline undo/redo.
- Export Resolve XML, FCPXML, and EDL and open each in its real NLE; verify order, in/out, speed, transform, relink after moving a project, receipts, Reveal, Resolve handoff, and overwrite behavior.
- Run a keyboard-only pass across each route plus Settings/Diagnostics, and confirm no personal paths/names appear in any release artifact.

The receipt is pinned to the Timeline projection at export click time, not to a document revision. An edit during an in-flight export/overwrite prompt can still leave the backend write and receipt describing different revisions; closing that race is deliberately outside this redesign branch.

## Working-tree and handoff checks

git diff main...HEAD was reviewed for the implementation and documentation scope. frontend/package-lock.json remains the user's pre-existing unstaged modification and is intentionally excluded from this documentation commit. The Claude Design export remains ignored and untouched. The conformance plan and spec are added at their intended paths under docs/plans/ and docs/specs/.

The branch and PR handoff were completed after this record was refreshed; GitHub CI status is tracked on PR #68.
