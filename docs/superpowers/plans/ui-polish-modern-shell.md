# Plan: Modern Professional UI Shell

Status: partially implemented, awaiting review
Owner: Elvijs / CODEX
Pairs with: `project-sidebar.md`, `settings-page.md`
Informs: `react-doctor-triage.md` (some a11y/correctness rules become trivial once we adopt the recommended library)

## Goal

Make the app look like a professional video editor — dense, dark, calm, opinionated — instead of generic React scaffolding. Establish design tokens, a layout shell, and a component library *once*, so the sidebar / settings / Review Board / Import / Export work all land on the same chrome.

## Non-Goals

- Re-designing the Review Board's clip-card interactions (that's product work, not chrome).
- Animations / "delight" polish (worry about that after the chrome is solid).
- A light theme. Dark-only for v1, per `PRD.md` ("Dark mode default video editing standard").
- Mobile or responsive design — this is a desktop Electron app, fixed minimum width 1024.

## Library Recommendation

### Recommended: shadcn/ui + Radix primitives + Tailwind v4 + lucide-react

**Why this fits this codebase:**

| Constraint | Why shadcn/ui fits |
|---|---|
| Tailwind v4 already in `frontend/package.json` | shadcn is Tailwind-native; no styling tooling rewrite. |
| React 19 | shadcn updated for React 19; works with `use()` and the new `forwardRef`-free patterns. |
| Electron desktop, no SSR | shadcn's "copy components into your repo" model means no runtime cost, no version-pinning a vendor. |
| react-doctor flagged 9 a11y issues | Radix primitives ship with correct ARIA / keyboard handling baked in — `<DropdownMenu>`, `<Dialog>`, `<Label>` etc. resolve most a11y rules trivially. |
| "Modern professional" subjective bar | shadcn is the current 2024-2026 default for serious React UIs (Linear-ish aesthetic). Looks the part. |
| Want to extend, not fight | Components live in your repo — you own them, modify freely. Critical for a video-editor that will need custom timeline / clip-card primitives. |

**Concrete additions to `frontend/package.json`:**

```jsonc
{
  "dependencies": {
    "@radix-ui/react-context-menu": "^2.x",
    "@radix-ui/react-dialog": "^1.x",
    "@radix-ui/react-dropdown-menu": "^2.x",
    "@radix-ui/react-label": "^2.x",
    "@radix-ui/react-slider": "^1.x",
    "@radix-ui/react-tooltip": "^1.x",
    "class-variance-authority": "^0.7.x",
    "clsx": "^2.x",
    "cmdk": "^1.x",            // command palette (Cmd-K)
    "lucide-react": "^0.4xx",  // icon set
    "sonner": "^1.x",          // toasts
    "tailwind-merge": "^2.x"
  }
}
```

shadcn components themselves are copied into `frontend/src/renderer/src/components/ui/` via `npx shadcn add <component>`. They are not a dep.

### Alternative considered: Mantine

Stronger out-of-the-box DataTable, batteries-included forms, opinionated dark theme. Downsides for *this* app:
- Replaces Tailwind v4; full styling refactor.
- Heavier runtime cost in Electron.
- Less "video editor" aesthetic, more "SaaS dashboard."
- Harder to customize the bespoke surfaces (timeline track, clip cards).

Pick Mantine only if rapid CRUD-forms productivity matters more than the editor look.

### Not considered for v1

- **Park UI / Ark UI** — newer, smaller ecosystem.
- **Tamagui** — over-engineered for desktop-only Electron.
- **MUI** — heavy, opinionated, looks generic.
- **Chakra UI** — bundle size, less aligned with the dark-editor aesthetic.

## Design Tokens

Tailwind v4 reads tokens from CSS custom properties. Single source in `frontend/src/renderer/src/styles/tokens.css`:

