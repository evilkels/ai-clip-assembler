# Landing Page Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `site/index.html` to the Claude Design landing handoff: a dark-default (light-toggleable) page whose fold proves the product's judgement with a six-frame contact sheet of real scored footage, followed by a timeline-ruler divider, three steps, one macOS-framed app screenshot, and a closing download band — while keeping the Local-first and FAQ sections the handoff omits, because the public copy contract and the handoff's own nav depend on them.

**Architecture:** One static HTML file with one inline `<style>` block, as today. Two token maps (`[data-theme="dark"]` default and `[data-theme="light"]`) on a single markup tree — not two templates. Fonts self-hosted from `site/fonts/`. The only script beyond JSON-LD is a small inline theme toggle.

**Tech Stack:** Static HTML, inline CSS custom properties, inline decorative SVG, self-hosted WOFF2, WebP imagery, a few lines of vanilla JS for the theme toggle, and the existing Python static-site contract check.

## Source of truth

- `docs/design/2026-09-01-landing-page-handoff.md` — the prose spec. Every hex, size and spacing figure in it is exact and final. **Read it in full before starting.**
- `docs/design/2026-09-01-landing-page-reference.html` — the rendered reference; Reference A dark, Reference B light, fixed 1440px, all styles inline. Read as a spec, never copy as source.
- `AI CLIP ASSEMBLER Redesign APP + Landing page/Clip Assembler Restyle.dc.html` — the wider app design system (gitignored, read-only, never stage).

## Status — IMPLEMENTED; literal conformance recorded 2026-09-02

Intended to land inside PR #68 alongside the studio workflow redesign, so the app
and the page that advertises it ship together. The final side-by-side review,
fresh repository gate, and remaining human checks are recorded in
[`docs/reviews/2026-09-01-literal-design-conformance.md`](../reviews/2026-09-01-literal-design-conformance.md).

**Already done before implementation starts:**

- [x] Six contact-sheet frames vendored to `site/img/frames/clip-0{1..6}.webp`. The
      handoff shipped them as PNG totalling 4.3MB, which is untenable for above-the-fold
      hero imagery; re-encoded to WebP q82 at their original 767×431, 762×429, and
      764×430 dimensions for 352KB total, a 92% reduction with no resolution loss.
- [x] Fonts self-hosted to `site/fonts/` (76KB total): `ibm-plex-sans-latin-var.woff2`
      covers weights 400–700 in one variable file, plus three static Plex Mono weights.
      OFL-1.1 licence and refresh instructions are in `site/fonts/LICENSE.txt` and
      `site/fonts/README.md`.

## Decisions taken by the project owner (2026-09-01) — do not re-open

1. **Dark is the default; light ships too**, behind a toggle. Both token sets are
   fully specified in the handoff.
2. **Fonts are self-hosted**, Latin subset. The Google Fonts CDN links at
   `site/index.html:59-63` are deleted. The handoff asks for this, and it is the only
   option consistent with the page's own privacy claim.
3. **Structure = handoff, plus retained sections.** Adopt the handoff exactly for
   header, hero, ruler divider, three steps, screenshot frame and closing band. Then
   **keep** the existing "Local-first, by decision" and FAQ sections, restyled into the
   new token system. Reasons, both hard:
   - `scripts/tests/test_site_contract.py:76-84` asserts the page contains
     "cloud ai is opt-in per project", "external ai assistant", "external provider's
     privacy policy", "edl" and "flatten". That copy lives only in those two sections.
   - The handoff's own nav specifies `#local-first` and `#faq` anchors, while its
     reference page contains no such sections and no `id` attributes at all.
4. **The headline is preserved exactly:** "Turn hours of drone footage" /
   "into a cut worth keeping.", second line in the accent colour.

## Global Constraints

- `site/index.html` stays ONE file with ONE inline `<style>` block. No build step, no
  framework, no bundler, no external stylesheet, no icon library.
- Zero third-party network requests on load. No `@import`, no CDN, no remote font,
  image, script or analytics. Remote URLs may appear only as user-click links
  (GitHub, releases) and as metadata values (canonical, `og:*`, JSON-LD).
- JavaScript is limited to the theme toggle and must be inline, dependency-free, and
  non-essential: with JS disabled the page renders fully in the dark default, and all
  content, anchors and links stay usable.
