# Landing Page Editorial Refresh

## Status

Approved for implementation on 2026-07-10.

## Goal

Make the public landing page feel like it belongs with the project cover art
while making the editor workflow legible at a glance.

## Visual direction

The site borrows the cover's visual language rather than reproducing the cover
as a hero image:

- soft paper-grey background;
- graphite and navy editorial typography;
- signal-red nodes and accents;
- faint connected-node artwork behind the hero copy;
- the existing application icon used as a small product mark.

The hero remains copy-first. It must state the editor's outcome, keep the
macOS download as the primary action, and avoid an oversized decorative image
that competes with the product proof.

## Product proof

Each Import, Review, Timeline, and Export screenshot is displayed in a wider
right-hand visual column on desktop, with a concise explanation at left. On
mobile the copy precedes a full-width screenshot. Screenshots must remain
clear enough to communicate the app's real controls, not merely function as
texture.

The Review step explicitly communicates the sequence: score and explain
Candidate Clips, include/exclude them, use the optional AI agent to propose
editable montage Versions, compare those Versions, and apply the selected one
to the Timeline.

## Appearance

The landing page follows `prefers-color-scheme` automatically. Light mode uses
the cover-inspired paper background; dark mode preserves the same graphite,
navy, and signal-red system against a dark editor-like field. There is no
manual theme switch on this static page.

## Copy constraints

- Describe the default as local analysis and rule-based mode; do not imply
  cloud AI is always active.
- Preserve the editable-timeline and local-first promises.
- Keep external actions limited to the existing GitHub release and repository
  links.

## Verification

- Open `site/index.html` through a local HTTP server.
- Review a full desktop screenshot and a 390px-wide mobile screenshot.
- Confirm the page has no browser errors and that its release/repository links
  still resolve.
