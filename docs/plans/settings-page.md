# Plan: Settings Page

Status: partially implemented (reconciled 2026-07-02). Shipped: `SettingsModal.tsx`
(theme, Diagnostics, Connect-your-AI tab, 4-field harness form) backed by
`GET/PUT /settings` (`backend/src/app_settings.py`). Unbuilt: scoring/storage/
export/app sections (incl. ffmpeg-path override + validation) and the entire
per-project override model — `project.json.settings_overrides` exists but no
code reads it as settings. The override model needs a design review before
implementation; the flat global sections are mechanical adds.
Owner: TBD
Depends on: `project-folder-model.md` (global vs per-project split, `project.json::settings_overrides`)
Pairs with: `project-sidebar.md`, `ui-polish-modern-shell.md`

## Goal

One settings surface, two scopes:

1. **Global** — preferences that apply across all projects. Stored in `~/Library/Application Support/AIClipAssembler/settings.json`.
2. **Per-project** — overrides for the currently open project. Stored in `clipassembler/project.json::settings_overrides`. Falls back to global when not set.

Every per-project setting starts at "inherit from global" and shows a clear visual indicator when overridden.

## Non-Goals

- Multi-user / role-based settings.
- Settings sync across machines (local-first).
- Plugin / extension settings (no plugin system yet).
- Hardware tuning (GPU selection, CPU cap) — defer until performance work demands it.

## Settings Inventory

Grouped by section. Scope column: **G** = global only, **P** = per-project, **G+P** = global default with per-project override.

### Section: Harness

| Setting | Scope | Default | Notes |
|---|---|---|---|
| Active harness | G+P | `pi_agent` | One of: `manual`, `pi_agent`, `local_qwen`. Drives which scoring runs on analyze. |
| Pi auth status | G | (read-only) | Shows authenticated email + token expiry; "Re-authenticate" button shells out to `pi login`. |
| Pi model | G+P | `gpt-5.4-mini` | Free text for now; future dropdown when stable model list exists. |
| Ollama URL | G | `http://localhost:11434` | Only relevant when harness = `local_qwen`. |
| Ollama model | G+P | `qwen3-vl:8b` | Same. |
| Ollama temperature | G+P | `0.2` | Float slider 0.0–1.0. |

### Section: Clip Scoring Defaults

| Setting | Scope | Default | Notes |
|---|---|---|---|
| Smoothness threshold | G+P | `7` | Slider 0–10. Per-project override is common. |
| Min clip duration | G+P | `3s` | |
| Max clip duration | G+P | `15s` | |
| Target total duration | G+P | `120s` | |
| Sample FPS | G+P | `1` | Frames per second of source to extract for analysis. Higher = slower analysis, finer granularity. |

### Section: Storage & Files

| Setting | Scope | Default | Notes |
|---|---|---|---|
| Default project folder | G | `~/Movies` | Initial directory for the folder picker. |
| ffmpeg binary path | G | (auto-detect) | Honest about the QA pain — let users override the PATH-resolved binary when they need `ffmpeg-full` for `vidstabdetect`. Validate on save. |
| ffprobe binary path | G | (auto-detect) | Same. |
| Cache cleanup policy | G+P | "Keep" | "Keep", "Delete on close", "Delete weekly". Targets `clipassembler/cache/`. |

### Section: Export

| Setting | Scope | Default | Notes |
|---|---|---|---|
| Default export format | G+P | `davinci` | One of `davinci`, `fcp`, `edl`. |
| Overwrite without prompt | G+P | `false` | Off by default — confirm before overwriting an existing export. |
| Filename template | G+P | `{project}-{date}` | Tokens: `{project}`, `{date}`, `{harness}`. |

### Section: App

| Setting | Scope | Default | Notes |
|---|---|---|---|
| Theme | G | `dark` | Light theme deferred. PRD says dark-default for video editing. |
| Keyboard shortcuts | G | (defaults) | Read-only for v1; customization deferred. |
| Telemetry | G | `off` | Anonymized crash reports only, off by default. Build the UI even if backend is no-op. |
| Backend URL | G | `http://127.0.0.1:8000` | Only for advanced users running backend elsewhere. |

### Section: Diagnostics (read-only)

Not a settings group, but lives on the same page as the natural place users look for "is everything OK":

