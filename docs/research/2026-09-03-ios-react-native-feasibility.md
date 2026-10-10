# Does AI Clip Assembler have potential as an iPhone app built with React Native?

**Date:** 2026-09-03
**Status:** archived 2026-09-03. The companion-client direction was declined by the author; kept for reference only. The Python-on-iOS, FFmpeg licensing, and RN video-tooling findings remain relevant to any future phone-native build.

## Question

AI Clip Assembler is a local-first macOS app: Electron + React 19 + Tailwind 4 +
react-router-dom in the renderer, and a PyInstaller-packaged Python FastAPI
backend on `127.0.0.1` that does all analysis (FFmpeg frame extraction and
`vidstabdetect`, OpenCV blur/brightness/contrast, PySceneDetect, onnxruntime
SigLIP embeddings for Look Groups), owns the Timeline Document, serves MCP at
`/mcp` and SSE at `/projects/{id}/events`, and exports FCPXML / EDL / Resolve
XML (see `docs/ARCHITECTURE.md`). Could this become an iPhone app built with
React Native, and what would that realistically take?

## Verdict

A **full port with on-device analysis is not a port; it is a rewrite of the
backend in Swift**. CPython does officially run on iOS (tier 3 since 3.13), but
only in embedded mode with no `subprocess`, so the FastAPI-behind-uvicorn
process model and every `ffmpeg` shell-out are dead on arrival; `opencv-python`
and `onnxruntime` ship no iOS wheels and BeeWare's wheel-building effort is
semi-retired; FFmpeg with `vidstabdetect` forces `--enable-gpl`, which is
incompatible with App Store distribution of a closed binary; and the main
React Native FFmpeg wrapper (ffmpeg-kit) was archived in July 2026 with its npm
package marked unsupported. Apple's own stack (AVFoundation, Vision, Core ML,
or onnxruntime-react-native with a Core ML EP) can replace each pipeline stage,
but only as new native code behind Expo/Turbo modules, and long analysis jobs
cannot run unattended in the background. The React UI code has limited reuse
value on RN (DOM/Tailwind 4/react-router are not portable; NativeWind's Tailwind
v4 support is still pre-release), and neither Final Cut Pro for iPad (no
FCPXML import documented) nor DaVinci Resolve for iPad (does list FCPXML/XML
import) make iOS a natural export destination for a drone-footage triage tool.
The realistic near-term option is **B: an iPhone companion client** that talks
to the existing Mac backend over LAN (HTTP + SSE + MCP already exist), gated by
Apple's local-network privacy requirements. Option A is a multi-quarter
greenfield native project; option C (react-native-web wrapper) is not viable
because react-native-web runs RN code on the web, not the reverse.

---

## 1. Running the Python backend on iOS

### App Store Review Guideline 2.5.2

- Guideline 2.5.2 (verbatim): "Apps should be self-contained in their bundles,
  and may not read or write data outside the designated container area, nor may
  they download, install, or execute code which introduces or changes features
  or functionality of the app, including other apps."
  https://developer.apple.com/app-store/review/guidelines/
- Bundling an interpreter is therefore tolerated only when all code ships in
  the bundle; the app cannot fetch new Python at runtime. CPython's own iOS docs
  ship an `app-store-compliance.patch` that "removes code violating App Store
  review rules" and note that as of April 2025 binary modules using affected
  libraries (e.g. OpenSSL) must include `.xcprivacy` privacy manifests.
  https://docs.python.org/3/using/ios.html

### CPython on iOS (PEP 730)

- PEP 730 is Final; iOS is a PEP 11 tier-3 platform since Python 3.13
  (`arm64-apple-ios`, `arm64-apple-ios-simulator`).
  https://peps.python.org/pep-0730/ ,
  https://docs.python.org/3/whatsnew/3.13.html
- Embedded mode only: "There is no Python REPL, and no ability to use separate
  executables such as python or pip." `subprocess` is not importable;
  `os.fork()`, `os.execve()`, `os.waitpid()`, `os.kill()` are unavailable;
  "Attempting to create a subprocess will cause the process to either lock up
  or crash." Mobile apps also have no usable `stdin`.
  https://docs.python.org/3/library/intro.html
