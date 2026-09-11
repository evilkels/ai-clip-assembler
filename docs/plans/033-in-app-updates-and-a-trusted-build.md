# Plan 033: Updates that install themselves, on an app macOS already trusts

Status: TODO · Priority P2 · Effort L · Risk HIGH · Category distribution + trust
Created 2026-09-11 against `v0.3.1`. **Blocked on**
[self-contained-runtime-tools](self-contained-runtime-tools.md) Task 4 — signing
and notarization — which is a prerequisite, not part of this plan.

> **For agentic workers:** Phase 0 is an owner decision with an annual cost
> attached. Phase 1 is a gate: if a notarized build does not open on a clean Mac
> without approval, everything after it is unreachable and the plan stops there.
> Do not attempt Phases 2–5 against an unsigned build; electron-updater will
> refuse the download and the failure will look like a bug in this plan's code.

## Why

The app tells the Editor about updates and then leaves them to it. Today:

> Version 0.3.1 is available — you have 0.3.0. **See what's new** · **Not now**
> — `UpdateBanner.tsx:44`

> Updates are installed manually: the download is not signed yet, so macOS has to
> be told to trust it once. Use `scripts/app-wizard.sh update` to install one.
> — `UpdateSection.tsx:52`

So every release costs the Editor a browser download, a Gatekeeper refusal, a
trip to System Settings › Privacy & Security to approve the app, and a drag into
Applications. The owner pays that toll on their own machine every time.

**The Gatekeeper prompt and the missing auto-update are the same problem.** The
DMG is unsigned and un-notarized, which is why macOS asks for approval — and it
is also why no updater can install anything. Electron states it twice, without
hedging:

> `autoUpdater` — `Squirrel.Mac` requires the app to be signed for automatic
> updates to work at all.
> — [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)

> Your application must be signed for automatic updates on macOS. This is a
> requirement of `Squirrel.Mac`.
> — [autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater)

electron-updater installs through Squirrel.Mac, so the requirement is the same
whichever updater this project ends up using. Fixing the signature fixes the
prompt and unblocks the installer together. `docs/UPDATING.md` already says this
is the intended successor to the notice.

### What the build produces today

- `frontend/package.json` `build.mac` targets `dmg` only, with no
  `hardenedRuntime`, no entitlements and no notarize hook.
- `.github/workflows/build-dmg.yml` packages with `--publish never` and attaches
  the DMGs with `softprops/action-gh-release`. Its `CSC_LINK` comment says
  signing "can be added later".
- `updateCheck.ts` owns the states `unknown`, `up-to-date`, `dismissed` and
  `update-available`, caches for six hours, and never errors at the user. That
  behaviour is worth keeping; this plan extends it rather than replacing it.

### The hazard specific to this app

The bundle nests binaries that are not Electron's: the PyInstaller backend
(`extraResources` ← `backend/dist/ai-clip-backend`) and the staged FFmpeg runtime
tools (`extraResources` ← `build/runtime-tools`). **Every nested Mach-O has to be
signed with the hardened runtime or notarization rejects the bundle**, and
Python-derived executables usually need entitlements to run under it. A signing
attempt that ignores them fails late, after a long build, with an error that
points at the wrong thing. Budget for this before Phase 1 is called green.

## What it costs

Checked 2026-09-11 against Apple's enrollment page; re-check at Phase 0, because
this plan's whole premise is a recurring bill.

| | Cost |
|---|---|
| Apple Developer Program | **99 USD per membership year**, billed in local currency at enrollment. Waivers exist for nonprofits, accredited education and government — none apply here. VAT treatment for an EU individual is not stated on the enrollment page; confirm it at purchase rather than assume. |
| One-time setup | The certificate, CI secrets, hardened runtime and notarization wiring. Straightforward on a plain Electron app; this is not one — see the nested-binary hazard above. Assume the entitlements work for the Python backend and the FFmpeg tools is its own session, not a footnote. |
| Per release | An Apple notarization round-trip per architecture, on top of a build that already takes about 22 minutes. Usually minutes; Apple's service occasionally takes far longer, and when it is degraded a release cannot ship at all. The release path gains a dependency this project does not control. |
| Ongoing | Certificate and membership renewal. A lapsed membership stops new notarizations; builds already notarized and stapled are unaffected. Verify that at Phase 0 before relying on it. |
| Not doing it | Every update, for every user including the owner: browser download, Gatekeeper refusal, a trip through System Settings › Privacy & Security, and a drag into Applications. Plus the credibility cost of shipping an app macOS says it cannot verify. |

