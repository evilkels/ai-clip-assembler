# Handoff: AI Clip Assembler — Landing Page Redesign

## Overview

A marketing landing page for AI Clip Assembler, a free, local-first macOS app that scores raw
drone/camera footage (sharpness, motion stability, exposure) and exports an editable timeline
(DaVinci Resolve XML, Final Cut Pro FCPXML, or EDL).

The design's premise: the product's *judgment* is the hero. Instead of a decorative hero image,
the fold shows a real scoring pass — six 16:9 frames from actual footage, each labelled with a
score and a KEEP/CUT verdict, with the kept frames in full colour and the cut frames desaturated.
Below the fold: a timeline-ruler divider, a three-step explanation, an app screenshot in a macOS
window frame, and a closing download band.

Two themes are provided, same layout and structure in both:

- **Reference A — dark theme.** The primary direction. Ship this as the default.
- **Reference B — light theme.** Identical layout on the light token set, for a theme toggle or
  a light-preferring brand context.

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes that show the
intended look, structure, and copy. They are **not production code to copy directly**. There are
no components, no responsive breakpoints, and every style is inline at a fixed 1440px width so
the mock reads correctly as a static reference.

The task is to **recreate these designs in the target codebase's existing environment** (React,
Next.js, Astro, Vue, plain HTML/CSS — whatever the site already uses), using its established
component patterns, styling system, and asset pipeline. If no environment exists yet, choose the
framework most appropriate for a static marketing site and implement there.

Concretely, that means: replace the inline styles with the codebase's styling approach (CSS
modules / Tailwind / styled-components), lift the repeated pieces into components (`<ScoreTile>`,
`<StepCard>`, `<DownloadButtons>`, `<MacWindow>`), and add the responsive behaviour described
below, which the mock does not contain.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and copy are final. Recreate the desktop layout
pixel-accurately at 1440px, then apply the responsive rules in the "Responsive behavior" section
for narrower viewports. Every hex value, font size, and spacing figure in this document is exact
and taken from the reference file.

## Screens / Views

There is one page. It is described here section by section, top to bottom.

Page shell: fixed content width **1440px**, horizontal padding **56px** on every section
(so the content column is 1328px). Page background is the theme's page surface; the page mock in
the reference file also carries a 1px border and a drop shadow — those exist only to seat the mock
on the review canvas and should **not** be reproduced.

Both themes are given as `dark → light` pairs below.

---

### 1. Header

**Purpose:** wordmark, platform badge, thin nav, primary download affordance.

**Layout:** `display:flex; align-items:center; gap:28px; padding:20px 56px;`
bottom border `1px solid #1c2027 → #e4e7eb`.
Nav is pushed right with `margin-left:auto`, `display:flex; align-items:center; gap:26px`.

**Components**

| Element | Spec |
| --- | --- |
| Wordmark "AI Clip Assembler" | IBM Plex Mono, 11px, `letter-spacing:.18em`, uppercase, `#f4f5f7 → #1a1c20` |
| "macOS" badge | IBM Plex Mono, 11px, `.18em`, uppercase, `#6b7280 → #7b818a` |
| Nav links: How it works · Local-first · FAQ · GitHub | IBM Plex Sans, 13.5px, `#a2a8b2 → #52585f`; hover → primary text color |
| "Download" button | `padding:8px 16px`, `border:1px solid #ff4d6d → #e11d48`, `border-radius:8px`, text same as border color, `font-weight:600` |

---

### 2. Hero

**Purpose:** state what the app does and prove it in the same view.

**Layout:** two columns —
`display:grid; grid-template-columns:minmax(0,1fr) 620px; gap:56px; padding:72px 56px 56px; align-items:center;`
Left column `display:grid; gap:26px`. Right column `display:grid; gap:14px`.

**Left column**

| Element | Spec |
| --- | --- |
| Eyebrow "Local-first editor · free & open source" | IBM Plex Mono, 11px, `.18em`, uppercase, `#ff4d6d → #e11d48` |
| H1 | IBM Plex Sans 700, **64px**, `line-height:1.03`, `letter-spacing:-.03em`, `text-wrap:balance`. Copy: "Turn hours of drone footage" / line break / "into a cut worth keeping." — the second line is the accent color |
| Body paragraph | 17px, `line-height:1.55`, `max-width:52ch`, `#a2a8b2 → #52585f` |
| Primary CTA "Download for macOS" | `padding:15px 26px`, `border-radius:11px`, background accent, label `#1a0308 → #ffffff`, 15px, 600 |
| Secondary CTA "See how it works" | `padding:15px 26px`, `border-radius:11px`, `border:1px solid #343a43 → #cfd3da`, primary text color, 15px |
| Fine print "Apple Silicon & Intel / no Python, no terminal" | IBM Plex Mono, 11px, `line-height:1.5`, `#6b7280 → #7b818a`, `<br>` between the two lines |

