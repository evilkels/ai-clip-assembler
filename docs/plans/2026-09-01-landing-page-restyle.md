# Landing Page Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the public `site/index.html` so a reader sees the same dark, local-first product language as the shipped studio redesign: IBM Plex typography, the approved near-black/coral/green token system, a clear Contact Sheet-inspired hero and workflow story, truthful dark screenshots from the redesigned app, and a usable 390px mobile layout, while preserving the existing copy boundaries, static behavior, SEO surface, and zero-runtime-network promise.

**Architecture:** Keep the landing page as one static HTML document with its existing inline `<style>` block. Replace its legacy custom-property layer with the app’s dark tokens, add only local `@font-face` and image assets, and express navigation and responsive behavior with semantic HTML and CSS rather than JavaScript or a framework. Use the supplied Contact Sheet direction and desktop/mobile renders as visual acceptance references; do not import, modify, or stage the design-export file.

**Tech Stack:** Static HTML, inline CSS, inline decorative SVG, self-hosted WOFF2 fonts, local PNG assets, Python static-site contract checks, and manual browser/network/accessibility inspection.

**Design source:** `AI CLIP ASSEMBLER Redesign APP + Landing page/Clip Assembler Restyle.dc.html`, especially the Contact Sheet direction at lines 856–971 and the finalized dark token/component sheet around line 1145; supplied renders at `AI CLIP ASSEMBLER Redesign APP + Landing page/uploads/ai-clip-assembler-landing-desktop-1440.png` and `.../ai-clip-assembler-landing-mobile-390.png`.

## Global Constraints

- Keep `site/index.html` as a single-file page with its inline `<style>` block; do not add a build step, CSS framework, bundler, component system, or separate stylesheet.
- Use the approved dark Contact Sheet direction throughout: `#08090b`, `#0d0f12`, `#12151a`, `#171b21`, `#23272e`, `#343a43`, `#f4f5f7`, `#a2a8b2`, `#6b7280`, `#ff4d6d`, and `#5fd18b`, matching `frontend/src/renderer/src/styles/tokens.css:82-106`.
- Self-host IBM Plex Sans and IBM Plex Mono as WOFF2 files under `site/fonts/`; remove the Google Fonts preconnect and stylesheet at `site/index.html:59-63`. The loaded page must issue zero third-party network requests; GitHub URLs may remain as explicit user-click links, but no remote font, image, stylesheet, script, import, or analytics resource may load.
- Do not add JavaScript or a JavaScript framework. Preserve the current no-runtime-script behavior: the page’s only current `<script>` is JSON-LD at `site/index.html:28-58`, and the visible page is static HTML from `site/index.html:861-1107`; headings, copy, local images, anchors, and external links must remain useful with JavaScript disabled.
- Preserve the approved headline exactly: `Turn hours of drone footage` / `into a cut worth keeping.` at `site/index.html:899`.
- Preserve existing copy unless a line is factually wrong or undersells shipped behavior. Every proposed copy change is recorded as a before/after pair in Task 3; no unlisted editorial rewrite is allowed.
- Keep the design export read-only and never stage it: `AI CLIP ASSEMBLER Redesign APP + Landing page/`, including `Clip Assembler Restyle.dc.html` and `uploads/`.
- Preserve the entire SEO surface. Do not regress the title and description at `site/index.html:7-9`, robots policy at `site/index.html:10`, canonical and favicon at `site/index.html:11-12`, all `og:*` fields at `site/index.html:13-21`, all `twitter:*` fields at `site/index.html:22-27`, or the parseable `WebSite` and `SoftwareApplication` JSON-LD graph at `site/index.html:28-58`. Keep the social-card dimensions/target contract represented by `site/index.html:18-20` and `site/index.html:26-27`.
- Keep `site/sitemap.xml:1-5` unchanged and in parity with the sole public page. Do not add FAQ structured data; the existing static contract explicitly rejects retired FAQ markup in `scripts/tests/test_site_contract.py:44-49`.
- Keep the four workflow sections and their local image paths at `site/index.html:942-997`; only their presentation, screenshot pixels, alt text, and explicitly listed undersell corrections may change.
- Keep the existing icon path `img/icon.png`, GitHub/release destinations at `site/index.html:906-909` and `site/index.html:1089-1101`, and all content claims within the shipped local-first/provider-consent/export boundaries already tested by `scripts/tests/test_site_contract.py:76-84`.
- Use the supplied 1440px desktop and 390px mobile renders as visual references. The final page must be dark at every viewport; remove the current alternate palette in `site/index.html:647-718` rather than retaining a light landing mode.