- Binary extension modules (`.so`) must each be repackaged as an individual
  dynamic framework under `Frameworks/`, with `.fwork` marker files and an
  `AppleFrameworkLoader`. Platform wheel tags look like
  `ios_12_0_arm64_iphoneos`. https://docs.python.org/3/using/ios.html ,
  https://peps.python.org/pep-0730/

**Consequence for this codebase:** `uvicorn`-hosted FastAPI as a separate
process (spawned by Electron main today) cannot exist; the interpreter would
have to be embedded in the app process and the ASGI server run in-process on a
thread. Every `ffmpeg`/`ffprobe` shell-out (`ffmpeg-python`, PySceneDetect's
ffmpeg/mkvmerge splitting) breaks because `subprocess` does not exist.

### Briefcase (BeeWare) and iOS wheels

- Briefcase generates an Xcode project; pure-Python packages work, but binary
  packages "require iOS-compatible wheels" (e.g. `-cp314-cp314-ios_15_4_arm64_iphoneos.whl`),
  "most projects don't yet provide these", Briefcase "cannot install packages
  published as source tarballs into an iOS app", and BeeWare keeps a secondary
  wheel index at anaconda.org/beeware/repo.
  https://briefcase.beeware.org/en/stable/reference/platforms/iOS/xcode.html
- BeeWare's `mobile-forge` wheel-building project declares itself
  "semi-retired" as of August 2025 with "no plans to add Python 3.14+ support
  for any of the recipes, to bump any of the versions currently being packaged,
  or to add any new recipes." https://github.com/beeware/mobile-forge

### Do our binary dependencies have iOS wheels?

| Package (pinned in `backend/requirements.txt`) | iOS wheel? | Source |
| --- | --- | --- |
| `opencv-python` | No. Wheels only for win32/win_amd64, macosx arm64/x86_64, manylinux (latest 5.0.0.93). | https://pypi.org/project/opencv-python/#files |
| `onnxruntime` (Python) | No Python iOS package; iOS is served via CocoaPods `onnxruntime-c` / `onnxruntime-objc`. | https://onnxruntime.ai/docs/install/ |
| `scenedetect` | Python detection code (BSD-3) but depends on OpenCV and shells out to ffmpeg/mkvmerge for splitting. | https://github.com/Breakthrough/PySceneDetect |
| `numpy`, `pillow`, `pydantic` | Not verified here; would still need per-module framework repackaging. | https://docs.python.org/3/using/ios.html |

### FFmpeg embedding and licensing

- FFmpeg is LGPL 2.1+ by default; when "--enable-gpl" components are used "the
  GPL applies to all of FFmpeg". Compliance guidance: compile without GPL and
  nonfree options, link dynamically, ship matching source.
  https://ffmpeg.org/legal.html
- `libvidstab` is in FFmpeg's `EXTERNAL_LIBRARY_GPL_LIST`, so
  `--enable-libvidstab` requires `--enable-gpl`.
  https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/configure
- vid.stab itself is now LGPL-2.1-or-later (GPL up to v1.1.2), but its README
  confirms "ffmpeg's configure still gates --enable-libvidstab behind
  --enable-gpl". https://github.com/georgmartius/vid.stab
- Practical reading: an iOS build of FFmpeg that keeps `vidstabdetect` is a
  GPL FFmpeg. iOS apps are statically linked into a single signed bundle, which
  conflicts with the LGPL "dynamic linking" guidance and makes GPL distribution
  through the App Store legally fraught. Motion analysis would need to move to
  a non-GPL implementation (OpenCV optical flow, Vision
  `VNGenerateOpticalFlowRequest`, or Core Motion metadata).

### Conclusion for topic 1

The FastAPI backend cannot be "ported" in the sense of shipping the same
Python. Realistic outcome: the domain logic that is pure Python (timeline
operations core, scoring/weighting, assembly, FCPXML/EDL/Resolve XML writers,
Pydantic models) could theoretically run embedded, but every I/O stage
(frame extraction, vidstab, OpenCV metrics, scene detection, SigLIP inference)
must be rewritten against native iOS frameworks. At that point the remaining
Python is thin enough that a Swift rewrite is the simpler engineering choice.

---

## 2. React Native video processing on iOS

### ffmpeg-kit (retired)

