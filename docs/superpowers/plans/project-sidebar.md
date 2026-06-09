# Plan: Project Sidebar

Status: partially implemented; remaining UX and persistence acceptance items are active
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

Single source of truth: `~/Library/Application Support/AIClipAssembler/recent.json` (defined in `project-folder-model.md`).

```json
{
  "schema_version": 1,
  "open_project_path": "/Users/elvijs/Movies/sunset-drone-footage",
  "recents": [
    {
      "path": "/Users/elvijs/Movies/sunset-drone-footage",
      "last_opened_at": "2026-05-30T19:00:00Z",
      "display_name_override": null
    },
    ...
  ]
}
```

The sidebar reads this file on app boot and on focus-regain. It writes when:
- User creates a new project (prepend to recents).
- User opens an existing project (move to top).
- User removes a project from the list (delete entry).

Display name is the folder basename unless `display_name_override` is set (future rename feature, out of scope for v1).

## States

| State | Trigger | UI |
|---|---|---|
| Empty | First launch, no recents | Centered prompt: "Create your first project" + folder-picker button. No sidebar items. |
| Single project | One entry in recents | Show it, highlighted as open. |
| Many projects | N entries in recents | List, most recent first, open one highlighted. |
| Missing folder | recent path no longer exists | Show grayed-out, "Locate…" button beside it. |
| Read-only folder | path exists but not writable | Show with warning icon, tooltip explains. |

## Interactions

| Action | Trigger | Behavior |
|---|---|---|
| Open project | Click row | Load project, update `open_project_path`, navigate to Review Board. |
| Create project | Top button | Native folder picker → calls backend `create_project(path)` → adds to recents → opens it. |
| Open existing folder | "Open…" button at bottom | Native folder picker → if folder has `clipassembler/`, load; else offer to create. |
| Remove from list | Right-click → "Remove from list" | Deletes from recents only. **Does not touch disk.** |
| Locate missing | Click "Locate…" on missing entry | Folder picker scoped to find the moved folder; updates the entry's path. |
| Rename (v2) | Right-click → "Rename" | Sets `display_name_override`. Folder on disk unchanged. Defer. |
| Delete from disk (v2) | Right-click → "Delete project files…" with double confirm | Removes `clipassembler/` + `exports/`. **Never touches video files.** Defer. |

## Layout

```
┌─────────────────────────────┐
│  AI Clip Assembler          │ <- titlebar (frameless, native traffic lights on macOS)
├──────────┬──────────────────┤
│ + New    │                  │ <- sidebar header: create button
│          │                  │
│ ● sunset │   Main area      │ <- open project (filled dot)
│   forest │   (Review /      │
│   coast  │    Import /      │
│   ⚠ ski  │    Export)       │ <- missing (warning icon)
│          │                  │
│   ──────│                  │
│   Open…  │                  │ <- "open existing folder" button at bottom
│   Settings                   │ <- settings entry pinned at bottom
└──────────┴──────────────────┘
```

Sidebar width: 220px default, resizable to 180-320px, persisted in app-data.

Collapsible: hotkey `Cmd-B` toggles. Collapsed state shows icons only (rail-mode, 56px wide).

## Component Choices

Per `ui-polish-modern-shell.md`:

- shadcn/ui `Sidebar` primitive (it has one in 2025 — supports rail mode, persistence, keyboard nav out of the box).
- lucide-react icons (`Plus`, `Folder`, `FolderOpen`, `Settings`, `AlertTriangle`).
- Radix `ContextMenu` for right-click actions.
- Radix `Tooltip` for missing-folder explanations.

## Frontend Wiring

New: `frontend/src/renderer/src/state/ProjectsContext.tsx` — owns the recents list + open project. Loads from main process via IPC (`window.api.projects.listRecents()`, `window.api.projects.openProject(path)`, etc).

New: `frontend/src/main/projects.ts` — reads/writes `recent.json`, talks to backend HTTP for `create_project` / project metadata.

Existing routes (`Review.tsx`, `Import.tsx`, `Export.tsx`) consume the open project ID from `ProjectsContext`. If no project is open, redirect to a placeholder empty state.

## IPC API

Exposed via `preload`:

```ts
window.api.projects = {
  listRecents: () => Promise<RecentProject[]>,
  openProject: (path: string) => Promise<Project>,
  createProject: (path: string) => Promise<Project>,
  removeFromRecents: (path: string) => Promise<void>,
  relocateProject: (oldPath: string, newPath: string) => Promise<Project>,
  pickFolder: () => Promise<string | null>,
}
```

`Project` shape comes from backend's `project.json` reader (see folder-model plan).

## Migration

- First launch after this lands: `recent.json` doesn't exist → empty state, no errors.
- If the old `.ai-clip-assembler/projects/` exists (current scaffolding): one-time migration banner offers to move each into a folder-based project. Defer to v1.1 if scope creeps.

## Acceptance

- [ ] Cold launch with no recents → empty state with create button.
- [ ] Create flow: pick folder → folder appears in sidebar, project opens, main area shows Review Board.
- [ ] Re-launch the app → last-open project re-opens automatically, sidebar populated.
- [ ] Move a project folder on disk → sidebar shows it as missing → Locate flow recovers it.
- [ ] Right-click → Remove → entry disappears, folder on disk untouched.
- [ ] `Cmd-B` toggles collapsed/expanded; preference persists.
- [ ] Sidebar passes react-doctor a11y rules (keyboard nav, ARIA roles).

## Implementation Status

Implemented:

- Persistent `recent.json` storage in the Electron main process.
- Sidebar recent-project list, active project state, create/open folder action, missing-folder state, Locate, Remove, Rescan, and Delete Project Files.
- Preload IPC methods and renderer API/client wiring for recent projects.

Remaining:

- Automatically re-open the last-open project after relaunch.
- Navigate directly to the Review Board after create/open.
- Resizable/collapsible rail mode with persisted width and `Cmd-B`.
- Replace the current inline action buttons with the planned context-menu interaction.
- Complete keyboard-navigation/a11y verification.

## Open Questions

1. Should the sidebar also show open backend status (green dot = backend healthy)? Or push to the settings page / a status bar?
2. Max recents — cap at 20? Pin support?
3. Drag to reorder recents? Probably not for v1; "last opened" sort is enough.