- Preserve the entire SEO surface: title/description (`site/index.html:7-9`), robots
  (`:10`), canonical and favicon (`:11-12`), all `og:*` (`:13-21`), all `twitter:*`
  (`:22-27`), and the parseable JSON-LD graph (`:28-58`). `site/sitemap.xml` must end
  with a zero diff.
- Do not add FAQ structured data — `test_site_contract.py:44-49` rejects retired
  `FAQPage`/`schema.org/Question` markup.
- Delete the old alternate palette at `site/index.html:647-718`; theming is now the
  explicit two-token-map system, not a `prefers-color-scheme` override of one palette.
- Keep the design export `AI CLIP ASSEMBLER Redesign APP + Landing page/` gitignored
  and never staged.
- Flat design: 1px borders and inset rings only. The handoff is explicit that the page
  uses no shadows; the shadow on the mock's outer frame is canvas presentation.

## Token map

From the handoff's token table. Same names in both themes; `dark` is the default.

| Token | Dark | Light |
| --- | --- | --- |
| `--page` | `#08090b` | `#ffffff` |
| `--surface` (bands, ruler) | `#0b0d10` | `#f7f8fa` |
| `--surface-raised` (cards, frames) | `#0d0f12` | `#fbfbfc` |
| `--tile-bg` | `#0d1116` | `#eef0f3` |
| `--border` (section rules) | `#1c2027` | `#e4e7eb` |
| `--border-strong` (cards, rings) | `#23272e` | `#dfe2e6` |
| `--border-button` | `#343a43` | `#cfd3da` |
| `--text` | `#f4f5f7` | `#1a1c20` |
| `--text-body` | `#a2a8b2` | `#52585f` |
| `--text-muted` | `#6b7280` | `#7b818a` |
| `--accent` | `#ff4d6d` | `#e11d48` |
| `--on-accent` | `#1a0308` | `#ffffff` |
| `--green` (keep) | `#5fd18b` | `#17915a` |
| `--keep-label` (KEEP text) | `#5fd18b` | `#0f6f45` |
| `--bar-seg-a` | `rgba(255,255,255,.34)` | `rgba(26,28,32,.28)` |
| `--bar-seg-b` | `rgba(255,255,255,.2)` | `rgba(26,28,32,.16)` |

Traffic-light dots are theme-independent: `#ff5f57`, `#febc2e`, `#28c840`.

### Relationship to the app's tokens — read before "aligning" anything

The landing and the app share `#08090b`, `#0d0f12`, `#f4f5f7`, `#a2a8b2`, `#6b7280`,
`#ff4d6d` and `#5fd18b` exactly. Two differences are deliberate and must NOT be
"fixed" by making the names match:

- **`--border` means different things.** The landing's `--border` is `#1c2027`, one
  step softer than the app's `--border` (`#23272e`, which the landing calls
  `--border-strong`). The names are offset by one step; the values are correct.
- **Traffic-light dots differ slightly** from the app's `--window-close` `#ff6159`,
  `--window-minimize` `#ffbd2e`, `--window-zoom` `#28c941`. The handoff's values are
  authoritative for the landing.

Everything else in `frontend/src/renderer/src/styles/tokens.css:82-106` matches.

---

### Task 1: Theme foundation, fonts, and the base layer

**Files:** Modify `site/index.html` (head at `:59-63`, style block from `:64`)

- [x] **Step 1: Delete the Google Fonts links**

  Remove `site/index.html:59-63` entirely — both preconnects and the stylesheet. Leave
  every other head element untouched.

- [x] **Step 2: Declare the self-hosted faces**

  Add `@font-face` rules pointing at the four files already in `site/fonts/`. Plex Sans
  is variable: declare it once with `font-weight: 400 700`. Plex Mono needs one rule per
  weight (400/500/600). Use `font-display: swap` and relative `url("fonts/…")` paths.

- [x] **Step 3: Build the two token maps**

  Put the dark map on `:root, :root[data-theme="dark"]` and the light map on
  `:root[data-theme="light"]`, using the table above. Set `color-scheme` per theme.
  Every subsequent rule reads tokens — no raw hex outside these two blocks, except the
  three traffic-light dots.

- [x] **Step 4: Base typography and page shell**

  Content column capped at 1440px and centred; 56px horizontal section padding. Type
  scale: 64 / 36 / 34 / 20 / 17 / 15 / 14.5 / 13.5 / 12 / 11 / 10.5 / 10. Never set body
  copy below 14.5px. `-.03em` tracking at 64px, `-.02em` at 36px, `line-height:1.03` on
  the H1, 1.55–1.6 on body. Mono labels are uppercase with `.1em`–`.18em` tracking.