- `arthenica/ffmpeg-kit` README "Update (July 2026)": "FFmpegKit has been
  officially retired"; "Development of FFmpegKit continues with FFmpegKitNext,
  maintained by its original author" (source-only). The GitHub API reports
  `archived: true`, `pushed_at: 2026-07-02`.
  https://github.com/arthenica/ffmpeg-kit ,
  https://api.github.com/repos/arthenica/ffmpeg-kit
- The React Native sub-package README documents `full-gpl` bundling vid.stab,
  x264, x265, xvidcore (GPL). https://github.com/arthenica/ffmpeg-kit/tree/main/react-native
- npm `ffmpeg-kit-react-native`: latest 6.0.2 (published 2023-09-18), marked
  deprecated: "Package no longer supported."
  https://registry.npmjs.org/ffmpeg-kit-react-native
- Issue #1099 describes Maven artifacts for 4.x/5.x removed and points RN
  users to vendoring 6.x binaries locally or building from a fork.
  https://github.com/arthenica/ffmpeg-kit/issues/1099
- FFmpegKitNext is referenced but no canonical repo URL was found via search
  (open question).

### Expo / RN playback libraries (playback, not analysis)

- `expo-video` (SDK 57): playback (progressive, HLS, DASH), PiP, and
  `generateThumbnailsAsync()` for stills at timestamps; no frame-level
  processing or transcoding. https://docs.expo.dev/versions/latest/sdk/video/
- `expo-av` is deprecated, "not receiving patches and will be removed in SDK
  55". https://docs.expo.dev/versions/latest/sdk/av/
- `react-native-video` v6 (v7 beta): playback, subtitles, DRM; no frame
  extraction documented. https://docs.thewidlarzgroup.com/react-native-video/
- `react-native-vision-camera` frame processors ("Frame Outputs" in v5+) run
  worklets on live camera frames only; not applicable to existing files.
  https://visioncamera.margelo.com/docs/guides/frame-processors

### Native building blocks reachable from RN

- `AVAssetReader` (iOS 4.1+): "An object that reads media data from an asset"
  -> decoded frames for blur/brightness/contrast/scene-cut metrics.
  https://developer.apple.com/documentation/avfoundation/avassetreader
- `AVAssetImageGenerator` (iOS 4.0+): "generates images from a video asset"
  -> Frame Samples. https://developer.apple.com/documentation/avfoundation/avassetimagegenerator
