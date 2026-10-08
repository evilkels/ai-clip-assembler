# End-to-end tests

Run one spec from `frontend/` with `npx playwright test e2e/<spec>.spec.ts`.
Run the full suite with `npm run test:e2e`.

Specs either use the real FastAPI backend and import footage before waiting for
analysis, or stub backend requests with Playwright route fulfilment. The table
below names the user flow each file covers and which backend it uses.

Prefer accessible roles and labels, followed by existing test IDs, for stable
selectors. Settings opens as a modal; it is not a route.

Playwright starts the backend on port 8000 and the renderer on port 5173. A run
fails if port 8000 is already taken. Find the process to stop with
`lsof -nP -iTCP:8000 -sTCP:LISTEN`. The renderer may reuse an already-running
server.

Linux screenshot baselines are updated by the `Update Linux visual baselines`
workflow in `.github/workflows/update-linux-baselines.yml` (plan 036, task 3.5).
The controller creates macOS baselines locally; do not create snapshot PNGs by
hand.

| Spec | User flow it proves | Backend (real / stubbed) |
| --- | --- | --- |
| `app-shell-layout.spec.ts` | The project shell keeps its layout, status bar, update notice, and sidebar controls in place. | Real backend; desktop bridge stubbed; no analysis |
| `compare-versions.spec.ts` | An Editor compares proposed versions, focuses one, and adopts its complete timeline. | Real backend; Review session and turn responses stubbed |
| `import-workflow-redesign.spec.ts` | An Editor browses source videos, filters and selects them, and follows analysis progress. | Stubbed |
| `playwriter-preview.spec.ts` | An Editor imports and analyzes footage, proves Review playback advances, then loads the Timeline preview. | Real |
| `preview-audio.spec.ts` | An Editor changes preview audio and sees the preference carry between Review and Timeline. | Real |
| `project-shell-regressions.spec.ts` | An Editor manages recent projects and uses the project sidebar without losing project context. | Stubbed |
| `review-browser-redesign.spec.ts` | An Editor browses, filters, previews, and includes Candidate Clips on the Review Board. | Real backend; analyze, clips, timeline document, and Review session responses adjusted; poster responses stubbed in poster tests |
| `review-scripting.spec.ts` | An Editor runs a Script, reviews its Proposal, and applies or undoes the change. | Real |
| `settings-connections.spec.ts` | An Editor opens Settings and manages model connections, scoring choices, and diagnostics. | Stubbed |
| `step-gating.spec.ts` | An Editor sees what is needed to move from Import to Review, Timeline, and Export. | Stubbed |
| `studio-workflow-redesign.spec.ts` | An Editor completes the Import, Review, Timeline, and Export flow in both themes. | Real |
| `timeline-playback.spec.ts` | An Editor changes and plays Timeline Items, then exports the Timeline. | Real backend; analyze responses adjusted in selected tests; Resolve handoff export adjusted and overwrite export stubbed |
| `update-banner.spec.ts` | An Editor sees, dismisses, or opens a newly available app update. | Real backend; desktop bridge stubbed; no analysis |
| `update-section.spec.ts` | An Editor checks the installed version and opens the release page from Settings. | Real backend; desktop bridge stubbed; no analysis |
| `visual-conformance.spec.ts` | The main workspaces show representative content and fit their intended layouts. | Stubbed |
