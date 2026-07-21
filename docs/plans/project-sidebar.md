# Plan: Project Sidebar

Status: partially implemented; auto-reopen persistence shipped; remaining
sidebar UX items deferred pending visual QA.
Depends on: `project-folder-model.md` (project = folder, `recent.json` in
app-data). Pairs with: `settings-page.md`, `ui-polish-modern-shell.md`.

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

Remaining: `Cmd-B` collapsed/expanded rail + persisted resizable width;
replacing inline Locate/Remove buttons with a context-menu interaction;
keyboard-nav/a11y verification (react-doctor rules). Migration: first launch
with no `recent.json` → empty state, no errors; a migration banner for the
old `.ai-clip-assembler/projects/` scaffolding is deferred to v1.1 if scope
creeps. Open questions: show backend health status in the sidebar (or push
to settings/status bar)? Pin support for recents? Drag-to-reorder — probably
not for v1, last-opened sort suffices.
