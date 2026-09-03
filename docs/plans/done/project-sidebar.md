# Plan: Project Sidebar

Status: **CLOSED 2026-09-03 — SUPERSEDED.** Everything this plan deferred has
an owner elsewhere, so nothing is tracked here any more. The header below was
stale: collapse and resize both shipped in the studio redesign and are covered
by `project-shell-regressions.spec.ts:268-273`, and the remaining interaction
items (sidebar context menu, keyboard pass) moved to
[`shell-followups.md`](../shell-followups.md). Row rename and the card-style
rows shipped in [plan 022](022-project-shell-header-and-sidebar.md).

This file stays as the authoritative record of the sidebar's data source and
decided interactions, which nothing else restates.

Depends on: [`project-folder-model.md`](project-folder-model.md) (project =
folder, `recent.json` in app-data). Pairs with: [`settings-page.md`](settings-page.md),
[`ui-polish-modern-shell.md`](ui-polish-modern-shell.md).

## Goal

A persistent left-edge sidebar listing the user's projects; click switches
the open project; "Create Project" at top; empty state on first launch. This
is the **only** entry point to a project after launch — no project list
lives anywhere else. Non-goals: filesystem search, tags/nesting (flat v1),
multi-project workspaces, cloud sync/sharing.

## Data source, decided interactions, layout

Single source of truth: `~/Library/Application Support/AIClipAssembler/recent.json`
— `[{folderPath, lastOpenedAt, name}]`, capped at 20 entries, sorted by
`lastOpenedAt`, owned by the Electron main process (`project:recent-*` IPC).
Display name is the manifest's saved `name`, falling back to folder basename.
Missing folder → grayed out with a "Locate…" recovery picker; Remove deletes
the recents entry only, never touches disk. Rename and "Delete project
files…" (double-confirm, never touches video files) deferred to v2. Sidebar
width 220px default, resizable 180-320px, persisted; collapsible via `Cmd-B`
to a 56px icon rail; settings entry pinned at bottom.

## Shipped implementation

Custom React sidebar `frontend/src/renderer/src/layouts/Sidebar.tsx` (inline
Locate/Remove buttons, hand-authored SVG icons) — chosen over a
component-library sidebar per `ui-polish-modern-shell.md`.
`frontend/src/main/index.ts` reads/writes `recent.json` and exposes IPC (no
separate `projects.ts` file, as originally sketched); preload exposes it on
`window.clipAssembler`. `ReviewContext.tsx` owns open project + recents +
folder-open flow, asking main on mount for `project:recent-last-opened` and
reusing `openProjectFolder`. Auto-reopen: relaunch reopens the newest recent
folder, falling back silently if it's missing.

## Remaining (deferred pending visual QA), migration, open questions

Remaining: none owned here as of 2026-09-02. The `Cmd-B` collapsed rail and
persisted resizable width **shipped** in the studio redesign (`AppShell.tsx`,
`hooks/usePanelWidth.ts`, asserted by
`project-shell-regressions.spec.ts:268-273`). The context-menu interaction and
the keyboard-nav/a11y verification moved to
[`shell-followups.md`](../shell-followups.md). Superseded above:
recents-label rename and alphabetical, card-style project rows shipped in
[plan 022](022-project-shell-header-and-sidebar.md), so the "Rename ...
deferred to v2" line no longer holds; `lastOpenedAt` is still written but no
longer drives display order. Migration: first launch
with no `recent.json` → empty state, no errors; a migration banner for the
old `.ai-clip-assembler/projects/` scaffolding is deferred to v1.1 if scope
creeps. Open questions: show backend health status in the sidebar (or push
to settings/status bar)? Pin support for recents? Drag-to-reorder — probably
not for v1, last-opened sort suffices.