CTA row: `display:flex; align-items:center; gap:14px`.

**Right column — the contact sheet (the signature element)**

1. **Caption row.** `display:flex; justify-content:space-between`, IBM Plex Mono 10.5px, `.14em`,
   uppercase. Left: "Scoring pass · 1 folder · 16 candidates" in `#6b7280 → #7b818a`.
   Right: "11 kept" in `#5fd18b → #17915a`.

2. **Tile grid.** `display:grid; grid-template-columns:repeat(3,1fr); gap:10px` — 6 tiles, two rows.
   Each tile: `position:relative; aspect-ratio:16/9; border-radius:10px; overflow:hidden;`
   background `#0d1116 → #eef0f3`, and a 1px inset ring via
   `box-shadow: inset 0 0 0 1px <ring>`.

   Inside each tile, in order:
   - `<img>` absolutely filling the tile, `object-fit:cover`
   - a scrim span, `position:absolute; inset:0;`
     `background: linear-gradient(to bottom, rgba(8,9,11,.55) 0%, rgba(8,9,11,0) 45%)`
     → light theme: `rgba(255,255,255,.78) → rgba(255,255,255,0)`
   - a label span at `top:8px; left:9px`, IBM Plex Mono 10px

   Tile-by-tile:

   | # | Asset | Label | Ring | Image treatment |
   | --- | --- | --- | --- | --- |
   | 1 | `clip-05.png` | `9.1 KEEP` | `#5fd18b → #17915a` | full color |
   | 2 | `clip-02.png` | `8.6 KEEP` | `#5fd18b → #17915a` | full color |
   | 3 | `clip-01.png` | `4.2 CUT` | `#23272e → #dfe2e6` | `filter:grayscale(.85); opacity:.45` |
   | 4 | `clip-03.png` | `3.8 CUT` | `#23272e → #dfe2e6` | `filter:grayscale(.85); opacity:.45` |
   | 5 | `clip-04.png` | `8.2 KEEP` | `#5fd18b → #17915a` | full color |
   | 6 | `clip-06.png` | `FINAL WIDE` | `#ff4d6d → #e11d48` | full color |

   KEEP labels use the green, CUT and FINAL WIDE labels use the accent.

3. **Assembled-cut bar.** `display:flex; align-items:center; gap:10px; padding:12px 14px;`
   `border:1px solid #23272e → #dfe2e6; border-radius:10px;` background `#0d0f12 → #fbfbfc`.
   - Label "Assembled cut": IBM Plex Mono 10.5px, `.12em`, uppercase, muted
   - Bar: `flex:1; display:flex; height:10px; border-radius:3px; overflow:hidden`, five segments with
     `flex:0 0 22% / 16% / 12% / 19%` then `flex:1`; first segment is the accent, the rest alternate
     `rgba(255,255,255,.34)` and `rgba(255,255,255,.2)`
     (light: `rgba(26,28,32,.28)` / `rgba(26,28,32,.16)`); each segment except the last has a 1px
     right border in the bar's own background color, which reads as the cut lines
   - Duration "0:23.0": IBM Plex Mono 11px, `font-variant-numeric:tabular-nums`, `#a2a8b2 → #52585f`

---

### 3. Timeline-ruler divider

**Purpose:** a section break in the product's own visual language; it repeats the app's timeline ruler.

**Layout:** `display:flex; align-items:flex-end; height:56px; padding:0 56px; position:relative;`
top and bottom border `1px solid #1c2027 → #e4e7eb`, background `#0b0d10 → #f7f8fa`.

- Tick strip: absolutely positioned `left:56px; right:56px; bottom:0; height:26px`,
  `background: repeating-linear-gradient(90deg, #23272e 0 1px, transparent 1px 24px)`
  (light: `#dfe2e6`) — a 1px tick every 24px.
- Playhead: absolute at `left:24%; top:8px; bottom:0; width:2px`, accent color.
- Two labels, IBM Plex Mono 10.5px, `letter-spacing:.1em`, muted, `padding-bottom:30px`:
  "00:00 · IMPORT" at the left, "02:47 · EXPORT" pushed right with `margin-left:auto`.