- Backend health (✓ reachable / ✗ down + reason).
- ffmpeg version + `vidstabdetect` available?
- ffprobe version.
- Pi CLI installed + authenticated?
- Ollama reachable? (only shown when local_qwen harness selected)
- Disk space free at default project folder.
- Open log file button → reveals `~/Library/Logs/AIClipAssembler/main.log` in Finder.

This is the natural home for the "react-doctor for the runtime environment" the user wanted — health checks live here, not in a separate menu.

## Layout

```
Settings                                     ⌘,
─────────────────────────────────────────────
Sidebar (sections)        Main panel
─────────────────────     ─────────────────────────
  Harness            ●     Active harness  [pi_agent ▾]
  Clip Scoring             Pi auth         elvijs@gmail.com  [Re-auth]
  Storage                  Pi model        [gpt-5.4-mini   ]
  Export                   
  App                      ─────────────────────────
  Diagnostics              Per-project overrides for "sunset-drone-footage":
                           
                           Active harness        ● inherit  ○ override [..▾]
                           Smoothness threshold  ● inherit  ○ override [7]
                           ...
─────────────────────     ─────────────────────────
                                                    [Reset section] [Done]
```

- Settings page is a route (`/settings`) accessible from the sidebar's bottom-pinned **Settings** entry.
- Per-project section only renders if a project is open.
- "Override" toggle shows the inherited value greyed out beside the override input.
- "Reset section" reverts all overrides in that section back to inherit.

## Storage Format

### Global: `~/Library/Application Support/AIClipAssembler/settings.json`

```json
{
  "schema_version": 1,
  "harness": {
    "active": "pi_agent",
    "pi_model": "gpt-5.4-mini",
    "ollama_url": "http://localhost:11434",
    "ollama_model": "qwen3-vl:8b",
    "ollama_temperature": 0.2
  },
  "scoring": {
    "smoothness_threshold": 7,
    "min_clip_duration_sec": 3,
    "max_clip_duration_sec": 15,
    "target_duration_sec": 120,
    "sample_fps": 1
  },
  "storage": {
    "default_project_folder": "/Users/elvijs/Movies",
    "ffmpeg_path": null,
    "ffprobe_path": null,
    "cache_policy": "keep"
  },
  "export": {
    "default_format": "davinci",
    "overwrite_without_prompt": false,
    "filename_template": "{project}-{date}"
  },
  "app": {
    "theme": "dark",
    "telemetry": false,
    "backend_url": "http://127.0.0.1:8000"
  }
}
```

### Per-project: `<project>/clipassembler/project.json::settings_overrides`

Same shape, sparse — only contains keys that override:

```json
{
  "settings_overrides": {
    "scoring": {
      "smoothness_threshold": 5
    },
    "harness": {
      "active": "manual"
    }
  }
}
```

Resolution: deep-merge with global as base, override on top.

## IPC API

```ts
window.api.settings = {
  getEffective: (projectId?: string) => Promise<Settings>,  // merged result
  getGlobal: () => Promise<Settings>,
  getOverrides: (projectId: string) => Promise<Partial<Settings>>,
  setGlobal: (patch: Partial<Settings>) => Promise<Settings>,
  setOverride: (projectId: string, patch: Partial<Settings>) => Promise<Partial<Settings>>,
  clearOverride: (projectId: string, path: string) => Promise<void>,  // path like "scoring.smoothness_threshold"
  runDiagnostics: () => Promise<DiagnosticsReport>,
}
```

## Acceptance

- [ ] Opening Settings from sidebar shows global section.
- [ ] When a project is open, Settings also shows per-project overrides for that project.
- [ ] Changing a global value persists to `settings.json` and takes effect immediately for all projects without overrides.
- [ ] Adding an override persists to `project.json` and takes effect for that project only.
- [ ] Re-launch preserves all settings.
- [ ] Diagnostics section accurately reflects ffmpeg/Pi/Ollama state and updates on the "Refresh" button.
- [ ] Invalid ffmpeg path on save shows validation error; setting not saved.
- [ ] Settings page passes react-doctor a11y rules (form labels associated, button types explicit).

## Open Questions

1. Should there be an "Export settings as JSON" / "Import settings" pair for backup?
2. Per-project "Reset to global defaults" — should that wipe the entire `settings_overrides` block, or just one section?
3. Telemetry: ship the toggle now even though there's no backend collecting? My recommendation: yes, sets the expectation early that it's off-by-default and opt-in.
4. Hot-reload of settings vs requiring restart for certain values (backend URL probably needs a reconnect cycle).