- [x] **Step 5: The theme toggle**

  A single inline `<script>` in `<head>` that sets `data-theme` on `<html>` from
  `localStorage`, falling back to `prefers-color-scheme`, before first paint — this must
  run early or the page flashes. A visible control in the header switches and persists
  it. Give the control an accessible name that states the action, and keep it operable
  by keyboard. With JS disabled, `data-theme` is absent and the `:root` dark map applies.

### Task 2: Header, hero, and the contact sheet

**Files:** Modify `site/index.html`

- [x] **Step 1: Header**

  Per handoff §1: flex, `gap:28px`, `padding:20px 56px`, bottom border `--border`.
  Wordmark and "macOS" badge in mono 11px `.18em` uppercase. Nav right-aligned with
  `margin-left:auto`, `gap:26px`, 13.5px links in `--text-body` going to `--text` on
  hover. Outlined "Download" button, `padding:8px 16px`, `border-radius:8px`.
  Nav anchors must resolve: `#how-it-works`, `#local-first`, `#faq` — add those `id`s to
  the corresponding sections in Task 3 and Task 4.

- [x] **Step 2: Hero layout and left column**

  `grid-template-columns:minmax(0,1fr) 620px; gap:56px; padding:72px 56px 56px`.
  Eyebrow, H1 (accent second line, `text-wrap:balance`), 17px body at `max-width:52ch`,
  the two CTAs at `border-radius:11px`, and the two-line mono fine print. Exact specs in
  handoff §2.

