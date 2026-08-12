# Plan 023: Correct macOS app icon geometry

Status: TODO · Priority P1 · Effort M · Risk LOW · Category release polish
Depends on the existing Electron packaging pipeline · Planned 2026-08-12

## Goal

Make the packaged AI Clip Assembler icon occupy the same apparent Dock size as
correctly templated macOS icons, while keeping the brand artwork unchanged for
the renderer, favicon, website, and other non-Dock uses.

## Research conclusion

Apple’s current [App icons Human Interface Guideline](https://developer.apple.com/design/human-interface-guidelines/app-icons/)
defines Mac icons as 1024×1024 square layers whose final shape is a system
masked rounded rectangle. The current Apple production grid used for the
classic flattened macOS/ICNS route is:

- Canvas: 1024×1024 px.
- Icon body: 824×824 px, placed at `(100, 100)`.
- Padding: 100 px on every side; the body bounds are `[100, 924)` in both
  axes, or an 80.47% fill.
- Corner: the body uses Apple’s continuous-corner/squircle mask, approximately
  185.4 px in body coordinates (not four ordinary circular arcs). The outer
  canvas therefore begins the visible top straight section at approximately
  `100 + 185.4 = 285.4` px.

The numeric grid comes from Apple’s [Design Resources](https://developer.apple.com/design/resources/)
production/template geometry; Apple’s current written HIG points implementers
to those grids rather than listing these pixel constants in prose. Apple’s
WWDC25 explanation also says the 1024 px canvas remains and that the updated
grid has a rounder corner radius.

The existing `frontend/build/icon.png` has a non-transparent alpha bounding box
of `(0, 0, 1024, 1024)`. At a solid-alpha threshold its top edge starts about
175 px from the left edge. If that already-rounded 1024 px artwork is merely
scaled to 824 px, its baked corner becomes about `175 × 824 / 1024 = 141` px.
That is visibly less round than the approximately 185.4 px target. The
implementation must therefore resize the artwork to 824×824 and then apply
the target continuous-corner alpha mask; simply adding transparent padding is
not sufficient. The mask intersects the existing baked rounded corners, so it
does not invent new artwork or distort the scissors/film composition.

## Asset responsibility map

| Asset or consumer | Current use | Plan |
|---|---|---|
| `assets/icon.png` | 1024×1024 edge-to-edge brand source; copied by `frontend/scripts/stage-assets.mjs` | Leave unchanged. Use as the input to the generator. It must not be replaced with the Dock-padded derivative. |
| `frontend/build/icon.png` | Generated staging asset; both `frontend/package.json:104` and `:108` point electron-builder here; dev `BrowserWindow`/Dock code resolves this filename | Generate a 1024×1024 RGBA derivative with the 824 px centered body and target mask after every asset staging run. This directory is ignored/generated. |
| `frontend/out/renderer/build/icon.png` | Generated renderer staging copy | Generate the same padded derivative so staging outputs do not disagree, even though the renderer currently uses `os-mark.png` for its favicon. |
| `frontend/build/logo.png` / `assets/logo.png` | Sidebar brand image; `Sidebar.tsx` renders `./build/logo.png` at 32×32 | Leave unchanged. Its existing transparent bounds are already appropriate for an in-app logo, and Dock padding would make it unnecessarily small. |
| `frontend/src/renderer/index.html` / `frontend/build/os-mark.png` | App UI favicon | Leave unchanged. This is a small interface mark, not the Dock icon. |
| `site/img/icon.png` | Website favicon and the 94×94 hero brand image in `site/index.html`; currently 256×256 edge-to-edge | Leave unchanged. Browser favicons and an explicitly sized website image should not inherit Dock padding. |
| `site/img/social-card.png` | `og:image` and `twitter:image` | Leave unchanged; it is already a separate social composition. |
| `frontend/dist/.icon-icns/icon.icns` and the app bundle’s `Contents/Resources/icon.icns` | electron-builder outputs | Never hand-edit or commit them. Regenerate them from the staged PNG and inspect them only as verification artifacts. |

## Execution steps

### 1. Add a reproducible macOS-icon generator and make staging call it

**Files:**

- Create: `scripts/generate_macos_icon.py`
- Modify: `frontend/scripts/stage-assets.mjs`

- [ ] **Step 1: Define the generator CLI.** Make the Python script accept
  explicit `--source` and `--output` paths and an explicit `--check` path. Open
  images as RGBA and fail non-zero unless the source is square and 1024×1024.

- [ ] **Step 2: Resize the artwork to the body size.** Resize the source to
  exactly `(824, 824)` with `Image.Resampling.LANCZOS`. Do not use a crop,
  stretch, nearest-neighbour resize, or an opaque background fill.

- [ ] **Step 3: Build the continuous-corner mask.** Build the 824×824 Apple
  continuous-corner mask from the checked-in path constants for the current
  Apple production grid: body size 824, body-radius 185.4, and a 100 px
  placement offset. Rasterize the mask at 4× or 8× and reduce it with Lanczos so
  the edge is clean at 1024 px. Do not substitute
  `ImageDraw.rounded_rectangle`, whose circular arcs are not the target
  continuous-squircle shape.

- [ ] **Step 4: Composite onto the padded canvas.** Combine the resized image
  alpha with that mask using the per-pixel minimum, paste it at `(100, 100)` on
  a transparent 1024×1024 RGBA canvas, and save a PNG with alpha preserved. The
  source RGB content must remain unchanged apart from Lanczos resampling and the
  required mask intersection.

- [ ] **Step 5: Implement `--check` mode.** Assert all of the following and fail
  with a useful message: the image is RGBA, dimensions are 1024×1024, the
  non-zero-alpha bounding box is exactly `(100, 100, 924, 924)`, and every pixel
  outside that box is fully transparent. The mask builder itself must compare
  its generated mask with horizontal and vertical flips and fail if either
  differs; do not require the final composited artwork to be pixel-symmetric,
  because the scissors and film artwork is not symmetric.

- [ ] **Step 6: Wire the generator into asset staging.** Keep the current copy
  behavior in `stage-assets.mjs`, then invoke the generator after copying
  `assets/*` into each target. Invoke `backend/.venv/bin/python` with the
  repository script for both `frontend/build/icon.png` and
  `frontend/out/renderer/build/icon.png`. Propagate a missing virtualenv,
  generator failure, or output validation failure instead of silently copying
  the edge-to-edge source.

**Acceptance criteria:**

- `npm run stage:assets` produces both padded outputs without changing
  `assets/icon.png`, `assets/logo.png`, or `assets/os-mark.png`.
- The generator records the 824/100/185.4 geometry in executable constants,
  uses Lanczos for artwork and mask reduction, and preserves transparency.
- A fresh staging run cannot restore an edge-to-edge `frontend/build/icon.png`.

### 2. Add the proportionate regression guard to existing CI

**Files:**

- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Add the CI check.** Add a step after the backend virtualenv and
  frontend dependency setup that runs the real staging path and the generator
  check:

  ```yaml
  - name: Verify macOS app icon geometry
    working-directory: frontend
    run: |
      npm run stage:assets
      ../backend/.venv/bin/python ../scripts/generate_macos_icon.py --check build/icon.png
  ```

- [ ] **Step 2: Keep the guard proportionate.** Do not add a visual screenshot
  test or assert that `assets/icon.png` itself is padded; that would encode the
  wrong contract for the source and website assets. The staging check is cheap,
  deterministic, and exercises the same path used by `npm run build`, so a
  future edge-to-edge packaging icon fails before merge.

**Acceptance criteria:**

- CI fails if the generated packaging icon is not 1024×1024 with a centered
  824×824 non-transparent body.
- CI continues to permit the intentionally edge-to-edge source and site icon.

### 3. Rebuild the Electron app and verify the generated ICNS

**Files/artifacts:**

- Generated only: `frontend/build/icon.png`, `frontend/out/renderer/build/icon.png`
- Generated only: `frontend/dist/.icon-icns/icon.icns`
- Generated only: `frontend/dist/mac-arm64/AI Clip Assembler.app/Contents/Resources/icon.icns`
  and the corresponding x64 app output when built

- [ ] **Step 1: Run the release-like build.** Do not modify
  `frontend/package.json`: both existing electron-builder paths must continue to
  point at the generated `build/icon.png`. From the repository root:

  ```bash
  rm -rf frontend/dist
  cd frontend
  npm run build:backend
  npm run build
  npx electron-builder --mac dmg --publish never
  cd ..
  backend/.venv/bin/python scripts/generate_macos_icon.py --check frontend/build/icon.png
  test -f frontend/dist/.icon-icns/icon.icns
  test -f 'frontend/dist/mac-arm64/AI Clip Assembler.app/Contents/Resources/icon.icns'
  ```

  `npm run build` runs asset staging, so it must be run after the generator is
  wired in. electron-builder then reads `build/icon.png` and regenerates its
  standard ICNS representations; it is not necessary to create an `.icns` by
  hand. If an installed app still shows the old image, first confirm the fresh
  app bundle’s `Contents/Resources/icon.icns` timestamp and contents rather than
  debugging the Dock cache.

- [ ] **Step 2: Verify the ICNS itself.** Extract the iconset into a temporary
  directory and run the same alpha check against the largest 1024 px frame:

  ```bash
  iconset_dir="$(mktemp -d)"
  iconutil --convert iconset --output "${iconset_dir}/icon.iconset" \
    frontend/dist/.icon-icns/icon.icns
  backend/.venv/bin/python scripts/generate_macos_icon.py --check \
    "${iconset_dir}/icon.iconset/icon_512x512@2x.png"
  ```

**Acceptance criteria:**

- electron-builder exits 0 and creates a fresh ICNS plus app-bundle ICNS.
- The largest extracted ICNS frame passes the same `(100, 100, 924, 924)`
  alpha-bounds check; no stale edge-to-edge frame remains.
- `frontend/package.json` still references `build/icon.png`, and no generated
  artifact is treated as a source file.

### 4. Perform human Dock verification and clear only stale presentation state

**Files:** None; this is manual QA against the generated app.

- [ ] **Step 1: Launch the freshly built bundle.** Quit any running AI Clip
  Assembler instance and remove the old Dock tile if it is pinned. Open the
  freshly built app bundle from `frontend/dist/mac-arm64/AI Clip Assembler.app`
  (and repeat for x64 if available).

- [ ] **Step 2: Compare side-by-side in the Dock.** Compare the icon with
  adjacent correctly templated apps at the same Dock magnification. Confirm that
  its apparent width is no longer about 24% larger, the body is centered, and
  the artwork has no clipping, halo, or opaque square corners.

- [ ] **Step 3: Refresh the Dock only if it is stale.** If the Dock still shows
  the previous icon after replacing the app, restart the Dock and re-add the
  tile:

  ```bash
  killall Dock
  ```

  Do not clear broad system caches or change the bundle identifier for this fix.
  The generated `dist` artifacts must be rebuilt first; a Dock restart is only a
  last-mile cache refresh.

**Acceptance criteria:**

- A human confirms the new icon has the same apparent Dock size as its
  neighbors on the target macOS version.
- The measurable PNG/ICNS checks and the visual check agree; neither one is
  replaced by the other.

### 5. Record the macOS 26/Tahoe direction without blocking this fix

**Files:** No additional implementation files in this plan.

- [ ] **Step 1: Record the current Apple direction.** Apple’s
  [Icon Composer guidance](https://developer.apple.com/documentation/Xcode/creating-your-app-icon-using-icon-composer)
  and [Icon Composer tool page](https://developer.apple.com/icon-composer/) now
  recommend a multilayer `.icon` asset for Mac, with system-applied masks and
  Liquid Glass variants. Current electron-builder documentation also accepts a
  `.icon` asset and compiles it with Xcode tooling, while retaining `.icns` for
  legacy builds and DMG volume-icon use.

- [ ] **Step 2: Ship the padded PNG → ICNS correction first.** It fixes the
  reported Dock-size bug in the existing Electron pipeline, works with the
  repository’s current macOS 15 CI runners and existing flattened artwork, and
  does not require redesigning the logo into layers.

- [ ] **Step 3: File the `.icon` migration as a separate follow-up.** Split the
  artwork into meaningful layers, remove the baked mask from those layers,
  preview Default/Dark/Mono and Tahoe rendering in Icon Composer, configure
  electron-builder’s `mac.icon`, and keep the padded ICNS fallback for older
  macOS and any DMG path that still needs it. Do not mix that format migration
  into this geometry fix.

**Acceptance criteria:**

- This plan has one clear release path for the current app: padded PNG →
  electron-builder-generated ICNS.
- The `.icon`/Liquid Glass migration is explicitly deferred as a separate,
  layered-artwork design and compatibility task, not silently implied by the
  PNG fix.

## Verification and done criteria

The implementation is ready for review only when all of these are true:

- [ ] `npm run stage:assets` deterministically regenerates both staged icon
  copies and the generator check reports `(100, 100, 924, 924)`.
- [ ] `npm run build:backend`, `npm run build`, and
  `npx electron-builder --mac dmg --publish never` complete successfully.
- [ ] The fresh `.icns` and app-bundle resource pass the extracted-frame check.
- [ ] `assets/icon.png`, `site/img/icon.png`, `frontend/build/logo.png`,
  `frontend/build/os-mark.png`, `site/index.html`, the Sidebar reference, and
  the existing electron-builder paths retain their intended roles.
- [ ] A human verifies the Dock side-by-side after restarting the Dock only if
  the cache was stale.

## Research sources

- [Apple HIG — App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons/)
- [Apple Design Resources](https://developer.apple.com/design/resources/)
- [Apple WWDC25 — Say hello to the new look of app icons](https://developer.apple.com/videos/play/wwdc2025/220/)
- [Apple — Creating your app icon using Icon Composer](https://developer.apple.com/documentation/Xcode/creating-your-app-icon-using-icon-composer)
- [electron-builder — macOS configuration](https://www.electron.build/mac/)
- [electron-builder — Icons & Images](https://www.electron.build/docs/features/icons-and-images/)
