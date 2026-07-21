# Plan: Modern professional UI shell

Status: PARTIAL. `AppShell`, Sidebar, TitleBar, StatusBar, tokens, and dark
editor chrome shipped; component migration, Cmd-K palette, style consolidation,
and score verification remain. Pairs with sidebar/settings/react-doctor plans.

## Goal and decision

Create a dense, calm desktop-editor shell shared by Import, Review, Timeline,
and Export. Non-goals: clip-card product redesign, light/mobile layouts, and
delight polish.

Use shadcn/ui + Radix + Tailwind v4 + lucide-react. Tailwind is already present;
shadcn copies owned code into the repo and supports custom editor primitives;
Radix addresses recurring accessibility issues. Mantine was rejected for
replacing Tailwind and reading as a heavier SaaS dashboard; Park/Ark was too
young, Tamagui overbuilt, and MUI/Chakra generic/heavy.

## Architecture and remaining work

- Centralize palette, type, spacing, radii, and motion in `styles/tokens.css`
  via Tailwind `@theme`. The 11px minimum is a deliberate Resolve/FCP/Premiere
  density choice, so document/suppress the react-doctor warning rather than
  silently enlarging it.
- Keep one shell: title bar, project sidebar, routed `<Outlet/>`, and status bar
  for backend/FFmpeg/Pi health plus Candidate Clip count.
- Migrate routes one at a time to owned shadcn primitives and Radix controls:
  Import → Review → Export → status bar → `cmdk` command palette. Remove local
  hardcoded styling as each surface moves; do not redesign behavior in the same
  change. Generate files from the frontend package root after confirming
  `components.json` paths.

## Open choices and verification

Choose native vs custom title bar (native preferred), bundled Inter vs system
font, and whether status-bar hiding is worth post-v1 scope. Run typecheck, lint,
build, keyboard/accessibility checks, and react-doctor after each route. The
first migration set targeted ~95+/100, but current tooling output—not the old
estimate—is the acceptance signal.
