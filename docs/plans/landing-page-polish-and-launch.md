# Landing page polish and launch backlog

Status: ACTIVE. The v0.1.3 editorial refresh shipped; proof, distribution,
release-account work, demo media, and measured content expansion remain.
**New debt as of 2026-08-31: the landing page no longer depicts the shipped app.**

## Landing drift after the studio redesign (verified 2026-08-31)

`redesign/studio-workflows` restyled the whole app but excluded the landing page
by constraint, so `git diff main...redesign/studio-workflows -- site/` is empty.
The consequence is that `site/` now advertises a product that looks different
from the one users download. Verified specifics:

- **Screenshots predate the redesign.** `site/img/{import,review,timeline,export}.png`
  were all last committed 2026-07-14 (`3c91c6c`), a month before the redesign
  landed (2026-08-14). All four show the pre-redesign UI: old palette, old Import
  table-only browser, old Review layout, old Timeline and Export. Every workflow
  image on the page is now misleading.
- **The two visual systems have genuinely diverged**, not merely drifted:

  | | Landing (`site/index.html`) | App (`styles/tokens.css`) |
  |---|---|---|
  | Surfaces | navy/paper: `#182330`, `#273544`, `#f0f2f4`, `#17202c` | near-black: `#08090b`, `#0d0f12`, `#12151a`, `#171b21` |
  | Accent | none of the app accent; red used decoratively | `#ff4d6d` dark / `#e11d48` light |
  | Sans | `Archivo` (`site/index.html:77`) | `Plex Sans` (`tokens.css:26`) |
  | Mono | `IBM Plex Mono` (`:76`) | `Plex Mono`/`IBM Plex Mono` (`:27`) — the only match |
  | Radii | 4 / 12 / 18 / 20px | 6 / 8 / 10 / 14 / 999px — **no overlap** |

- **Copy predates the redesign's capabilities.** The page does not mention the
  three Import views (table/thumbs/compact), the three Review views
  (grid/list/filmstrip), the selected-Timeline inspector, or the Export receipt
  with Reveal-in-Finder. Shipped functionality is undersold.
- **A web-font CDN dependency contradicts the local-first pitch.**
  `site/index.html:59-62` preconnects to and loads Archivo + IBM Plex Mono from
  `fonts.googleapis.com`/`fonts.gstatic.com`. The app forbids exactly this
  (plan constraint: "no runtime dependency on a web-font CDN"), and a page whose
  headline promise is "local by default" third-party-loading fonts is a bad look
  independent of the redesign. Self-host when restyling.
- **One factual copy bug, unrelated to the redesign.** `site/index.html:952` has
  `alt="Import screen with three source videos analyzed"`, but `img/import.png`
  visibly shows all three rows reading "— Not analyzed" and an "Analyze all 3"
  button not yet pressed. Verified by inspecting the image. Fix the alt text
  regardless of when screenshots get re-shot.
- A landing redesign *was* supplied with the app design
  (`ai-clip-assembler-landing-desktop-1440.png`, `-mobile-390.png` in the
  gitignored design export) and has never been implemented. The reference
  (`Clip Assembler Restyle.dc.html`) offers **two directions**, and the supplied
  renders are dark-first:
  - **"Contact Sheet" (dark)** — scoring and kept-vs-cut is the hero.
  - **"Cutting Room" (light)** — the app screenshot is the hero.

  **This is an open decision and blocks task 3 below.** The current page is
  neither: it is the older light editorial treatment with no navigation and no
  scored product proof above the fold.

### Sequencing

Do not re-shoot screenshots until `redesign/studio-workflows` merges, or they
will be stale twice. Order: merge redesign → re-capture the four workflow shots
and the social card from the built app → align `site/` tokens to the app system
→ update copy for the new views. Screenshot capture is **maintainer-owned** (it
needs real footage in a running build); token alignment and copy are
agent-executable once the shots exist.



## Delivered and launch order

The page now uses the cover's paper/graphite/navy/red system, a copy-first hero,
larger workflow imagery, and accurate local-default/optional-AI wording. Next:
version-aligned DMG → clean-machine proof → real demo → technical SEO/Search
Console → one gated culling guide → one audience launch loop → measurement.

## Maintainer-owned work

- Choose 8–15 rights-cleared clips; remove private names, locations, faces,
  notifications, keys, and history. Prove Import → Analyse → Review → visible
  edit → editable export → target NLE on the distributable build.
- Test Gatekeeper, first launch, bundled tools, restart, export, and NLE import
  on a clean Mac; file every workaround. Approve claims, version, URL, privacy,
  exports, screenshots, demo, and article against the shipped build.
- Supply first-hand culling lessons, mistakes, a concrete example, and usable
  screenshots; verify Search Console and record the query baseline.
- Publish transparently where the target audience already gathers, answer
  replies, and collect their language. Do not automate posts or engagement.

## Agent-owned work and demo contract

- Finish technical SEO, add the release-matched DMG URL, implement the guide
  only after its evidence gate, and turn clean-machine/search findings into
  scoped issues rather than broadening the launch change.
- Produce a truthful 45–60s proof: unsorted footage → project/import → analysis
  and Candidate Clips → include/exclude or proposal → Working Timeline → export
  opened in Resolve/FCP → product/URL. Cuts may remove waits, not invent behavior.
- Deliver H.264 MP4 + captions, 15–25s muted web cut with controls and reduced-
  motion/static fallback, 16:9 poster, transcript, and source/rights notes.
  Capture at 1440p/1080p with notifications off; prefer MP4 over GIF.

## Exit signal

Five target users can download the current build, create an editable export
from their footage, and explain its value without live support. Expand content
only after the first 28-day review or meaningful impression sample.