```css
@theme {
  /* Colors — dark editor palette */
  --color-bg-app: oklch(0.18 0.005 240);          /* nearly black, slight cool tint */
  --color-bg-surface: oklch(0.22 0.005 240);      /* sidebar, panels */
  --color-bg-elevated: oklch(0.27 0.008 240);     /* cards, popovers */
  --color-bg-hover: oklch(0.30 0.010 240);
  --color-border-subtle: oklch(0.30 0.005 240);
  --color-border-strong: oklch(0.38 0.008 240);

  --color-text-primary: oklch(0.96 0 0);
  --color-text-secondary: oklch(0.72 0 0);
  --color-text-muted: oklch(0.55 0 0);

  --color-accent: oklch(0.74 0.16 250);           /* calm blue, not Discord-purple */
  --color-accent-hover: oklch(0.80 0.16 250);
  --color-success: oklch(0.74 0.16 150);          /* smooth-score green */
  --color-warning: oklch(0.78 0.14 75);
  --color-danger: oklch(0.65 0.20 25);            /* shaky-clip red */

  /* Type scale — dense, editor-style */
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", monospace;

  --text-xs: 11px;    /* timecodes, secondary metadata */
  --text-sm: 13px;    /* default body */
  --text-md: 14px;    /* primary controls */
  --text-lg: 16px;    /* section headers */
  --text-xl: 20px;    /* page titles */

  /* Spacing — denser than Tailwind defaults for an editor */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* Radii */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;

  /* Motion */
  --duration-fast: 80ms;
  --duration-base: 160ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Note on the 11px size: this is what `react-doctor` currently flags. For an editor it's a legitimate choice — Resolve, FCP, and Premiere all use 10-11px in chrome. The triage doc already recommends suppressing those two findings; the design token formalizes the decision.

## Layout Shell

Single shell component wraps the routed main area:

```
┌────────────────────────────────────────────────┐
│  ◯ ◯ ◯   sunset-drone-footage    ⌘K            │ <- title bar (frameless on macOS)
├──────────┬─────────────────────────────────────┤
│ + New    │                                     │
│          │                                     │
│ ● sunset │                                     │
│   forest │      <Outlet />  (route content)    │
│   coast  │                                     │
│          │                                     │
│  ────────│                                     │
│  Open…   │                                     │
│  ⚙ Settings                                    │
├──────────┴─────────────────────────────────────┤
│ ● Backend  ffmpeg ✓  pi ✓  72 candidate clips  │ <- status bar
└────────────────────────────────────────────────┘
```

Top-level files (new):
- `frontend/src/renderer/src/layouts/AppShell.tsx`
- `frontend/src/renderer/src/layouts/Sidebar.tsx` (implements `project-sidebar.md`)
- `frontend/src/renderer/src/layouts/StatusBar.tsx`
- `frontend/src/renderer/src/layouts/TitleBar.tsx` (Electron-aware, hides on Linux/Win where the OS handles it differently)

## Component Upgrades For Existing Surfaces

| File | Today | After |
|---|---|---|
| `routes/Review.tsx` | Plain divs + ad-hoc styles | shadcn `Card` clip cards in a virtualized grid; Radix `Slider` for threshold; Radix `DropdownMenu` for per-clip actions |
| `routes/Import.tsx` | The `div onClick` flagged by react-doctor | shadcn `Button` for the drop zone + `Progress` per-file |
| `routes/Export.tsx` | JSON preview, plain buttons | shadcn `Tabs` for format switcher; `Card` per export with `RadioGroup` |
| `components/Timeline.tsx` | 391-line monolith | After react-doctor Batch 4 refactor: editor-style track with shadcn primitives + custom clip blocks |
| `components/ClipCard.tsx` | Buttons without `type` (15 doctor findings) | shadcn `Button` (typed by default) |

## Iconography

Single source: `lucide-react`. Editor-relevant set picked up-front:

- File / project: `Folder`, `FolderOpen`, `Plus`, `FolderSearch`
- Playback: `Play`, `Pause`, `SkipBack`, `SkipForward`
- Editing: `Scissors`, `Trash`, `Check`, `X`, `GripVertical` (drag handle)
- Status: `CheckCircle2`, `AlertTriangle`, `Loader2`
- Chrome: `Settings`, `Search`, `Command` (for ⌘K)

Default size 16px in dense chrome, 20px in main controls. Stroke width 1.75.

## Command Palette (Cmd-K)

`cmdk` powers a global command palette:

- Recent projects (jump-to-open).
- Routes (Review, Import, Export, Settings).
- Actions (New Project, Open Folder, Export, Re-analyze).
- Diagnostics shortcuts.

Hotkey `Cmd-K` (Mac), `Ctrl-K` (Win/Linux). Big visual win for "looks professional."

## Migration Plan

Not big-bang. Suggested PR order:

1. **PR 1** — Install deps, add tokens, add `AppShell` + `Sidebar` (with placeholder for Settings/Diagnostics). Existing routes render unchanged inside the shell. Visible: app looks dramatically different already.
2. **PR 2** — Replace `Import.tsx` chrome with shadcn `Button` / `Progress` (also fixes the 3 react-doctor findings on that file).
3. **PR 3** — Replace `Review.tsx` chrome with shadcn `Card` / `Slider` / `DropdownMenu` (fixes ~10 react-doctor findings).
4. **PR 4** — `Export.tsx` upgrade.
5. **PR 5** — Status bar + diagnostics summary.
6. **PR 6** — Command palette.

After PR 1-4, expected react-doctor score: ~95+/100 without any specific cleanup PRs.

## Acceptance

- [ ] All routes wrapped in `AppShell`, sidebar visible.
- [ ] Tokens centralized; no hardcoded hex colors in components.
- [ ] Cmd-K opens command palette.
- [ ] Re-running `npm run doctor` after PRs 1-4 shows ≥ 95/100 score with no new findings.
- [ ] Subjective: side-by-side with DaVinci Resolve / Final Cut, the app's chrome reads as "same category of tool," not "web dashboard."

## Open Questions

1. Custom title bar (frameless + custom traffic-light positioning) vs native? Custom looks more premium but is fragile across macOS versions. Recommendation: native for v1, revisit.
2. Font choice — bundle Inter via `@fontsource/inter` or rely on system stack? Bundling is one extra MB but consistent across systems.
3. Should the status bar be hide-able? Defer; show always for v1.
4. shadcn requires a `components.json` config file at the package root — confirm path conventions with the Electron-vite layout before generating.