## Token mapping

The current custom properties are declared at `site/index.html:65-77`. Replace them with the app token names and values from `frontend/src/renderer/src/styles/tokens.css:82-106` and `:26-27`/`:55-56`; do not preserve the legacy names as a second competing system.

| Current property and actual value | Replacement | Migration decision |
|---|---|---|
| `--navy: #182330` (`site/index.html:66`) | Remove; use `var(--bg-0)` (`#08090b`) for the dark privacy/closing surface and `var(--text)` (`#f4f5f7`) for ghost-button text | The old property is overloaded by the privacy background at `site/index.html:509` and ghost-button text at `:250`; split those roles instead of forcing one token to do both. |
| `--navy-soft: #273544` (`:67`) | `var(--text-dim)` (`#a2a8b2`) | Use for secondary hero/brand and supporting copy. |
| `--paper: #f0f2f4` (`:68`) | `var(--bg-0)` (`#08090b`) | Make the document surface the approved dark app background. |
| `--paper-bright: #fafbfc` (`:69`) | `var(--bg-1)` (`#0d0f12`) | Use for the ruler/secondary bands and elevated page strips. |
| `--ink: #17202c` (`:70`) | `var(--text)` (`#f4f5f7`) | Use for primary headings, links, and values. |
| `--signal: #ef5358` (`:71`) | `var(--accent)` (`#ff4d6d`) | Use for coral emphasis, active state, playhead, and primary controls. |
| `--signal-dark: #d93f46` (`:72`) | `var(--accent-hover)` (`#ff6b85`) | Use for hover/focus-adjacent accent treatment; do not introduce a new dark coral. |
| `--slate: #617080` (`:73`) | Split to `var(--text-dim)` (`#a2a8b2`) for readable prose and `var(--text-muted)` (`#6b7280`) only for compact metadata/labels | The current property is used for both body copy and metadata at `site/index.html:262`, `:440`, `:483`, `:595`, and `:618-640`; preserve contrast by assigning roles explicitly. |
| `--tick: #d2d8de` (`:74`) | `var(--border)` (`#23272e`) | Use for rules, shot borders, and the ruler grid. |
| `--tick-dark: #9da8b3` (`:75`) | Removed; use `var(--border-strong)` (`#343a43`) only where a stronger boundary is necessary | The declaration has no current selector use; do not carry it forward as an unused dark-mode alias. |
| `--mono: 'IBM Plex Mono', ui-monospace, monospace` (`:76`) | `var(--font-mono)` with the app stack from `tokens.css:27`/`:56` | Self-host the requested Plex weights, then retain the system fallbacks. |
| `--sans: 'Archivo', system-ui, sans-serif` (`:77`) | `var(--font-sans)` with the app stack from `tokens.css:26`/`:55` | Replace Archivo with IBM Plex Sans/Plex Sans and local/system fallbacks. |

## Status — TODO (2026-09-01)

This plan is intended to land inside PR #68. It changes no files by itself other than this plan document; implementation must remain on `redesign/studio-workflows`, must not switch branches, and must not touch the main checkout, commit, or push from this work session.

### Task 1: Self-host the Plex fonts and remove the CDN