- [x] **Step 3: The contact sheet — the signature element**

  Caption row, then `grid-template-columns:repeat(3,1fr); gap:10px`, six tiles at
  `aspect-ratio:16/9`, `border-radius:10px`, 1px inset ring via `box-shadow`. Each tile:
  the `<img>` at `object-fit:cover`, a top-down scrim, then a mono 10px label at
  `top:8px; left:9px`. Mapping (note the images are `.webp`, not the handoff's `.png`):

  | # | Asset | Label | Ring | Treatment |
  | --- | --- | --- | --- | --- |
  | 1 | `clip-05.webp` | `9.1 KEEP` | `--green` | full colour |
  | 2 | `clip-02.webp` | `8.6 KEEP` | `--green` | full colour |
  | 3 | `clip-01.webp` | `4.2 CUT` | `--border-strong` | `grayscale(.85); opacity:.45` |
  | 4 | `clip-03.webp` | `3.8 CUT` | `--border-strong` | `grayscale(.85); opacity:.45` |
  | 5 | `clip-04.webp` | `8.2 KEEP` | `--green` | full colour |
  | 6 | `clip-06.webp` | `FINAL WIDE` | `--accent` | full colour |

  KEEP labels green; CUT and FINAL WIDE in accent. Images are decorative: `alt=""`.
  Give every `<img>` explicit `width`/`height` so the grid does not shift while loading.
  The first row is above the fold — do NOT lazy-load tiles 1–3.

- [x] **Step 4: Assembled-cut bar**

  Per handoff §2.3: five segments at `flex:0 0 22%/16%/12%/19%` then `flex:1`, first in
  accent and the rest alternating `--bar-seg-a`/`--bar-seg-b`, each but the last with a
  1px right border in the bar's own background so the cuts read. Duration "0:23.0" in
  mono with `font-variant-numeric:tabular-nums`.

### Task 3: Ruler divider, three steps, and the app screenshot

**Files:** Modify `site/index.html`

- [x] **Step 1: Timeline-ruler divider**

  Handoff §3: `height:56px`, top/bottom borders, `--surface` background, a
  `repeating-linear-gradient` tick every 24px, a 2px accent playhead at `left:24%`, and
  the two mono labels "00:00 · IMPORT" and "02:47 · EXPORT".

- [x] **Step 2: Three steps**

  `id="how-it-works"`. `grid-template-columns:repeat(3,1fr); gap:40px; padding:64px 56px`.
  Mono 34px accent numeral, 20px/600 title, 14.5px body. Use the handoff's §4 copy
  verbatim — it is already accurate about the shipped app.

- [x] **Step 3: macOS window frame**

  Handoff §5: `border-radius:14px`, title bar with the three dots and the mono title
  "AI Clip Assembler — Review", then the screenshot well.

- [x] **Step 4: Screenshot sources**

  The real captures are maintainer-owned (Task 6) and now exist as WebP assets. The well
  retains the `--tile-bg` fallback and mono captions, wires both `review-dark` and
  `review-light` sources switched with the theme, and gives each image real alt text
  describing the Review screen. `loading="lazy"` here is correct — it is below the fold.

### Task 4: Retained sections and the closing band

**Files:** Modify `site/index.html`

- [x] **Step 1: Restyle "Local-first, by decision"**

  `id="local-first"`. Keep the existing three-column content and its copy; re-express it
  in the new tokens and type scale. This section carries contract-tested copy — do not
  reword "cloud AI is opt-in per project", "external AI assistant", or "external
  provider's privacy policy".

- [x] **Step 2: Restyle the FAQ**

  `id="faq"`. Keep all four existing questions and answers; restyle only. The answers
  carry the contract-tested "EDL"/"flatten" export-boundary copy.

- [x] **Step 3: Closing download band**

  Handoff §6: `padding:56px`, top border, `--surface` background, H2 "Try it on your last
  flight" at 36px/700, supporting line, and the two CTAs right-aligned via `margin-left:auto`.

- [x] **Step 4: Footer**

  Keep the existing footer links; restyle to the new tokens.

- [x] **Step 5: Reconcile the four workflow rows**

  The handoff's three steps replace the current four screenshot rows. Those rows and
  obsolete assets were removed after confirming that no other page, the sitemap, or the
  JSON-LD `screenshot` field referenced them; JSON-LD now points to the new Review WebP.

### Task 5: Interaction, responsive, and motion

**Files:** Modify `site/index.html`

- [x] **Step 1: Hover and focus states**

  Filled accent buttons darken ~8% (`#f03a5c` dark, `#c81540` light); outlined buttons
  take accent border and text; nav links go to `--text`. Transition `140ms ease-out` on
  `background-color`, `border-color`, `color`. Every interactive element needs a visible
  focus ring that is not `outline:none` — the current page must not regress here.

- [x] **Step 2: CUT tile hover reveal**

  On hover, CUT tiles animate to `grayscale(0)/opacity:1` over 200ms. No lift, no shadow.

- [x] **Step 3: Entrance stagger (intentionally skipped)**

  Tiles fade and rise (`opacity 0→1`, `translateY(8px)→0`), staggered 60ms in grid order,
  320ms `cubic-bezier(.2,.7,.3,1)`. **Must be CSS-only** given the JS constraint, and must
  render the final state immediately under `prefers-reduced-motion: reduce`. If a CSS-only
  version would leave content invisible when animations do not run, skip this step
  entirely and record why — never trade content visibility for an entrance effect. This
  step was intentionally skipped: the CSS-only animation added no value and could make
  content invisible when animations are disabled or unavailable.

- [x] **Step 4: Responsive rules**

  From handoff §"Responsive behavior": ≥1440 as specified; 1024–1439 fluid with 40px
  padding, hero right column to `minmax(0,1fr)`, H1 ~52px; 768–1023 hero stacks copy-first,
  H1 ~44px, steps to two then one column, screenshot well to `aspect-ratio:16/10`;
  <768 padding 24px, H1 ~34px, CTAs full-width stacked at 12px gap, contact sheet to
  `repeat(2,1fr)`, ruler to 44px with 9.5px labels, closing band stacked.
  **The tile grid never drops below two columns.**

### Task 6: Screenshot capture — MAINTAINER-OWNED (complete)

Not agent-executable. Completed by the maintainer with the redesigned app and sanitized
fixture footage; both 2880×2080 (2× 1440×1040) captures are WebP and contain no personal
paths, personal filenames, faces, or locations; only generic fixture media labels are
visible.

- [x] Capture the Review screen at ≥1328×1040, 2× retina, in **dark** appearance → `site/img/review-dark.webp`
- [x] Capture the same screen in **light** appearance → `site/img/review-light.webp`
- [x] Confirm no personal paths, filenames, faces or locations are legible in either
- [x] Re-encode both to WebP and confirm the well renders them without distortion
- [x] Repoint the JSON-LD `screenshot` field and verify the contract test still passes

### Task 7: Verification

- [x] **Step 1: Contract and diff**

  ```bash
  python3 scripts/tests/test_site_contract.py -v
  git diff --stat -- site/            # sitemap.xml must show no diff
  ```

- [x] **Step 2: Network isolation**

  ```bash
  rg -n "fonts\.googleapis\.com|fonts\.gstatic\.com|preconnect|@import" site/index.html
  ```

  Expected: no output. Then load the page with DevTools Network open and confirm no
  third-party origin is requested on a hard reload.

- [x] **Step 3: Measured contrast — compute, do not assert**

  Report actual ratios for both themes and state pass/fail against AA (4.5:1 body,
  3:1 large text and UI). At minimum: `--text`, `--text-body` and `--text-muted` on
  `--page` and on `--surface`; `--accent` on `--page`; `--on-accent` on `--accent`;
  `--green` on `--tile-bg`. `--text-muted` on `--page` is the pair most likely to fail —
  if it does, darken the surface or lighten the muted tone and record the substitution.
  Do not change `--accent` itself.

  Recorded WCAG 2.x ratios (foreground on background, rounded to two decimals):

  | Pair | Dark | Light |
  | --- | ---: | ---: |
  | `--text` on `--page` | 18.26:1 | 17.06:1 |
  | `--text` on `--surface` | 17.84:1 | 16.06:1 |
  | `--text-body` on `--page` | 8.33:1 | 7.19:1 |
  | `--text-body` on `--surface` | 8.14:1 | 6.77:1 |
  | `--text-muted` on `--page` | 4.67:1 | 4.80:1 |
  | `--text-muted` on `--surface` | 4.56:1 | 4.52:1 |
  | `--accent` on `--page` | 6.20:1 | 4.70:1 |
  | `--on-accent` on `--accent` | 6.16:1 | 4.70:1 |
  | `--green` ring on `--tile-bg` | 9.90:1 | 3.51:1 |
  | `--keep-label` on `--tile-bg` | 9.90:1 | 5.44:1 |

  The dark `--text-muted` substitution is `#747b86` (from `#6b7280`); the light
  substitution is `#6b737d` (from `#7b818a`). Both pass 4.5:1 on page and surface.
  `--green` remains unchanged for KEEP rings; its light 3.51:1 ratio passes the 3:1
  UI threshold but not normal-text AA, so KEEP labels use the dedicated `--keep-label`
  token (`#5fd18b` dark / `#0f6f45` light), which passes 4.5:1 in both themes.

- [x] **Step 4: Human checks**

  There is no automated visual, responsive, or accessibility suite for `site/`; the only
  CI gate is `.github/workflows/test-site.yml` running the static contract. So these are
  eyes-only and must actually be done: both themes at 1440 / 1200 / 900 / 500 / 390px;
  keyboard-only traversal with visible focus throughout; the page with JS disabled;
  the page with `prefers-reduced-motion: reduce`; and a check that the fallback font
  does not break the 64px headline's wrapping. These visual and interaction checks were
  completed for both themes and the required viewports; the captured Review wells and
  responsive landing renders were inspected, including keyboard focus, no-JS, and
  reduced-motion states.

### Completion evidence

- `site/img/review-dark.webp` and `site/img/review-light.webp` are the sanitized 2880×2080
  WebP captures used by the page and JSON-LD metadata.
- The entrance stagger is intentionally skipped because a CSS-only animation would add
  no value and could leave content invisible when animation is disabled or unavailable.
- `python3 -m unittest scripts.tests.test_site_contract` passes all 6 tests; `git diff --check`
  passes; and the forbidden-network grep for Google Fonts, preconnect, and `@import`
  returns no output. `site/sitemap.xml` remains unchanged.

## Risks and open questions

- **Screenshot capture is human-gated** and blocks Task 6 only. Everything else can land
  first with the placeholder well, so the restyle is not held hostage to it.
- **Most-visitors typography is now guaranteed** by self-hosting, removing the fallback
  risk that the earlier font-stack approach carried.
- **The theme toggle adds the page's first real JavaScript.** Keep it to a few lines and
  ensure the no-JS path is the dark default, or the page becomes fragile for no gain.
- **Removing the four workflow screenshots loses depicted detail** the current page has —
  three views on Import, three on Review, the Timeline inspector. The handoff trades that
  breadth for one strong Review shot. If that reads as underselling once built, the fix is
  copy in the three steps, not smuggling the old rows back.
- **No automated coverage for visual regression** on `site/` means a plausible-looking
  diff can still ship a broken 390px layout or an invisible focus ring. The human checks
  in Task 7 Step 4 are the only defence.