The middle option in Phase 0 is worth weighing on these numbers: signing and
notarizing **without** auto-update pays the same 99 USD and the same per-release
notarization wait, skips Phases 2–5 entirely, and still removes the Privacy &
Security prompt. Most of the user-visible benefit for a fraction of the work.

## Phase 0 — Decide whether to buy in (owner)

- [ ] **Step 0.1** Decide, and record the reason here:
      - *Sign + notarize + auto-update* — 99 USD a year, a certificate to store
        as a CI secret, and a longer, more fragile release. Buys a normal
        desktop-app install and update.
      - *Sign + notarize only* — same 99 USD, kills the Privacy & Security
        prompt, keeps `app-wizard.sh` as the installer. Most of the benefit,
        none of Phases 2–5.
      - *Neither* — keep today's behaviour and stop maintaining this plan.
      Note that [going-public-codex-flow](going-public-codex-flow.md) already
      assumes a signed build in its phase-1 trust work, so this decision is not
      only about convenience.

## Phase 1 — Gate: a build macOS opens without being asked twice

- [ ] **Step 1.1** Developer ID Application certificate in CI as `CSC_LINK` /
      `CSC_KEY_PASSWORD`; hardened runtime enabled; entitlements for the nested
      Python and FFmpeg binaries.
- [ ] **Step 1.2** Notarize and staple in `build-dmg.yml`, both arches.
- [ ] **Step 1.3** Verify on a Mac that has never seen the app: `spctl -a -vv`
      and `stapler validate` pass, and a double-click opens it with no Privacy &
      Security detour. **If this step fails, stop — the rest of the plan is
      unreachable.** This is the same clean-machine evidence
      [self-contained-runtime-tools](self-contained-runtime-tools.md) Task 4 asks
      for; do it once and cite it in both plans.

## Phase 2 — Publish an update feed, not just installers

- [ ] **Step 2.1** Add `zip` back to the mac targets. electron-builder's default
      is `dmg` + `zip` precisely because Squirrel.Mac needs the zip and
      `latest-mac.yml` cannot be generated without it — and
      `frontend/package.json` explicitly narrows `build.mac.target` to `"dmg"`,
      which overrides that default. **The current config would break auto-update
      even after signing**, and the failure surfaces as a missing feed rather
      than as a target problem. The DMG stays for first-time human downloads.
- [ ] **Step 2.2** Publish `latest-mac.yml` and the zips to the same release as
      the DMGs. Two concrete blockers in `build-dmg.yml` today: it packages with
      `--publish never`, and its release step uploads `frontend/dist/*.dmg`, a
      glob that excludes both the zip and the feed. Verify the two architectures
      do not overwrite each other's feed — they run as independent matrix jobs
      that each publish.
- [ ] **Step 2.3** Fetch the feed from a machine and confirm it names the version,
      the files and their hashes.

## Phase 3 — Download and install from inside the app

- [ ] **Step 3.1** Adopt electron-updater in the main process for download and
      install. Note for whoever picks this up: Electron's own docs route people
      to Electron Forge and its `@electron/osx-sign` / `@electron/notarize`
      packages, while this project packages with electron-builder, which carries
      its own signing and notarization support. Staying on electron-builder is
      the assumption here — record it as a decision rather than rediscovering the
      question mid-implementation. Keep one checker, not two: `updateCheck.ts` already owns the check,
      the six-hour cache and per-version dismissal, so route the updater through
      it rather than letting both poll.
- [ ] **Step 3.2** Surface progress as state the renderer can render — downloading
      with a percentage, ready-to-install, failed with a reason.