**Files:**
- Create: `site/fonts/IBMPlexSans-Regular.woff2`, `IBMPlexSans-Medium.woff2`, `IBMPlexSans-SemiBold.woff2`, and `IBMPlexSans-Bold.woff2`
- Create: `site/fonts/IBMPlexMono-Regular.woff2` and `IBMPlexMono-Medium.woff2`
- Modify: `site/index.html:59-63` and the inline style block beginning at `site/index.html:64`

- [ ] **Step 1: Add the licensed local font files**

  Place the six WOFF2 files under `site/fonts/`, with the declared weights matching 400/500/600/700 for Sans and 400/500 for Mono. Keep filenames and `font-weight` declarations one-to-one so synthetic weights are not introduced. Preserve the font license/attribution required by the selected distribution alongside the assets if the distribution requires it, without creating a runtime request.

- [ ] **Step 2: Define local `@font-face` sources in the existing inline style**

  Add local `url("fonts/<file>.woff2") format("woff2")` sources before the root rules, set the correct family names/weights, and use `font-display: swap`. Point the page’s sans and mono variables at those families followed by the exact app fallbacks from `frontend/src/renderer/src/styles/tokens.css:26-27`.

- [ ] **Step 3: Remove the two preconnects and Google stylesheet**

  Delete only `site/index.html:59-63`’s Google Fonts resource links. Do not remove or rewrite the canonical, Open Graph, Twitter, JSON-LD, favicon, or GitHub links in the surrounding head.

- [ ] **Step 4: Check the font/network contract**

  Run:

  ```bash
  rg -n "fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|<link[^>]+preconnect|@import|src=[\\\"']https?://" site/index.html site/fonts
  ```

  Expected: no output. The only font sources should be relative `site/fonts/*.woff2` URLs.

### Task 2: Replace the token layer and dark base/typography

**Files:**
- Modify: `site/index.html:65-112` and the current alternate-theme block at `site/index.html:647-718`

- [ ] **Step 1: Replace the legacy root variables with the shipped dark tokens**

  Declare the exact app dark variables from `frontend/src/renderer/src/styles/tokens.css:82-106`: `--bg-0`, `--bg-1`, `--bg-2`, `--bg-3`, `--bg-surface`, `--bg-active`, `--border`, `--border-strong`, `--text`, `--text-dim`, `--text-muted`, `--accent`, `--accent-hover`, `--accent-dim`, `--green`, `--yellow`, and the required font variables. Keep the exact hexadecimal values; do not copy the optional light palette from `tokens.css:114-170`.

- [ ] **Step 2: Rebase the document defaults**

  Set `body` to `var(--font-sans)`, `var(--bg-0)`, and `var(--text)` while retaining the current readable base size/line-height intent at `site/index.html:90-96`. Apply `var(--font-mono)` to `.tc`, timecodes, scores, counts, file metadata, and compact labels. Use `var(--text-dim)` for normal supporting prose and reserve `var(--text-muted)` for metadata that meets the contrast decision in Task 6.

- [ ] **Step 3: Remove the light/OS palette override**

  Delete the `@media (prefers-color-scheme: dark)` remapping and its light-oriented hardcoded colors at `site/index.html:647-718`. Keep only dark values, while preserving the existing `prefers-reduced-motion` rule and expanding it later in Task 6 for all hero motion.

- [ ] **Step 4: Reconcile hardcoded colors and radii**

  Replace remaining legacy navy/paper/red/gray literals in the inline style with the mapped tokens. Adopt the app geometry from `frontend/src/renderer/src/styles/tokens.css:42-46`: 6px small controls/chips, 8px rows/tiles, 10px inputs/controls, 14px cards/panels, and 999px pills. Keep the large editorial heading scale from the supplied render instead of flattening the landing into app-density text.

- [ ] **Step 5: Render a static checkpoint**

  Serve `site/` locally and confirm the page is already a complete dark, readable document after the token pass, with no missing fonts or images. Keep all section content and link targets intact; section-specific layout work belongs to Task 3.

### Task 3: Restyle the landing section by section and record copy corrections

**Files:**
- Modify: `site/index.html:114-645`, `site/index.html:720-857`, and `site/index.html:863-1103`

