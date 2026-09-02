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
- **One factual copy bug, unrelated to the redesign, was found in the retired
  import screenshot.** Its alt text claimed that three source videos had been
  analyzed, while the image showed all three rows reading "— Not analyzed" and
  an "Analyze all 3" button not yet pressed. The obsolete screenshot has now
  been removed; any replacement capture must use accurate alt text.
- A landing redesign *was* supplied with the app design
  (`ai-clip-assembler-landing-desktop-1440.png`, `-mobile-390.png` in the
  gitignored design export) and has never been implemented. The reference
  (`Clip Assembler Restyle.dc.html`) offers **two directions**, and the supplied
  renders are dark-first:
  - **"Contact Sheet" (dark)** — scoring and kept-vs-cut is the hero.
  - **"Cutting Room" (light)** — the app screenshot is the hero.

  **Decision made 2026-09-01: "Contact Sheet" (dark).** The landing converges on
  the app's shipped dark token set rather than keeping an independent identity.
  The owner also settled two things this plan had left open: fonts are
  self-hosted WOFF2 (the Google Fonts CDN goes away entirely), and the four
  workflow screenshots are re-captured from the redesigned app rather than
  deferred. Execution now lives in
  [2026-09-01-landing-page-restyle.md](done/2026-09-01-landing-page-restyle.md);
  this file keeps only the launch/distribution backlog.

  One correction to the note above: the design export keeps the *existing*
  headline and body copy ("Headline and body copy kept from your current page"),
  so this is a restyle, not a rewrite. The current page is the older light
  editorial treatment with no navigation and no scored product proof above the
  fold.

### Sequencing

Superseded 2026-09-01: the restyle now rides *inside* PR #68 rather than waiting
for it to merge, so the shots are taken from the redesign branch build and are
stale only once. Order: restyle `site/` against the app tokens → re-capture the
four workflow shots and the social card from the branch build → fix alt text →
responsive and contrast pass. Screenshot capture stays **maintainer-owned** (it
needs real footage in a running build); everything else is agent-executable.
See [2026-09-01-landing-page-restyle.md](done/2026-09-01-landing-page-restyle.md).



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

## Absorbed from the technical SEO plan (2026-09-02)

Technical SEO shipped: the site contract harness, truthful metadata and
structured data, the sitemap, corrected privacy and export copy, and the
PR-time `test-site.yml` gate are all in place and enforced by
`scripts/tests/test_site_contract.py` (7/7 green). The full rationale and the
decisions taken — no `meta keywords`, no FAQ schema, no fabricated ratings, no
`site/robots.txt` on a Project Pages subpath — are preserved in
[`done/seo-plan.md`](done/seo-plan.md).

One item remains, and it is maintainer-owned because it needs an authenticated
Google account:

- Verify the Search Console property, submit the sitemap, run the Rich Results
  Test and URL Inspection, and capture a 28-day query baseline. Supply a real
  verification file; do not commit a placeholder or guessed filename.
- The 28-day measurement follow-up wants a dated GitHub issue ("Review landing
  SEO after 28 days"). Creating it is an external-state change and needs
  explicit authorization.

`seo-content-pilot.md` stays a separate plan: it is gated on query evidence
from this baseline plus human editorial input.
