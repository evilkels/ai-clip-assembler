# Self-Contained macOS Runtime Tools

## Status

Approved design; implementation plan pending review.

## Goal

A release user installs AI Clip Assembler by dragging one DMG application to
Applications. The app must start its Python backend and analyse footage without
requiring Python, a virtual environment, pip, Homebrew, or terminal commands.

## Current state

The Python backend is already frozen with PyInstaller and copied to the
Electron application's resources. It starts as a child process on a free local
port. FFmpeg remains external: the app prepends common Homebrew paths to the
backend's `PATH`, so a fresh Mac cannot perform full motion analysis unless its
owner manually installs an FFmpeg build with `vidstabdetect`.

## Decision

Ship private, architecture-matched `ffmpeg` and `ffprobe` executables inside
the macOS application bundle. Electron resolves the current architecture's
tool directory, verifies the required executables before starting the backend,
and prepends that directory to the backend-only `PATH`. The backend therefore
uses the packaged tools ahead of any system installation. Development behavior
continues to use the developer's `PATH`.

The application does not download, build, or install dependencies at first
run. Runtime downloads make a local-first desktop tool less predictable,
require network access, complicate signature verification, and create an
unreliable failure path for a new user.

## Bundled layout

The release build produces tools for both supported macOS architectures and
packages exactly one matching pair into each app artifact:

```text
AI Clip Assembler.app/
  Contents/Resources/
    backend/ai-clip-backend
    tools/
      ffmpeg
      ffprobe
    licenses/
      ffmpeg/
        COPYING.GPLv3
        build-config.txt
        source-offer.txt
```

The source repository keeps executable artifacts outside tracked source. CI
installs a pinned Homebrew FFmpeg build with `libvidstab` on each matching
macOS runner, stages the executable plus its dynamic-library closure into the
Electron build resources, and verifies the staged copy before packaging.

## Startup and recovery

1. Electron finds the bundled `ffmpeg` and `ffprobe` paths for the current
   release architecture.
2. It confirms both files are executable and runs a bounded `ffmpeg -filters`
   preflight.
3. The preflight requires `vidstabdetect`; failure is captured as a structured
   runtime-tool status rather than deferred until a user clicks Analyse.
4. Electron starts the packaged backend with the tools directory first in its
   `PATH` and preserves existing provider tool discovery (`pi`) after it.
5. The renderer receives a diagnostics status. If preflight fails, Settings
   identifies the damaged/missing bundled tool and offers safe actions only:
   reveal diagnostic log and reveal the installed application. It does not ask
   the user to run a shell command.

## Licensing and supply chain

`libvidstab` makes the required FFmpeg build GPL-covered. Each distributed
artifact must include the applicable GPL notice, the exact FFmpeg configure
line/build metadata, and a durable offer or link for the corresponding source
as required by the distributed build. The release process must pin the source
revision, verify SHA-256 checksums for downloaded/prebuilt inputs, and record
the architecture and version in `build-config.txt`.

This design is not legal advice. The release owner must review the final
distribution package against [FFmpeg's legal guidance](https://www.ffmpeg.org/legal.html)
before public distribution.

## Out of scope

- Windows/Linux bundling.
- Downloading tools after installation.
- Bundling optional cloud-AI provider CLIs; those remain optional and
  user-controlled.
- Replacing motion analysis with FFmpeg-free logic.

## Acceptance criteria

- A clean Apple Silicon and a clean Intel macOS test account can install the
  matching DMG and complete import, analysis, review, and export with no
  developer tools installed.
- The exact packaged `ffmpeg` reports `vidstabdetect`.
- The backend uses the packaged executable before a conflicting system FFmpeg.
- A missing or damaged bundled executable appears in app diagnostics before an
  analysis job begins.
- The final DMG contains the required license and source-compliance materials.