- [ ] **Step 1: Add semantic header navigation without JavaScript**

  Keep the existing hero wrapper and brand label at `site/index.html:863-896`, then add a real `<nav>` with anchors for `#how-it-works`, `#local-first`, `#faq`, GitHub, and the release download action. Style it after Contact Sheet 2a’s header reference at `Clip Assembler Restyle.dc.html:863-870`: mono brand/meta, dim navigation text, coral outlined Download action, and 8px control geometry. Use ordinary anchors so navigation works with JavaScript disabled and on narrow screens.

- [ ] **Step 2: Restyle the hero, network graph, and ruler strip**

  Recolor the existing decorative SVG graph at `site/index.html:864-892` with `var(--border-strong)`, `var(--text-muted)`, and coral signal nodes; keep `aria-hidden="true"` and `pointer-events: none`. Restyle `.hero`, `.hero-copy`, `.hero-mark`, and buttons at `site/index.html:114-303` against the dark token surfaces, preserving the exact headline and current hero body copy at `site/index.html:899-904`. Use the supplied desktop/mobile renders as the composition target: clear left-aligned desktop copy, compact brand card, coral emphasis, and no light glass treatment.

  Restyle the timeline-ruler signature at `site/index.html:344-403` to `var(--bg-1)`, `var(--border)`, `var(--text-muted)`, and `var(--accent)`, retaining the `00:00`–`02:47` labels at `site/index.html:920-924` and the visible playhead. The existing animation is the only current animated hero element (`site/index.html:365-392`); Task 6 must verify its reduced-motion fallback.

- [ ] **Step 3: Restyle the overview and four alternating workflow rows**

  Keep the four sections and their existing order at `site/index.html:929-998`. Use the dark Contact Sheet rhythm: quiet rules, generous spacing, 14px screenshot frames, mono coral kickers rendered as `IN 00:00 · IMPORT`, `IN 00:42 · REVIEW`, `IN 01:36 · TIMELINE`, and `IN 02:47 · EXPORT`, readable secondary prose, and alternating copy/image placement already expressed by `site/index.html:449-464`. Replace light shot borders/backgrounds/shadows at `site/index.html:495-505` with the dark panel treatment. Preserve lazy loading on workflow images.

- [ ] **Step 4: Apply only these explicit shipped-behavior copy corrections**

  Keep the headline, hero paragraph, import paragraph, local-first block, FAQ, closing CTA, and footer wording unchanged. Make the following exact before/after edits because the redesigned app now ships the named views and export handoff:

  - `site/index.html:961-964` before: “Every candidate arrives with scores and a reason. Include the keepers, exclude the rest, then ask the optional AI agent for editable versions: a punchy social cut, cinematic highlight, or long scenic montage. Compare the options, apply one to the Timeline, and keep the final call.” After: “Every candidate arrives with scores and a reason. Browse them in grid, list, or filmstrip views; include the keepers, exclude the rest, then ask the optional AI agent for editable versions: a punchy social cut, cinematic highlight, or long scenic montage. Compare the options, apply one to the Timeline, and keep the final call.” Justification: the redesigned Candidate Clip browser ships those three views; omitting them undersells the shipped workflow documented in the studio plan’s Task 3.
  - `site/index.html:976-978` before: “Reorder by dragging, trim from clip edges, scrub the ruler, and play it back with J K L transport keys. Every edit — yours or the AI's — lands in one undo history.” After: “Reorder by dragging, trim from clip edges, scrub the ruler, and play it back with J K L transport keys. Inspect the selected item as you refine it, and keep every edit — yours or the AI's — in one undo history.” Justification: the redesigned Timeline ships a selected-item inspector; the current line describes editing but not that shipped control.
  - `site/index.html:990-992` before: “Export a real, editable timeline — DaVinci Resolve XML, Final Cut Pro FCPXML, or plain EDL — with media paths that survive moving the project folder. Finish the cut in the editor you already trust.” After: “Export a real, editable timeline — DaVinci Resolve XML, Final Cut Pro FCPXML, or plain EDL — with media paths that survive moving the project folder. Review the export receipt and reveal the written file in Finder, then finish the cut in the editor you already trust.” Justification: the redesigned Export screen ships a receipt and Reveal action; this makes the handoff behavior discoverable without changing the export formats or claim.