- Vision: `VNGenerateImageFeaturePrintRequest` (iOS 13+, image similarity ->
  Look Groups), `VNGenerateOpticalFlowRequest` (iOS 14+, per-pixel motion ->
  smoothness), `VNDetectHorizonRequest` (iOS 11+), and
  `VNCalculateImageAestheticsScoresRequest` (iOS 18+, "analyzes an image for
  aesthetically pleasing attributes" -> Visual Interest proxy).
  https://developer.apple.com/documentation/vision/vngenerateimagefeatureprintrequest ,
  https://developer.apple.com/documentation/vision/vngenerateopticalflowrequest ,
  https://developer.apple.com/documentation/vision/vndetecthorizonrequest ,
  https://developer.apple.com/documentation/vision/vncalculateimageaestheticsscoresrequest
- Core ML: on-device inference on CPU/GPU/Neural Engine; models from other
  libraries converted with Core ML Tools (route for SigLIP).
  https://developer.apple.com/documentation/coreml
- `onnxruntime-react-native`: Android and iOS, ONNX and ORT formats; the
  CoreML EP page documents iOS 13+ / MLProgram on iOS 15+ but does not
  document RN-specific usage. https://raw.githubusercontent.com/microsoft/onnxruntime/main/js/react_native/README.md ,
  https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html
- Bridging: Expo Modules API (Swift/Kotlin, JSI-based, "similar performance
  characteristics to React Native's Turbo Modules API"; pick Turbo Modules if
  C++ is required). https://docs.expo.dev/modules/overview/ ,
  https://reactnative.dev/docs/turbo-native-modules-introduction

### Background execution limits

- `BGProcessingTask`: "A time-consuming processing task that runs while the
  app is in the background"; runs only when the device is idle, can run for
  minutes, and "the system terminates any background processing tasks running
  when the user starts using the device". Requires the `processing`
  UIBackgroundModes capability.
  https://developer.apple.com/documentation/backgroundtasks/bgprocessingtask
- Foreground-to-background continuation via `beginBackgroundTask`: duration is
  whatever `backgroundTimeRemaining` reports; "If you don't end your tasks in
  a timely manner, the system terminates your app."
  https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time
- Consequence: a multi-gigabyte drone-footage analysis must be designed as
  resumable, chunked work that runs mainly while the app is in the foreground,
  a very different UX from the Mac backend's fire-and-forget jobs.

---

## 3. Reuse of the existing React code

- react-native-web "uses React DOM to accurately render React Native
  compatible JavaScript code in a web browser": it runs RN code on the web,
  not DOM code on native. Our renderer (DOM, `<video>`, CSS) cannot be wrapped
  into an iOS app with it. https://necolas.github.io/react-native-web/docs/
- Tailwind 4: NativeWind's stable line (v4) targets Tailwind v3; Tailwind v4
  support is in NativeWind v5, which its docs label "a pre-release version...
  not intended for production use". https://www.nativewind.dev/ ,
  https://www.nativewind.dev/v5/getting-started/installation ,
  https://github.com/nativewind/nativewind/issues/1354
- Routing: Expo Router is "a file-based router for React Native and web
  applications" built on React Native Screens; react-router-dom route
  definitions would be re-expressed as files under `app/`.
  https://docs.expo.dev/router/introduction/
- React 19 is supported: Expo SDK 57 (2026-06-30) ships React Native 0.86 and
  React 19.2.3; SDK 56 -> RN 0.85 / React 19.2.3; SDK 55 -> RN 0.83 / 19.2.0.
  https://docs.expo.dev/versions/latest/ , https://expo.dev/changelog/sdk-57
- React Native 0.87.0 peer-depends on `react ^19.2.3`; 0.87.1 published
  2026-08-26. RN 0.82 (Oct 2025) was the first release running entirely on the
  New Architecture; 0.84 removed Legacy Architecture components.
  https://raw.githubusercontent.com/facebook/react-native/v0.87.0/packages/react-native/package.json ,
  https://api.github.com/repos/facebook/react-native/releases/latest ,
  https://reactnative.dev/blog
- What is reusable: TypeScript types generated from Pydantic
  (`gen:types`), HTTP client logic against the Timeline API, pure state /
  reducer code, and domain vocabulary. Components, Tailwind classes, the custom
  timeline (DOM/CSS), the `<video>`-driven sequence player, and Electron IPC
  are not.

---

## 4. Getting drone footage onto an iPhone

- DJI Fly (iOS 13+) controls the drone and transfers footage to the phone via
  QuickTransfer; supports 20+ current DJI consumer drones. Footage lands in the
  Photos library. https://apps.apple.com/us/app/dji-fly/id1479649251
- DJI Mobile SDK V5 is Android-only on the developer portal (requirements list
  Android 5.0+/10.0; no iOS). The iOS MSDK repo is stuck at "Latest Version
  4.16.2". DJI's forum announcement (login-walled) states new iOS apps built on
  the DJI MSDK cannot currently be published to the App Store and that the iOS
  MSDK update is postponed. https://developer.dji.com/mobile-sdk/ ,
  https://raw.githubusercontent.com/dji-sdk/Mobile-SDK-iOS/master/README.md ,
  https://sdk-forum.dji.net/hc/en-us/articles/11675868224665-The-announcement-of-iOS-Mobile-SDK
  -> An iPhone app cannot pull footage from the drone directly; it consumes
  what DJI Fly has already saved to Photos, or files copied via Files/USB-C.
- Import APIs: `PHPickerViewController` runs out of process, needs no
  photo-library permission, returns `NSItemProvider` (video via
  `loadFileRepresentation`). `UIDocumentPickerViewController` reaches Files,
  iCloud Drive and external drives via security-scoped URLs (`asCopy` option).
  https://developer.apple.com/documentation/photosui/phpickerviewcontroller ,
  https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller
  Both hand over file copies/URLs; large MP4/MOV means duplicated storage
  unless the app reads security-scoped originals in place.
- Storage realities: iPhone 17 Pro ships 256GB-1TB (Pro Max up to 2TB) and
  records HEVC, H.264, ProRes, ProRes RAW. Apple: ProRes files are "up to 30
  times larger than HEVC files"; 128GB Pro models are limited to 1080p30 ProRes
  internally; ProRes requires 10% free storage. Drone footage is typically
  H.264/HEVC, so the constraint is total capacity and Photos duplication, not
  codec. https://www.apple.com/iphone-17-pro/specs/ ,
  https://support.apple.com/en-us/109041

---

## 5. Export target reality on iOS

- Final Cut Pro for iPad: supported media are ProRes, ProRes RAW, H.264, HEVC,
  MXF; documented imports are Final Cut Pro for iPad projects and iMovie for
  iOS projects. Export/share options are video, audio, stills, `.fcpproj`
  project bundles, and media; **FCPXML/XML import or export is not mentioned**
  in the iPad guide. Interchange with Mac is one-directional (iPad -> Mac via
  File > Import > Final Cut Pro for iPad Project); XML transfer is documented
  only for Final Cut Pro for Mac.
  https://support.apple.com/guide/final-cut-pro-ipad/supported-media-formats-dev3f1bb94c2/ipados ,
  https://support.apple.com/guide/final-cut-pro-ipad/export-or-share-dev8ce20673a/ipados ,
  https://support.apple.com/guide/final-cut-pro/import-from-final-cut-pro-for-ipad-ver2d96ac83f/mac ,
  https://support.apple.com/guide/final-cut-pro/use-xml-to-transfer-projects-verdbd66ae/mac
- DaVinci Resolve for iPad (App Store listing, v21.x): Cut and Color pages only
  (no Edit/Fusion/Fairlight); `.drp`/`.dra` compatible with desktop Resolve;
  the listing states support for "importing and exporting Final Cut Pro 12
  FCPXML" and AAF/XML interchange; recommended iPad Pro M1+ with 8GB RAM;
  requires iPadOS 18. https://apps.apple.com/us/app/davinci-resolve-for-ipad/id1581363826
- Net: our FCPXML export has a plausible iPad consumer (Resolve for iPad) but
  not Final Cut Pro for iPad; our EDL/Resolve XML exports target desktop
  Resolve. On iPhone specifically, neither NLE exists; export would be
  "hand off to Mac/iPad" anyway, which is what option B already does.

---

## 6. The "companion client" alternative

The Mac backend already exposes everything a remote client needs: HTTP
timeline operations (`/projects/{id}/timeline/op`, `undo`, `redo`,
`document`), `GET /projects/{id}/events` SSE fan-out of `timeline-changed`,
and the MCP server at `/mcp` (`docs/ARCHITECTURE.md`). Today it binds to
`127.0.0.1`; a companion client needs a LAN bind (opt-in), auth, and a
discovery story.

- Apple TN3179 (iOS 14+): "Outgoing traffic to a local network address
  requires local network access"; making an outgoing TCP connection, resolving
  `.local` names and "all Bonjour operations" trigger the local network alert;
  listening for incoming TCP does not. Apps must add
  `NSLocalNetworkUsageDescription`, and `NSBonjourServices` listing each
  browsed service type (e.g. `_http._tcp`); iOS multicast needs the
  `com.apple.developer.networking.multicast` entitlement.
  https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy ,
  https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription ,
  https://developer.apple.com/documentation/bundleresources/information-property-list/nsbonjourservices
- Discovery: Network.framework `NWBrowser` (iOS 13+) browses Bonjour services;
  the Mac backend would advertise e.g. `_clipassembler._tcp`.
  https://developer.apple.com/documentation/network/nwbrowser
  RN wrapper: `react-native-zeroconf` (documents the iOS 14 plist keys).
  https://github.com/balthazar/react-native-zeroconf
- SSE in React Native: RN's networking docs list Fetch, XMLHttpRequest and
  WebSocket; EventSource/SSE is not provided natively.
  https://reactnative.dev/docs/network
  `react-native-sse` implements EventSource over XMLHttpRequest with no native
  code. https://github.com/binaryminds/react-native-sse
  Alternative: add a WebSocket adapter to `timeline_service.py` fan-out, since
  WebSocket is first-class in RN.
- Media: Frame Samples and proxy media would be served by the Mac over HTTP
  and played with `expo-video`; the phone stores nothing large.
- Scope that fits: Review Board decisions (accept/reject Candidate Clips),
  Version gallery browsing, timeline reorder/trim via `apply_operation`,
  watching an agent's edits live over SSE, triggering exports on the Mac.

---

## 7. Distribution basics

- EAS Build: hosted iOS/Android builds with managed signing; free plan includes
  15 iOS + 15 Android builds/month on a low-priority queue; Starter $19/mo,
  Production $199/mo. Local builds need macOS + Xcode (`npx expo run:ios`) or
  `eas build --local`. https://docs.expo.dev/build/introduction/ ,
  https://expo.dev/pricing , https://docs.expo.dev/guides/local-app-development/
- EAS Submit: "A paid Apple Developer account is mandatory"; `eas submit
  --platform ios` uploads to App Store Connect, build appears in TestFlight
  after ~10-15 min processing. https://docs.expo.dev/submit/ios/
- TestFlight: up to 100 internal testers, 10,000 external testers, builds
  available 90 days, first external build requires App Review.
  https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
- Apple Developer Program: $99/year (Enterprise Program $299/year).
  https://developer.apple.com/programs/

---

## Options compared

| | A. Native/RN rewrite, on-device analysis | B. Companion client for the Mac backend | C. react-native-web wrapper / no-go |
| --- | --- | --- | --- |
| Backend reuse | None of the Python I/O pipeline; only pure logic if embedded CPython (no subprocess, per-module frameworks). Realistically a Swift rewrite. | 100%: existing HTTP + SSE + MCP; add LAN bind, auth, Bonjour advertise. | n/a |
| Frontend reuse | Types, API client, pure state. UI rebuilt (RN components, NativeWind v5 pre-release for Tailwind 4, Expo Router). | Same reuse profile, smaller surface (Review Board + timeline view). | Not possible: RNW runs RN on web, not DOM on native. |
| Video analysis | AVAssetReader/ImageGenerator + Vision (feature print, optical flow, horizon, aesthetics) + Core ML/onnxruntime-react-native; new native modules via Expo Modules API. | Stays on the Mac. | n/a |
| FFmpeg / vidstab | ffmpeg-kit retired (Jul 2026), npm package deprecated; vidstab forces GPL FFmpeg. Must drop FFmpeg. | Unchanged on Mac. | n/a |
| Long jobs | Foreground-bound; BGProcessingTask only when idle, terminated on user activity. | Mac does the work; phone just watches SSE. | n/a |
| Footage ingest | Photos (PHPicker) / Files after DJI Fly transfer; no direct DJI SDK on iOS (MSDK v5 Android-only). | Footage stays on Mac. | n/a |
| Export targets | No NLE on iPhone; Resolve for iPad lists FCPXML import, FCP for iPad does not. | Export runs on Mac as today. | n/a |
| App Store risk | 2.5.2 fine if no downloaded code; GPL FFmpeg is the blocker. | Low: needs NSLocalNetworkUsageDescription / NSBonjourServices. | n/a |
| Effort | Greenfield native app + new analysis engine; multi-quarter. | Weeks: backend LAN mode + RN client for a subset of screens. | Zero, by ruling it out. |
| Product fit | Weak for drone triage (storage, battery, no NLE on phone). | Strong for "review on the couch while the Mac crunches" and agent-edit spectating. | n/a |

## Open questions

1. Does the team want an iPhone surface at all, or is the actual ask "review
   away from the desk"? Option B answers the latter without touching analysis.
2. Backend LAN exposure: how to bind FastAPI beyond `127.0.0.1` safely
   (pairing code / token, TLS on LAN, Bonjour advertise from Electron main or
   from the Python process)? This touches the privileged-boundary rules in
   `docs/ARCHITECTURE.md`.
3. SSE vs WebSocket for the phone: keep `/events` SSE with `react-native-sse`,
   or add a WebSocket adapter to `timeline_service.py`?
4. Where does FFmpegKitNext live and under what license/binary policy? The
   archived README references it but no repository URL was found.
5. If option A is ever pursued: can SigLIP be converted to Core ML with
   acceptable accuracy/size, and does `onnxruntime-react-native` expose the
   CoreML EP (docs do not state it)?
6. Should iPad (not iPhone) be the first Apple-mobile target, given Resolve for
   iPad accepts FCPXML and iPads have the storage/thermals for on-device work?
7. Does the Manual Harness scoring survive a swap from OpenCV Laplacian/vidstab
   metrics to Vision optical-flow/aesthetics outputs without recalibrating the
   0-10 scales in `UBIQUITOUS_LANGUAGE.md`?
