# Updating and removing the app

Two things keep an installed copy of AI Clip Assembler current: the app tells you
when a newer release exists, and `scripts/app-wizard.sh` performs the update or
removal.

## In-app update notice

On launch the app asks GitHub for the newest published release and compares it to
its own version. If a newer one exists, a banner appears above the workspace:

> Version 0.1.4 is available — you have 0.1.0. **See what's new** · **Not now**

- **See what's new** opens the release page in your browser.
- **Not now** silences that notice. The banner returns for the *next* release.

The result is cached in `~/Library/Application Support/ai-clip-assembler/update-check.json`
for six hours, so a launch loop does not hammer the API. If the check fails
(offline, or GitHub rate-limiting an unauthenticated request), the app falls back
to the last release it saw and never shows an error — there is nothing useful for
you to do about a failed check.

The notice does **not** download or install anything. Release DMGs are currently
unsigned and un-notarized, so a silent in-place upgrade (electron-updater's usual
job) cannot work on macOS. Once signing and notarization land — tracked in
[`plans/self-contained-runtime-tools.md`](plans/self-contained-runtime-tools.md) —
the notice can grow into a real background update.

## The wizard

```bash
./scripts/app-wizard.sh            # interactive menu
./scripts/app-wizard.sh status     # what is installed vs. what is released
./scripts/app-wizard.sh update     # install the latest release
./scripts/app-wizard.sh uninstall  # remove the app
```

`status` prints the installed version, the latest release, your architecture, and
how much application-support data exists.

`update` picks the DMG matching your architecture (`arm64` or `x64`) from the
latest release, using `gh` when it is installed and the GitHub API otherwise.
Then it quits the running app (with your confirmation), mounts the DMG, moves the
current bundle aside to `AI Clip Assembler.app.previous`, copies the new one in,
and deletes the backup only after the copy succeeds — a failed copy restores the
old version rather than leaving `/Applications` empty. Because the build is
unsigned, it finally offers to clear the download quarantine flag; declining just
means the first launch needs Finder → right-click → **Open**.

`uninstall` removes the app bundle, then asks separately about
`~/Library/Application Support/ai-clip-assembler` (recent-projects list, update
state, sign-in cache) and clears caches, logs and saved state.

**Your project folders are never touched by either command.** Footage, generated
clips and exports live wherever you created them; removing the app leaves all of
it in place, and reinstalling picks the projects back up.

## Cutting a release

Version numbers come from `frontend/package.json`, which `electron-builder` bakes
into the bundle and `app.getVersion()` reports to the update check. A tag whose
version was not bumped produces a DMG that still claims the old version, and the
update check then sees no update. So:

1. Bump `frontend/package.json` (`npm version <x.y.z> --no-git-tag-version`) and
   `APP_VERSION` in `backend/src/api.py` in the same commit.
2. Merge that to `main`.
3. Tag it: `git tag v<x.y.z> && git push origin v<x.y.z>`.
4. `.github/workflows/build-dmg.yml` builds both architectures and attaches the
   DMGs to the release. It fails fast if the tag disagrees with either version,
   so a forgotten bump can no longer ship a mislabeled DMG.