- [ ] **Step 5: Restyle the local-first block**

  Give the existing `privacy` section at `site/index.html:1000-1035` the dark `var(--bg-1)`/`var(--bg-0)` band treatment, add `id="local-first"` to the section for the new nav anchor, and retain its three columns, headings, consent language, and Open Source claim. Use `var(--text-dim)` for the lead/body and `var(--text-muted)` only for mono labels after the contrast check.

- [ ] **Step 6: Restyle FAQ, closing CTA, and footer**

  Keep the FAQ’s four questions and answers at `site/index.html:1037-1083`, but use the dark two-column desktop/one-column mobile rhythm, quiet `var(--border)` separators, and readable text roles. Restyle the closing section and footer at `site/index.html:1085-1103` with the supplied dark render’s centered CTA, coral primary button using `#1a0308` label text, outlined secondary action, mono note, and dim footer links. Do not change any destination URL.

### Task 4: Re-capture redesigned dark workflow screenshots and fix alt text

**Files:**
- Modify: `site/img/import.png`
- Modify: `site/img/review.png`
- Modify: `site/img/timeline.png`
- Modify: `site/img/export.png`
- Modify: `site/img/social-card.png`
- Modify: `site/index.html:952-996` alt attributes only, plus any screenshot-specific copy already listed in Task 3

- [ ] **Step 1: Gate capture on the running redesigned app and real footage**

  Use the `redesign/studio-workflows` app with real, rights-cleared footage and the dark theme. Capture Import, Review, Timeline, and Export after exercising the real Import → analysis → Candidate Clip review → Timeline → export flow. Sanitize filenames, locations, faces, notifications, keys, and history before saving public assets. This step is human-gated because a static plan/agent cannot produce truthful app captures without a running build and footage.

- [ ] **Step 2: Replace the four stale workflow images**

  Overwrite the four local PNGs at the existing paths, preserving the current site asset contract and pixel dimensions unless the supplied render/capture setup deliberately establishes a new consistent set. The images must show the redesigned dark shell and the actual shipped Import views, Review views, selected Timeline inspector, and Export receipt/handoff actions; do not use the design export’s placeholder `<image-slot>` at `Clip Assembler Restyle.dc.html:956-958`.

- [ ] **Step 3: Re-capture the social card from the same dark app state**

  Replace `site/img/social-card.png` with the approved dark branded composition from this capture cycle. Keep the file target and the existing Open Graph/Twitter references at `site/index.html:18` and `:26`; do not change metadata dimensions or point metadata at the design-export image.

- [ ] **Step 4: Correct and verify image alternatives**

  Change `site/index.html:952` from `alt="Import screen with three source videos analyzed"` to `alt="Import screen with three source videos ready to analyze"`, because the current image visibly shows three `— Not analyzed` rows and an `Analyze all 3` button. Update the other three alternatives to describe the actual recaptured dark screens, for example “Review screen with scored candidate clips and suggested cuts”, “Timeline screen with clips, ruler, playhead, and selected-item inspector”, and “Export screen with format cards and completed export receipt”; inspect each new image before finalizing wording.

### Task 5: Responsive pass against the 390px reference

**Files:**
- Modify: `site/index.html:305-342` and `site/index.html:720-857`, plus the section rules touched in Tasks 2–3

- [ ] **Step 1: Match the 1440px desktop reference**

  Render at 1440px wide and compare the page silhouette, hero height, graph/card placement, ruler, workflow alternation, screenshot frame widths, three-column local-first block, two-column FAQ, CTA, and footer against `.../ai-clip-assembler-landing-desktop-1440.png`. Keep the desktop content width capped at the existing 1240px intent from `site/index.html:128-133` and `:405-417`.