- [ ] **Step 3.3** Install on explicit consent only, via `quitAndInstall`.

## Phase 4 — The Editor stays in control

- [ ] **Step 4.1** Banner and General panel gain the new states; "Restart to
      install" is a deliberate click, never an ambush.
- [ ] **Step 4.2** Refuse to install while analysis or export is running — those
      are long jobs and a restart throws the work away. Offer to install after.
- [ ] **Step 4.3** Any failure falls back to the browser download and the wizard,
      with the reason shown. The Editor must never be left with a broken app and
      no route forward.

## Phase 5 — Prove it upgrades, then tell the truth about it

- [ ] **Step 5.1** Real upgrade test on both arches: install N-1, let the app find
      N, download, restart, confirm the new version reports itself and the backend
      still starts.
- [ ] **Step 5.2** Test the ugly paths: no network mid-download, a corrupted
      download, and a refused install.
- [ ] **Step 5.3** Rewrite `docs/UPDATING.md` — the paragraph that says the notice
      "does not download or install anything" — and `UpdateSection.tsx:52`.
      Keep `app-wizard.sh` working and documented as the manual path.
- [ ] **Step 5.4** Full gates: backend, ruff, lint, typecheck, `test:main`,
      Playwright.

## How this gets verified

No part of this plan can be called done from a green CI run — every claim here is
about what a Mac does with a downloaded artifact, which CI never exercises. Record
each pass in this table; an unrecorded pass did not happen.

| Check | How | Where |
|---|---|---|
| The bundle is signed, hardened and notarized | `codesign -dvvv --entitlements -`, `spctl -a -vv`, `stapler validate` on the packaged app | Phase 1 |
| Nested binaries are signed too | `codesign -vvv --deep --strict` over the bundle, and confirm the backend and FFmpeg tools are covered rather than skipped | Phase 1 |
| A clean Mac opens it without approval | A Mac (or a fresh user account) that has never seen the app: double-click, no Privacy & Security detour | Phase 1 |
| The app still works after signing | Import → Analyse → Export on real footage, because the hardened runtime is exactly what breaks a spawned Python backend | Phase 1 |
| The feed is publishable and correct | Fetch `latest-mac.yml` from the release; it names the version, the files and their hashes, and the two architectures have not overwritten each other | Phase 2 |
| An upgrade actually happens | Install N-1, let it find N, download, restart, confirm the reported version changed and the backend starts | Phase 5, both arches |
| Failure is survivable | Kill the network mid-download; corrupt the download; refuse the install — the app keeps working and says why | Phase 5 |
| Nothing is interrupted | Start an analysis and an export, then attempt an update — it must decline and offer to install after | Phase 5 |

| Date | Version | Mac | Check | Result |
|---|---|---|---|---|
| — | — | — | — | Not run |

## Done criteria

- [ ] A Mac that has never seen the app opens it with no Privacy & Security
      approval, and `spctl`/`stapler` say why.
- [ ] An Editor on N-1 reaches N without a browser, a DMG or a drag: notice →
      download with visible progress → restart → new version running.
- [ ] No update ever interrupts a running analysis or export.
- [ ] A failed or interrupted update leaves a working app and a stated reason.
- [ ] `docs/UPDATING.md` and the Settings copy describe what the app does, not
      what it used to do.

## Sources

- [Electron — Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing) — signing is required for automatic updates at all, and the two-step sign-then-notarize shape.
- [Electron — autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater) — the same requirement stated against the API, and a pointer to Squirrel.Mac's server support for feed shape.
- [electron-builder — Auto Update](https://www.electron.build/docs/features/auto-update/) and [macOS targets](https://www.electron.build/docs/mac/) — the mac default is `dmg` + `zip`; disabling `zip` breaks auto-update in the DMG build because `latest-mac.yml` cannot be generated.
- [Apple Developer Program enrollment](https://developer.apple.com/programs/enroll/) — 99 USD per membership year, local currency at enrollment, waivers for nonprofit/education/government only. Checked 2026-09-11.
