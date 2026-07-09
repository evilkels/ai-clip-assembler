# Plan: Project Sidebar

Status: partially implemented; auto-reopen persistence shipped; remaining sidebar UX items deferred pending visual QA
Owner: Elvijs / Codex
Depends on: `project-folder-model.md` (project = folder, `recent.json` in app-data)
Pairs with: `settings-page.md`, `ui-polish-modern-shell.md`

## Goal

A persistent left-edge sidebar listing the user's projects. Click switches the open project; "Create Project" lives at the top. Empty state on first launch.

This is the **only entry point** to a project after launch. No project list lives anywhere else.

## Non-Goals

- Project search across the filesystem (sidebar is just the recents list).
- Tags / folders / nesting within the sidebar (flat list for v1).
- Multi-project workspaces (one open project at a time).
- Cloud sync, sharing, presence indicators (local-first app).

## Data Source

Single source of truth: `~/Library/Application Support/AIClipAssembler/recent.json` (defined in `project-folder-model.md` and implemented in `frontend/src/main/index.ts`).

```json
[
  {
    "folderPath": "/Users/elvijs/Movies/sunset-drone-footage",
    "lastOpenedAt": "2026-05-30T19:00:00Z",
    "name": "sunset-drone-footage"
  }
]
```

The Electron main process owns recents through `recentProjectsPath`,
`project:recent-list`, `project:recent-add`, `project:recent-remove`,
`project:recent-relocate`, and `project:recent-last-opened` IPC handlers. The
list is capped at 20 entries and sorted by `lastOpenedAt` via writes; auto-open
checks the newest folder and skips relaunch reopen silently when that folder is
missing.

The sidebar reads this file on app boot. It writes when:
- User creates a new project (prepend to recents).
- User opens an existing project (move to top).
- User removes a project from the list (delete entry).

Display name is the saved `name` from the project manifest, falling back to the
folder basename.

## States

| State | Trigger | UI |
|---|---|---|
| Empty | First launch, no recents | Sidebar shows "No recent projects"; Open Folder remains available. |
| Single project | One entry in recents | Show it, highlighted as open. |
| Many projects | N entries in recents | List, most recent first, open one highlighted. |
| Missing folder | recent path no longer exists | Show grayed-out, "Locate…" button beside it. |

## Interactions

| Action | Trigger | Behavior |
|---|---|---|
| Open project | Click row | Load project through `ReviewContext.openProjectFolder`, add it to recents, and keep the current route. |
| Open folder | Top button | Native folder picker → backend opens/creates folder project → adds to recents → opens it. |
| Remove from list | Inline "Remove" button | Deletes from recents only. **Does not touch disk.** |
| Locate missing | Click "Locate…" on missing entry | Folder picker scoped to find the moved folder; updates the entry's path. |
| Rename (v2) | Future context menu → "Rename" | Sets a display-name override. Folder on disk unchanged. Defer. |
| Delete from disk (v2) | Future context menu → "Delete project files…" with double confirm | Removes `clipassembler/` + `exports/`. **Never touches video files.** Defer. |

## Layout

```
┌─────────────────────────────┐
│  AI Clip Assembler          │ <- titlebar (frameless, native traffic lights on macOS)
├──────────┬──────────────────┤
│ Open     │                  │ <- sidebar header: folder picker button
│          │                  │
│ ● sunset │   Main area      │ <- open project (filled dot)
│   forest │   (Review /      │
│   coast  │    Import /      │
│   ⚠ ski  │    Export)       │ <- missing (warning icon)
│          │                  │
│   ──────│                  │
│   Settings                   │ <- settings entry pinned at bottom
└──────────┴──────────────────┘
```

Sidebar width: 220px default, resizable to 180-320px, persisted in app-data.

Collapsible: hotkey `Cmd-B` toggles. Collapsed state shows icons only (rail-mode, 56px wide).

## Component Choices

Per `ui-polish-modern-shell.md`:

- Current shipped implementation: custom React sidebar in
  `frontend/src/renderer/src/layouts/Sidebar.tsx`, with inline action buttons
  for Locate/Remove and hand-authored SVG icons.
- Deferred: resizable/collapsible rail, context menus, and keyboard-navigation
  verification after visual QA.

## Frontend Wiring

Shipped implementation:

- `frontend/src/main/index.ts` reads/writes `recent.json` and exposes project
  IPC. There is no separate `frontend/src/main/projects.ts`.
- `frontend/src/preload/index.ts` exposes the IPC methods on
  `window.clipAssembler`.
- `frontend/src/renderer/src/api/client.ts` wraps the preload API and backend
  HTTP API.
- `frontend/src/renderer/src/state/ReviewContext.tsx` owns the open project,
  recents, and the folder-open flow. On mount it asks main for
  `project:recent-last-opened` and reuses `openProjectFolder`.
- `frontend/src/renderer/src/layouts/Sidebar.tsx` renders the recents list and
  calls the same `openProjectFolder` path for user-initiated opens.

Existing routes (`Review.tsx`, `Import.tsx`, `Export.tsx`) consume the open
project state from `ReviewContext`.

## IPC API

Exposed via `preload`:

```ts
window.clipAssembler = {
  selectProjectFolder: () => Promise<string | null>,
  listRecentProjects: () => Promise<RecentProject[]>,
  getLastOpenedRecentProject: () => Promise<RecentProject | null>,
  addRecentProject: (folderPath: string, name?: string) => Promise<RecentProject[]>,
  removeRecentProject: (folderPath: string) => Promise<RecentProject[]>,
  relocateRecentProject: (folderPath: string) => Promise<RecentProject[]>,
}
```

`Project` shape comes from backend's `project.json` reader (see folder-model plan).

## Migration

- First launch after this lands: `recent.json` doesn't exist → empty state, no errors.
- If the old `.ai-clip-assembler/projects/` exists (current scaffolding): one-time migration banner offers to move each into a folder-based project. Defer to v1.1 if scope creeps.

## Acceptance

- [x] Cold launch with no recents → empty sidebar state with Open Folder button.
- [x] Open Folder flow: pick folder → folder appears in sidebar and project opens.
- [x] Re-launch the app → last-open project re-opens automatically, sidebar populated.
- [x] Move a project folder on disk → sidebar shows it as missing → Locate flow recovers it.
- [x] Inline Remove → entry disappears, folder on disk untouched.
- [ ] `Cmd-B` toggles collapsed/expanded; preference persists.
- [ ] Sidebar passes react-doctor a11y rules (keyboard nav, ARIA roles).

## Implementation Status

Implemented:

- Persistent `recent.json` storage in the Electron main process.
- Sidebar recent-project list, active project state, create/open folder action, missing-folder state, Locate, Remove, and Rescan.
- Preload IPC methods and renderer API/client wiring for recent projects.
- Automatically re-open the last-open project after relaunch, using the newest
  recent folder and falling back silently when that folder no longer exists.

Remaining:

- `Cmd-B` collapsed/expanded rail and persisted resizable sidebar width.
- Replace inline Locate/Remove buttons with the planned context-menu interaction.
- Complete keyboard-navigation/a11y verification.

These remaining items are deferred pending visual QA on the current Electron
shell.

## Open Questions

1. Should the sidebar also show open backend status (green dot = backend healthy)? Or push to the settings page / a status bar?
2. Max recents — cap at 20? Pin support?
3. Drag to reorder recents? Probably not for v1; "last opened" sort is enough.