- [ ] **Step 2: Reflow the header and hero without JavaScript**

  At 390px, allow navigation controls to wrap or collapse through CSS while keeping every destination reachable. Stack hero copy, CTA actions, and brand card; crop/reposition the decorative graph so it does not create horizontal overflow; keep the ruler labels legible and the playhead inside the viewport. Preserve the static content order from `site/index.html:893-927`.

- [ ] **Step 3: Reflow workflow, privacy, FAQ, CTA, and footer sections**

  Stack each workflow copy/image pair in the same reading order as the supplied mobile render, make screenshot frames width-safe, switch the privacy grid and FAQ grid to one column, and stack CTA buttons/notes without clipped text. Preserve the current mobile breakpoint intent at `site/index.html:817-857`, but replace all light-theme assumptions with the dark tokens.

- [ ] **Step 4: Check the mobile failure modes**

  At exactly 390px and at a slightly narrower viewport, confirm no horizontal scrollbar, no clipped focus ring, no overflowing mono kicker, no unreadable screenshot, no inaccessible nav link, and no accidental desktop-only copy. Compare a full-page screenshot with the supplied mobile render by human inspection.

### Task 6: Accessibility, contrast, and final verification hooks

**Files:**
- Modify: `site/index.html` inline style and semantic markup only; do not modify `site/sitemap.xml`

- [ ] **Step 1: Apply and record measured WCAG AA contrast decisions**

  Verify the following exact foreground/background pairs using the WCAG 2.x relative-luminance formula, and keep the listed result in the review record/checklist rather than making an unqualified “AA compliant” claim:

  | Pair | Measured ratio | AA result |
  |---|---:|---|
  | Primary/body `#f4f5f7` on `#08090b` | **18.26:1** | **Pass** for normal text |
  | Secondary body `#a2a8b2` on `#08090b` | **8.33:1** | **Pass** for normal text |
  | Muted `#6b7280` on `#08090b` | **4.12:1** | **Fail** for normal-size body text; **Pass** only for large text, so use it for mono metadata/labels rather than paragraphs |
  | Coral accent text `#ff4d6d` on `#08090b` | **6.20:1** | **Pass** for normal text |
  | Coral button background `#ff4d6d` with label `#1a0308` | **6.16:1** | **Pass** for normal button text |

  Assign paragraph copy to `#a2a8b2`, ensure `#6b7280` is not used for normal-size prose, and use the exact `#1a0308` label color on coral primary buttons.

- [ ] **Step 2: Preserve semantic and non-color accessibility**

  Keep one visible `h1` at `site/index.html:899`, an ordered heading hierarchy through the sections, real navigation links, descriptive alternatives for all meaningful screenshots, empty alt for the decorative icon only where it remains decorative at `site/index.html:912`, and `aria-hidden="true"` on the decorative graph/ruler. Do not convey Keep/Cut or status information with color alone; retain visible words in the screenshot-independent copy or labels.

- [ ] **Step 3: Make focus and motion behavior testable**

  Provide a visible `:focus-visible` treatment for every nav link, CTA, and any newly introduced interactive control; it must remain visible against both the dark background and coral button. Keep the current `prefers-reduced-motion: reduce` handling at `site/index.html:394-403`, pinning the playhead rather than animating it, and disable any new hover/transition animation under the same media query. Confirm keyboard tab order follows header → hero actions → workflow anchors/content → FAQ/CTA/footer links.

- [ ] **Step 4: Run the static contract and diff checks**

  Run:

  ```bash
  python3 scripts/tests/test_site_contract.py -v
  git diff --check -- site/index.html site/fonts site/img
  ```

  Expected: the static contract passes, relative anchors still resolve, JSON-LD remains parseable, metadata remains truthful, and Git reports no whitespace errors. Review `git diff -- site/index.html site/sitemap.xml` to confirm the SEO head and sitemap were not accidentally rewritten; `site/sitemap.xml` should have no diff.

## Verification

