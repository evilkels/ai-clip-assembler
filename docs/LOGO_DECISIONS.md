# Logo Decisions — AI Clip Assembler

**Decision date:** 2026-06-27
**Asset status:** v1 locked, ready for v2 visual exploration

## Final choice

**Variant A — "Cut the chaos"** (precise 3D material version)

- `assets/logo.png` — main logo, 1024×1024 transparent background
- `assets/icon.png` — square app icon, same source file

## Concept

The logo combines three elements as a single visual story:

- **🎞️ Film strip** — raw footage / input material
- **🧠 Neural network (15–25 nodes)** — AI-assisted first pass
- **✂️ Precise geometric scissors** — the "cut" action, automated first assembly

The neural network fills ~70% of the background as ambient context, the scissors and film strip are the focal point floating above with subtle 3D material rendering.

## Style rules (locked for v1)

- **Background:** light gray (`#E5E7EB`) — clean Apple light-mode aesthetic
- **Foreground:** dark charcoal (`#1F2937` family) for scissors, film strip, and most network nodes
- **Accent:** red (single dot or marker) for AI-selected cut decisions
- **Rendering:** material 3D with subtle highlights and shadows, not flat 2D
- **No text** in the icon itself
- **No camera lens, no cloud symbol** — explicitly avoided to reinforce local-first positioning

## Variant history (3 explored directions)

### A — "Cut the chaos" ✅ CHOSEN
Scissors cut through a curved film strip; neural network fills the background as ambient pattern.

### B — "Mind the timeline" (rejected)
Brain at the top, film strip at the bottom, scissors as a bridge. Too busy, two clear focal points, weaker read at small sizes.

### C — "AI film strip" (rejected)
Each film frame contains brain nodes, scissors at the cut point. Most "technical" feel but reads as documentation rather than brand mark.

## Iteration log (A variant)

1. **v1** — charcoal background, off-white shapes. Functional but too generic.
2. **v2** — split into navy + light gray backgrounds. Light gray preferred.
3. **v3** — increased neural network density to ~70% background coverage.
4. **v4 (final)** — precise geometric scissors with material 3D rendering, dark charcoal on light gray, drop shadow for depth.

## Asset checklist status

- [x] `assets/logo.png` — main project logo
- [x] `assets/icon.png` — square app icon (same source)
- [ ] `assets/social-preview.png` — GitHub repository social preview, 1280×640
- [ ] `assets/readme-hero.png` — optional README hero image
- [ ] `assets/screenshots/` — real app screenshots once UI is public

## Next steps (v2 if needed)

- Explore wordmark variant (horizontal logo with text)
- Explore OS project mark (cleaner symbol without scissors/film strip, for small-size contexts)
- Generate README hero and social preview using the same color palette