---

### 4. Three steps

**Layout:** `display:grid; grid-template-columns:repeat(3,1fr); gap:40px; padding:64px 56px;`
each cell `display:grid; gap:10px; align-content:start`.

Per step: a number (IBM Plex Mono, **34px**, 600, accent), a title (IBM Plex Sans, 20px, 600),
and a paragraph (14.5px, `line-height:1.6`, `#a2a8b2 → #52585f`).

Copy, verbatim:

**01 — Drop in the raw files**
Point it at a folder of MP4/MOV files. Each video is probed for duration, frame rate, and codec,
then analyzed for stable, interesting moments — scene by scene, on your own hardware.

**02 — Review clips. Build a montage.**
Every candidate arrives with scores and a reason. Include the keepers, exclude the rest, then ask
the optional AI agent for editable versions and apply one to the Timeline.

**03 — Hand off, don't lock in**
Export a real, editable timeline — DaVinci Resolve XML, Final Cut Pro FCPXML, or plain EDL — with
media paths that survive moving the project folder.

---

### 5. App screenshot in a macOS window

**Purpose:** show the actual product.

**Layout:** section `padding:0 56px 64px`. Inner frame:
`border:1px solid #23272e → #dfe2e6; border-radius:14px; overflow:hidden;`
background `#0d0f12 → #fbfbfc`.

- Title bar: `display:flex; align-items:center; gap:8px; padding:12px 16px;`
  bottom border 1px in the frame border color. Three 11px circles,
  `#ff5f57`, `#febc2e`, `#28c840` (unchanged in both themes), then the window title
  `margin-left:14px`, IBM Plex Mono 11px, muted: "AI Clip Assembler — Review".
- Screenshot well: `width:100%; height:520px`, image `object-fit:cover`.

In the reference file this well is a labelled placeholder (`data-asset="review-dark.png"` /
`review-light.png`). **The real screenshots are not in this bundle** — capture them from the app
(Review screen, both themes, 2× retina, 1328×1040 or larger) and drop them in.

---

### 6. Closing download band

**Layout:** `display:flex; align-items:center; gap:32px; padding:56px;`
top border `1px solid #1c2027 → #e4e7eb`, background `#0b0d10 → #f7f8fa`.

- Left: H2 "Try it on your last flight" — IBM Plex Sans 700, 36px, `letter-spacing:-.02em`; below it
  "Free and open source. Drop in a folder of clips and see what it finds." at 15px, `#a2a8b2 → #52585f`.
  Wrapper `display:grid; gap:8px`.
- Right (`margin-left:auto`, `display:flex; gap:14px`): "Download for macOS" (filled accent) and
  "View on GitHub" (outlined) — identical specs to the hero CTAs.

---

## Interactions & Behavior

The mock is static. Implement these:

- **Nav links** — anchor scroll to the corresponding sections (`#how-it-works`, `#local-first`,
  `#faq`); "GitHub" and "View on GitHub" open the repository in a new tab.
- **Download buttons** (three on the page: header, hero, closing band) — all point at the same
  release asset. Detect Apple Silicon vs Intel if the release ships separate builds; otherwise a
  universal DMG and the fine print already covers it.
- **Hover states** — not specified in the mock, so keep them restrained and consistent:
  filled accent buttons darken ~8% (`#ff4d6d → #f03a5c` dark, `#e11d48 → #c81540` light);
  outlined buttons take the accent border and accent text; nav links move to the primary text
  color. Transition `140ms ease-out` on `background-color`, `border-color`, `color`.
- **Score tiles** — optional and worth doing: on hover, a CUT tile animates from
  `grayscale(.85)/opacity:.45` to `grayscale(0)/opacity:1` over 200ms, revealing what was rejected.
  Do not add a hover lift or shadow; the grid should stay flat.
- **Contact sheet reveal** — optional entrance: tiles fade+rise (`opacity 0→1`,
  `translateY(8px)→0`) staggered 60ms in grid order, 320ms `cubic-bezier(.2,.7,.3,1)`.
  Respect `prefers-reduced-motion: reduce` by rendering the final state immediately.
- **Images** — the six frames are decorative; `alt=""` and `loading="lazy"` for everything below
  the first row. The app screenshot should be `loading="lazy"` too.

### Responsive behavior

