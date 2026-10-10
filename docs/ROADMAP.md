# Roadmap to v1.0.0

The order of work from v0.4.0 to a stable Mac **v1.0.0**. Plans in
[`plans/`](plans/) hold the tasks; this file holds the order, the scope line and
why. Agreed with the owner on 2026-10-08, after a product review that compared
every plan against the code (see the decision records
[0007](adr/0007-ai-access-is-granted-when-connecting.md) and
[0008](adr/0008-ai-runs-through-the-editors-own-provider-program.md)).

## v1.0.0 in one line

A signed, notarized Mac app that turns a folder of footage into a good first cut
with no AI, exports a timeline that opens in DaVinci Resolve and Final Cut Pro,
and, once the Editor connects their own Claude or ChatGPT, refines that cut
through Scripts they preview and apply, with honest errors and Markers and Story
Sections that carry the story into the editing app.

**Who it is for:** a hobbyist with hours of drone or travel footage and basic
editing skills, who never opens a terminal. Semi-pro creators use it too, but
no screen is designed around them.

## Product rules every milestone keeps

- The app is fully useful without AI: rule-based first cut, Review, the
  Editor's own Scripts. AI is the upgrade.
- AI is the Editor's own subscription: **Claude** (through Claude Code) or
  **ChatGPT** (through Codex). The app never installs, bundles or signs in to
  those programs itself; it finds them, links to them, and starts their own
  sign-in. No API keys in v1.0.0. Pi is removed once Codex works.
- **Connect and allow** grants AI Access once, for every project; each project
  has an **AI: On / Off** switch. Only Frame Samples, file names (never folder
  paths), clip timings and scores, the Timeline and the chat are sent. Video
  files are never uploaded.
- Errors say what happened and what to do: which limit was hit and when it
  resets, earlier suggestions kept, no made-up Versions.
- Every AI edit is a Proposal the Editor previews and applies; applying is one
  undo step.
- Free and open source.

## Milestones

Sizes: S = hours, M = days, L = a week or more of agent work.

| # | Milestone | What the owner sees | Size | Plan |
|---|---|---|---|---|
| 0 | **Baseline** | Plans, glossary and decision records match the product; open PRs merged | S | 035 Phase 2, this file |
| 1 | **A first cut worth keeping, without AI** | More and longer Candidate Clips per Source Video; Medium and Long edits fill their target | S–M | [037](plans/037-extraction-quality.md) (includes the cross-video quota fix from 027) |
| 1b | **Exports that open** (alongside 1) | FCPXML opens in Final Cut, Resolve XML in Resolve, without relinking; automated checks guard both | M | [032](plans/032-valid-fcpxml-and-nle-verification.md) |
| 1c | **iPhone footage end to end** (after 1b) | Phone clips export at 59.94 in shooting order, upright; Review and Timeline previews fit vertical video; exports are named after the Project | S–M | [041](plans/041-iphone-footage.md) |
| 2 | **Honest AI errors** | "ChatGPT limit reached, resets 14:00 — your earlier suggestions are kept"; nothing beyond Frame Samples and text leaves the Mac | M | [038](plans/038-ai-connection.md) Phases 1–2 (replaces [030](plans/done/030-truthful-ai-usage.md)'s remainder) |
| 3 | **Connect Claude or ChatGPT** | A welcome wizard and a Providers screen like T3 Code's: installed → signed in → ready, with Download, Sign in and Check again; Connect and allow; AI On / Off per project | L | [038](plans/038-ai-connection.md) Phases 3–6 |
| 4 | **The AI edits like a Resolve console** | Ask for a story cut; the AI looks across the whole library, runs its Script, fixes its own errors, and shows one Proposal; Apply puts it on the Timeline | L | [review-visual-editing](plans/review-visual-editing.md) (absorbs agent-operable-timeline) |
| 5 | **Story in the edit** | The AI and the Editor add Markers, notes and Story Sections; they export as markers to Resolve and Final Cut | M–L | [039](plans/039-story.md) |
| 6 | **Find more clips** | A button beside each Source Video: More clips / Longer clips; the Timeline stays as it is | M | [019](plans/019-clip-library-generation-and-expansion.md) |
| 7 | **Trusted release** | Opens on a clean Mac with no Privacy & Security detour; updates install themselves; **v1.0.0** | L | [033](plans/033-in-app-updates-and-a-trusted-build.md), [self-contained-runtime-tools](plans/self-contained-runtime-tools.md) |

### Why this order

- **1 first:** extraction is the first impression and needs no AI. Every later
  milestone is tested against a real Candidate Clip library, so it has to be
  good. Measure before and after on
  `~/Movies/DRONE_VIDEO/ESTEPONA_03-05-26` (four DJI files, 1.7 GB): candidate
  count, median length, and how full each edit gets.
- **1b beside 1:** export is the product's last step and is independent code.
  Media paths are absolute (owner decision).
- **1c after 1b:** the owner's own footage is iPhone video; a real-footage run
  on 2026-10-10 showed 1b's frame-rate rule and the capture time both break on
  phone VFR, so it lands before any AI milestone is tested on that footage.
- **2 before 3:** one AI seam with typed failures and a locked-down payload is
  the interface Claude Code and Codex plug into; doing it on today's path first
  makes the visible honesty win early and the vendor work a pure addition.
- **3 before 4:** the repair loop multiplies AI calls; it should be built on the
  real vendor programs and real quota errors, not tuned on a path that is going
  away.
- **5 after 4:** Markers and Story Sections are new Operations and Script API
  calls the AI uses; the loop has to work first.
- **6 after 1:** Find more clips needs the multi-window selector from 1, or it
  returns the same clip again.
- **7 last, started early:** signing a bundle with a Python backend and FFmpeg
  takes its own sessions; enrollment is the owner's call and comes later.

## Owner actions

- Accept Anthropic's Commercial Terms before milestone 3 ships (decided: yes).
- Manual QA of exports in DaVinci Resolve and Final Cut Pro (milestone 1b, then
  every release); Final Cut Pro access is needed for that.
- Apple Developer Program enrollment, 99 USD a year, before milestone 7.
- A sponsorship link (e.g. Buy Me a Coffee), set up outside this repo.
- More test-footage folders beyond Estepona as milestones need them.

## After v1.0.0

- BPM-assisted cutting to music (v1.1).
- Windows ([#88](https://github.com/evilkels/ai-clip-assembler/issues/88)) and
  Linux ([#89](https://github.com/evilkels/ai-clip-assembler/issues/89)).
- API keys as an advanced option.
- Bundled SigLIP and diverse edits ([025](plans/later/025-bundle-siglip-embedding-model.md),
  [027](plans/later/027-authoritative-candidate-library-and-diverse-edits.md) beyond the quota fix).
- A playable preview of a Proposal before Apply, if it does not fit milestone 4.

## Not in v1.0.0

Windows and Linux, API keys, Premiere-specific exports (EDL stays best-effort),
titles, transitions and colour (they belong in the editing app), token
streaming in chat, the 023 icon re-cut, shell follow-ups (Cmd-K, context menu),
the SEO pilot, and MCP as a first-class path (it stays in Settings for people
who drive the app from Claude Desktop or Codex, with "your client, your
traffic" wording).