The reviewer can run the following checks after implementation:

1. `python3 scripts/tests/test_site_contract.py -v` — must pass the repository’s title/description/canonical/robots, JSON-LD, social-image, privacy/export-copy, sitemap-parity, and relative-anchor checks from `scripts/tests/test_site_contract.py:22-100`.
2. `git diff --check -- site/index.html site/fonts site/img` — must return clean.
3. `python3 -m http.server 4173 --directory site` followed by opening `http://127.0.0.1:4173/` — confirm the document, local fonts, favicon, four screenshots, and social card all return successfully.
4. `rg -n "fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|<link[^>]+preconnect|@import|src=[\\\"']https?://" site/index.html site/fonts` — must return no runtime resource matches. Then use browser DevTools Network with cache disabled and a clean reload; every loaded resource must be local/`127.0.0.1`, with zero third-party requests. Do not count URLs in metadata or explicit GitHub anchors as page-load requests.
5. `file site/img/import.png site/img/review.png site/img/timeline.png site/img/export.png site/img/social-card.png` — confirm all five files are valid PNGs and that the four workflow captures share one deliberate capture size while the social card remains the metadata-targeted social composition.
6. Render at 1440px and 390px, compare full-page screenshots with the supplied read-only desktop/mobile renders, and have a human confirm the dark Contact Sheet treatment, graph, ruler/playhead, alternating workflow rows, screenshot authenticity, local-first block, FAQ, CTA, footer, and no horizontal overflow.
7. With JavaScript disabled, reload and test anchor navigation, nav links, release/GitHub links, visible copy, heading order, image alternatives, and all non-animated content. The page has no automated browser/visual test suite for `site/`; the repository has only the static contract check invoked by `.github/workflows/test-site.yml:25-26`, so visual fidelity, network isolation, contrast, focus, reduced motion, and screenshot truth remain human-inspection risks.
8. Keyboard-test every link and control at both viewport sizes; verify the focus ring is visible and the order is logical. Enable `prefers-reduced-motion: reduce` in browser emulation and confirm the hero playhead is stationary.
9. Use a contrast checker or the WCAG formula to reproduce the five ratios in Task 6; do not accept a color substitution that changes the stated pass/fail result without updating the plan/review evidence.
10. Inspect the head and sitemap against the preserved values at `site/index.html:7-58` and `site/sitemap.xml:1-5`; title, description, canonical, `og:*`, `twitter:*`, JSON-LD SoftwareApplication, and sitemap URL must survive unchanged except for the screenshot file’s pixels.

## Risks / open questions

- Screenshot re-capture is human-gated: it requires the redesigned app running with real, sanitized footage and a maintainer who can verify Import → Review → Timeline → Export truth. A passing static contract cannot prove that screenshots depict the shipped app.
- The dark-vs-light direction is settled on 2a “Contact Sheet”. If “Cutting Room” 2b is ever revisited, its material lives in `AI CLIP ASSEMBLER Redesign APP + Landing page/Clip Assembler Restyle.dc.html` at the `id="2b"` exploration beginning around line 975; do not mix its light palette into this change.
- The repository has no automated visual, responsive, accessibility, or network-isolation suite for `site/`, so a visually plausible diff can still regress 390px layout, focus visibility, font loading, contrast, or third-party requests. The existing static contract test reduces metadata/link risk but does not replace human review.
- The required WOFF2 files are not currently present under `site/`; implementation must obtain a redistributable IBM Plex Sans/Mono set, preserve its license obligations, and verify that the chosen weights render without synthetic bolding or an accidental remote fallback.
- The legacy page’s current dark-mode media override contains a second palette at `site/index.html:647-718`; deleting it is intentional because the owner selected a dark-only landing, but reviewers should ensure no operating-system preference unexpectedly reintroduces light surfaces.
- The three copy additions in Task 3 describe shipped redesign capabilities and should be checked against the exact app build used for screenshot capture. The headline and all other copy remain fixed unless a separately recorded factual correction is approved.