Not in the mock — derive it as follows.

- **≥1440px:** as specified; cap the content column at 1440px and center it.
- **1024–1439px:** fluid; section padding 56px → 40px; hero right column loses its fixed 620px and
  becomes `minmax(0,1fr)` (so 1fr/1fr); H1 scales to ~52px.
- **768–1023px:** hero stacks to one column (copy first, contact sheet below); H1 ~44px; the three
  steps become two columns, then one; screenshot well height 520px → `aspect-ratio:16/10`.
- **<768px:** section padding 24px; H1 ~34px; CTAs full-width stacked with 12px gap; contact sheet
  goes to `repeat(2,1fr)`; the timeline divider keeps its ruler but drops to `height:44px` and its
  two labels shrink to 9.5px; closing band stacks (heading then buttons).
- The tile grid must never drop below two columns — one column loses the "many clips scored" read.

## State Management

Effectively none — this is a static marketing page. The only stateful pieces:

- `theme: 'dark' | 'light'` — if a theme toggle ships. Default **dark**, persist the user's choice,
  initialize from `prefers-color-scheme`. Both themes are fully specified below as token sets, so
  implement them as two token maps on one markup tree, not two page templates.
- Optional `hasAnimated: boolean` per animated group, so the entrance stagger runs once.

## Design Tokens

Same token names in both themes. `dark` is the primary.

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
| `--scrim` | `rgba(8,9,11,.55) → transparent` | `rgba(255,255,255,.78) → transparent` |
| `--bar-seg-a` | `rgba(255,255,255,.34)` | `rgba(26,28,32,.28)` |
| `--bar-seg-b` | `rgba(255,255,255,.2)` | `rgba(26,28,32,.16)` |

Traffic-light dots are theme-independent: `#ff5f57`, `#febc2e`, `#28c840`.

**Typography.** Two families, both IBM Plex (Google Fonts):
`IBM Plex Sans` weights 400/500/600/700 for prose and UI, `IBM Plex Mono` 400/500/600 for
eyebrows, labels, metadata, and numbers. Mono labels are always uppercase with wide tracking
(`.1em`–`.18em`).

Scale in use: 64 / 36 / 34 (mono numeral) / 20 / 17 / 15 / 14.5 / 13.5 / 12 / 11 / 10.5 / 10.
Tight negative tracking on display sizes (`-.03em` at 64px, `-.02em` at 36px), `line-height:1.03`
on the H1, `1.55`–`1.6` on body copy. Never set body copy below 14.5px.

**Spacing.** 4px base. Values actually used: 8, 10, 14, 26, 28, 32, 40, 56, 64, 72.
Section padding is 56px horizontal; vertical rhythm is 56–72px between major sections.

**Radii.** 8px (small buttons, inputs) · 10px (tiles, bars) · 11px (CTA buttons) · 14px (window frame)
· 999px (pills) · 3px (timeline bar segments).

**Shadows.** The page itself uses none. Keep it flat — the design relies on 1px borders and inset
rings, not elevation. (The shadow on the mock's outer frame is canvas presentation only.)

## Assets

- `assets/clip-01.png` … `clip-06.png` — the six 16:9 contact-sheet frames, cropped from screenshots
  of the app's Review screen supplied by the project owner. Included in this bundle. Sizes are
  ~760×428; re-export at 2× from source footage if the site needs retina crispness.
- **Missing:** the two app screenshots for the macOS window section (`review-dark.png`,
  `review-light.png`). Placeholders are marked in the reference HTML with `data-asset` attributes.
- Fonts: IBM Plex Sans + IBM Plex Mono, loaded from Google Fonts in the reference file. Self-host
  in production; subset to Latin.
- No icon set is used. The only glyphs are the mono "·" separators and an "→" in a CTA elsewhere in
  the app. Do not introduce an icon library for this page.

## Files

- `landing-page-reference.html` — the design reference. Contains both themes stacked on one canvas:
  "Reference A" is the dark page, "Reference B" the light page. Open it in a browser at ≥1440px.
  Every style is inline; read it as a spec, not as source.
- `assets/clip-01.png` … `clip-06.png` — contact-sheet frames, referenced by the HTML.

The full design system this page draws from (color, surfaces, controls, type scale, interaction
states) and the four app screens (Import, Review, Timeline, Export) live in the source project as
`Clip Assembler Restyle.dc.html`. Ask the project owner for it if the implementation needs to match
the app UI beyond this page.
