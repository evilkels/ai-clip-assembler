# Plan: Settings Page

**Status: DONE (2026-07-03)** — shipped as the Settings & Diagnostics modal in `frontend/src/renderer/src/components/SettingsModal.tsx` (`8523ed9`) plus theme switching (`cd1ef24`).

Owner: Elvijs. Depends on `project-folder-model.md` (global vs per-project split). Pairs with `project-sidebar.md`, `ui-polish-modern-shell.md`. All three now live in this folder.

## Goal

One settings surface, two intended scopes: **global** (`~/Library/Application Support/AIClipAssembler/settings.json`) and **per-project** (`clipassembler/project.json::settings_overrides`, falling back to global). Non-goals: multi-user/role settings, cross-machine sync, plugin settings, hardware tuning (deferred).

## What actually shipped vs. planned

The original plan specified a full inventory (Harness, Clip Scoring Defaults, Storage & Files, Export, App, Diagnostics sections) with global+per-project override toggles for most settings, plus an IPC API (`getEffective`/`getGlobal`/`getOverrides`/`setGlobal`/`setOverride`/`clearOverride`/`runDiagnostics`).

**The shipped slice is narrower**: global runtime AI settings, theme preference, "Connect your AI," and review-model diagnostics. The broader per-project override model **did not ship**:
- Per-project overrides in Settings UI: not shipped.
- Persisting overrides to `project.json`: not shipped.
- ffmpeg/ffprobe path override + validation: not shipped (superseded — this scope was dropped).
- Diagnostics: shipped, reflects Pi review-model reachability with a "Run check again" button.
- Re-launch preserves saved runtime AI settings and theme: shipped.
- Settings page received the 2026-07-03 react-doctor mechanical a11y/markup pass (PR #35): shipped.

## Design decisions worth keeping

- Storage format: global settings as one JSON file; per-project overrides sparse (only overridden keys), deep-merged with global as base — this merge model was designed but the per-project side never got built.
- Diagnostics section was deliberately placed inside Settings, not a separate menu — "the natural home for the react-doctor-for-the-runtime-environment" health checks (backend reachability, ffmpeg/vidstabdetect, ffprobe, Pi CLI auth, Ollama reachability, disk space, open-log button).

## Open questions (unresolved)

Export/import settings JSON for backup; whether per-project "Reset to global" wipes the whole override block or just one section; telemetry toggle shipped as UI-only with no backend collector (deliberate, to set the off-by-default expectation early); hot-reload vs. restart-required for settings like backend URL.
