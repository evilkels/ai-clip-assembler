# Plan: Modern professional UI shell

> **CLOSED AS SUPERSEDED (2026-09-02).** This plan prescribed a shadcn/ui and
> Radix migration; the studio redesign (`6d79c1b`, v0.2.0) delivered the same
> visual goals with hand-authored CSS and design tokens instead, so the
> migration will not happen. Its three surviving items — Cmd-K palette, score
> verification, and the Settings/Diagnostics surfaces — moved to
> [`shell-followups.md`](../shell-followups.md). Kept for the component-library
> evaluation and the rejected-approach record.

Status: SUPERSEDED for the workflow routes (reconciled 2026-08-31); the library
decision it prescribes was settled against it by what shipped.

**2026-08-31:** `2026-08-14-studio-workflow-redesign.md` delivered the shared
design system, shell, and all four workflow routes (Import, Review, Timeline,
Export) as hand-authored tokens/CSS — the opposite of the shadcn/Radix stack this
plan prescribes, and still with none of those packages installed. The "component
migration" and "style consolidation" work below is therefore done by other means;
do not execute it as written. What genuinely remains and is not covered by the
redesign: the Cmd-K palette, score verification, and the Settings/Diagnostics
surfaces the redesign explicitly excluded. Either rewrite this plan around those
three, or close it and fold them into new plans.

Previous status (retained for history): PARTIAL, **and its central library
decision is now contradicted by what shipped** (reconciled 2026-08-13). `AppShell`, Sidebar, TitleBar, StatusBar,
tokens, and dark editor chrome shipped; component migration, Cmd-K palette,
style consolidation, and score verification remain. Pairs with
sidebar/settings/react-doctor plans.

> **Decide before implementing anything below.** This plan prescribes shadcn/ui
> + Radix + lucide-react + `cmdk`. None of those are installed: `package.json`
> carries only `tailwindcss` (no config file, no `components.json`), and every
> shell surface delivered so far is hand-authored CSS against
> `styles/tokens.css` with hand-written inline SVG icons — a path
> `project-sidebar.md` records as a deliberate choice *over* a component
> library, and which plan 022 then built on. The remaining work is therefore not
> executable as written: either adopt the stack for real (a large migration that
> would rework shipped surfaces) or rewrite this plan around the tokens/CSS
> approach that actually shipped. Do not start a route migration until that
> choice is made.

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
