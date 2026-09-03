# Plan 031: App restyle conformance — the sections the build has not caught up to

Status: PHASE 1 DONE (2026-09-03) · PHASES 2-6 TODO · Priority P2 · Effort L · Risk MED · Category UI conformance
Written against `04c1bdb`, 2026-09-03. Source of truth is the
**Clip Assembler Restyle** handoff, checked in at
[`docs/design/2026-09-03-app-restyle-handoff.md`](../design/2026-09-03-app-restyle-handoff.md),
plus its companion `app-reference.dc.html` — reference ids `4a` `4b` `1d` `1b`
`3a` `3b` `6a` `6b` `6c` `5a` `5b`. Where the two disagree, **the reference file
wins**; it is not staged (see the note at the top of the handoff), so unpack the
supplied export outside the repo and open it at >=1440px.

> **For agentic workers:** phases are ordered and each step has its own
> verification. Read "Already conformant" before starting anything — most of
> this design is already shipped, and re-doing it is the main risk here.

## Why

The restyle was applied to this codebase in two earlier passes
([studio-workflow-redesign](done/2026-08-14-studio-workflow-redesign.md) and
[literal-design-conformance](done/2026-09-01-literal-design-conformance.md)),
both closed 2026-09-02. The handoff exported afterwards carries sections those
passes never saw: the step-gating states (`5a`), a four-panel Settings with an
`AI assistance` panel the app has never had (`6a`), the harness popover (`6c`),
and the designed cloud-consent gate (`5b` card 2).

Audited twice. The first pass (2026-09-03, morning) compared **tokens,
typography and shared components** and concluded the gap was concentrated in
the newer sections. That was true as far as it went, and it was the wrong
granularity: a side-by-side screenshot of the reference and the running app then
showed a row of per-element deltas across the shell and Import that a
component-level audit does not catch. Those are Phase 2, and the
"already conformant" list below is now scoped to what was actually verified,
element by element, rather than implying whole screens are done.

## Already conformant — do not re-plan

Each item below was verified in the code, not assumed. **This is a list of
specific things, not of whole screens** — see Phase 2 for the elements on the
same screens that are not conformant.

- **Colour tokens** are the design's values under the codebase's names
  (`styles/tokens.css`): `--bg-0/1/2/3` = `#08090b`/`#0d0f12`/`#12151a`/`#171b21`,
  `--border` `#23272e`, `--border-strong` `#343a43`, text `#f4f5f7`/`#a2a8b2`/`#6b7280`,
  accent `#ff4d6d`, green `#5fd18b`, amber `#e6b450`, and a full light map.
- **Typography** is self-hosted IBM Plex Sans + Mono, Latin subset
  (`styles/fonts.css`) — not a font stack that silently fell back to SF Pro.
- **Score meters** already use the design's `58px | 1fr | 30px` grid and the
  shared tone function `≥8 → green`, `≥5 → amber`, `<5 → accent`
  (`ScoreChip.tsx`, `styles.css:4143-4164`).
- **All four Version states** are implemented — `In working timeline`,
  `Current suggestion`, `Out of date`, `Unavailable` with `missingClipNames`
  (`VersionCard.tsx:28-33`). `5b` card 5 is satisfied.
- **Chat turn failure and retry** exist (`useReviewConversation.ts:128`,
  `ReviewChatPanel.tsx:109`). `5b` card 4 is satisfied.
- **Proposal cards** exist (`ProposalCard.tsx`). `5b` card 3 is satisfied.
- **Analysis phase names** already use the shipped names the handoff asks to be
  preferred over the drawn ones (`Import.tsx` `STEP_LABELS`). `5b` card 6 is
  satisfied.
- **Rail collapse, per-screen view switchers, and their persistence** shipped in
  the redesign and are covered by `project-shell-regressions.spec.ts`.
- **The project header** matches `Screen anatomy` item 1: name, absolute path,
  the `N SOURCES · N GB` count pill and `Rename`.

Not on this list, and not yet audited element by element: **Review (`1b`),
Timeline (`3a`) and Export (`3b`)**. Phase 2 covers the shell and Import because
that is what has been diffed against the reference. Give the other three the
same treatment before assuming they are clean — the Import result suggests they
will not be.

## Phase 1 — Step gating (`5a`) · DONE 2026-09-03

Shipped: `lib/stepGate.ts` derives the gate, `state/StepGateContext.tsx` lets a
route publish the actions that unblock its step, `WorkflowFooter` renders the
dashed disabled primary with its reason in an amber chip, and the action bar
carries the screen's one solid accent. All six `5a` states plus the two later
gates are covered by `e2e/step-gating.spec.ts`.

Two deliberate deviations, both recorded rather than silently taken:

- **No `⌘ ↵` hint.** The design shows one in state 06; no such shortcut exists
  in the build, so rendering the hint would advertise a key that does nothing.
  Add the hint when the shortcut lands, not before.
- **No `Retry with Pi Agent` button** in state 05. The bar shows the riding
  warning notice and stays live, which is the behavioural half of the rule. The
  button needs to know a Harness Fallback happened, and the backend's
  `metadata.used_ai` is still dropped by the client — that is
  [plan 030](030-truthful-ai-usage.md) Phase 3, Step 3.1. Wire the button there.

## Phase 2 — Shell and Import element deltas

The screens are on the right tokens and the right components, and still do not
look like the reference, because individual elements differ. Found by putting
the reference and the running app side by side rather than by reading either one
alone. Every item cites where it is in the code.

Do these together and re-cut the baselines once, with Phase 3.

**Shell**

- [ ] **Step 2.1** The rail brand has no version line. Design: 34×34 mark +
      `AI Clip Assembler` (14/600) + `local first · v0.2.0` (Mono 10px `+.12em`
      uppercase `--txm`). Build: 32×32 mark + name only
      (`Sidebar.tsx:146-149`).
- [ ] **Step 2.2** The rail footer is wrong in both directions
      (`Sidebar.tsx:288-295`). Design: `◈ AI assistance` with `pi · cloud` in
      Mono 10px green, then `⚙ Settings`. Build: `⚙ Settings` and
      `◇ Diagnostics`. **Diagnostics is not a rail item in this design** — it is
      a Settings panel (`6b`), so this step deletes that row, and the
      `AI assistance` row it replaces it with is the deep link into Phase 4's
      new panel. Sequence it after Phase 4 or the link has nowhere to go.
- [ ] **Step 2.3** Project rows carry a count only on the active row, and it
      reads `13 sources` (`Sidebar.tsx:191-193`). Design: a Mono 10px count on
      **every** row — `22`, `16`, `31`, `44`, `18` — the number alone.
- [ ] **Step 2.4** The workflow step marker holds only a number or a check, and
      the 24px line icon sits in the label beside it instead
      (`Sidebar.tsx:252-259`). Design: the icon goes **inside** the 26×26
      marker for the active/expanded step, with `✓` or the number otherwise.
      This is why the rail reads as a list of checkboxes rather than as the
      design's four marked steps.
- [ ] **Step 2.5** The Export step carries a count (`acceptedCount`,
      `Sidebar.tsx:262-263`). Design gives Export no count.
- [ ] **Step 2.6** The status bar is a two-field sentence-case line
      (`StatusBar.tsx:26-32`, `styles.css:769-779`). Design: 34px tall,
      `padding:0 20px; gap:22px`, Mono 11px `+.04em` **uppercase**, and **three**
      fields — a 7px state dot + state text, a middle fact
      (`BACKEND v0.2.0 · LOCAL`, or `HARNESS: PI AGENT (CLOUD AI, OPT-IN)`), and
      a right-aligned `11 / 16 CLIPS KEPT` in `--txd`. The build has no middle
      field at all, no uppercase, no tracking, and `padding:0 12px; gap:16px`.
      The harness variant of the middle fact needs the **Effective Harness**, so
      it depends on [plan 030](030-truthful-ai-usage.md) Phase 1; ship
      `BACKEND … · LOCAL` first rather than blocking the whole step on it.

**Import (`1d`)**

- [ ] **Step 2.7** There is no `Frame` column. The second cell is an `👁`
      preview button (`SourceVideoBrowser.tsx:250,267`). Design: a 74px `Frame`
      column holding a 48×28 radius-5 hatched placeholder — the same hatch used
      as the loading/empty state everywhere else. Decide deliberately where the
      preview affordance goes once the frame is clickable.
- [ ] **Step 2.8** The File cell is the bare filename
      (`SourceVideoBrowser.tsx:268`). Design: a 6×6 per-source identity colour
      chip + the name at weight 500 + an `hevc` pill. The identity colour
      already exists — `lib/reviewView.ts` `reviewFileAccentStyle` is what
      Review's clip cards use — so reuse it rather than inventing a second
      palette, which is the whole point of a per-source colour.
- [ ] **Step 2.9** Codec is its own column (`SourceVideoBrowser.tsx:274`).
      Design folds it into the File cell as the pill from Step 2.8, and uses
      that column budget for `Frame`.
- [ ] **Step 2.10** The selection bar's count reads `0 of 13 selected` in Sans
      (`SourceVideoSelectionBar.tsx:42`). Design: `10 SELECTED` in Mono 11px
      `+.1em` 600 `--acc`, then the sentence. The sentence copy already matches.
- [ ] **Step 2.11** The selection bar has no harness trigger, and the bare
      `Harness` `<select>` sits in the toolbar row instead
      (`Import.tsx:449-462`, `SourceVideoBrowser.tsx:191`), which is what makes
      that row read as crowded. Design puts the `6c` trigger in the selection
      bar behind a 1px divider, before `Unanalyzed only`. Same work as
      Phase 5 Step 5.1 — do it once, there.
- [ ] **Step 2.12** The primary reads `Analyze all 13`, `Analyze 13 of 13` or
      `Regenerate clips` (`SourceVideoSelectionBar.tsx:24-32`). Design:
      `Analyze 10` — the selected count, nothing else. **`Regenerate clips` has
      no counterpart anywhere in the reference**; it is a real capability
      (re-derive from cached Frame Scores) that the design never drew, so decide
      where it belongs instead of quietly leaving it in the accent slot. Note
      the gated action bar already renders `Analyze N videos` (Phase 1), so
      whatever is decided here has to agree with that label.
- [ ] **Step 2.13** The action bar has no `Add more footage` secondary; the
      design carries one in states 03 and 06 of `5a`.
- [ ] **Step 2.14** The rules card is always open and spans the content width
      when idle. Design: a 340px card beside the analysis card showing the six
      values in a 3-column grid behind an `Edit rules and re-scan` action. The
      side-by-side layout is already correct *while analysing* — this is the
      idle state only.
- [ ] **Step 2.15** The toolbar row carries five controls the design's three
      have to share space with, which is the other half of why it reads as
      crowded (`SourceVideoBrowser.tsx:140-192`). Design: `Source videos` + the
      Mono count line on the left; `Search files`, the
      `TABLE | THUMBS | COMPACT` segmented control, and `Columns` on the right.
      Build order: search, an `All` analysis filter, `Columns`, `Harness`, the
      segmented control, then an `N shown` meta. The `All` filter and the
      `N shown` count have no counterpart in the reference and the harness
      leaves in Step 2.11 — decide whether the filter and the count earn their
      place before restoring the design's order, rather than deleting working
      affordances to match a drawing.
- [ ] **Step 2.16** Re-cut both baseline sets and re-run the suite. Expect the
      `shell` and `import-analyzing` fixtures to move substantially.

## Phase 3 — The button system

The design's accent budget is **exactly one solid accent element per screen**,
the primary in the action bar. Today `.btn.primary` is an accent *tint* at
radius 6 / 12px / `6px 12px` padding (`styles.css:1630`), so before Phase 1 no
screen had its one solid accent at all — it had none.

Phase 1 fixed this inside `.workflow-footer` only, deliberately: a global change
rewrites every committed visual baseline, and that is a decision to take on
purpose rather than as a side effect.

- [ ] **Step 2.1** Split `.btn` into the design's named variants rather than
      overloading one class: Toolbar/inline (`6px 12px`–`8px 13px`, radius 8,
      `--bg-2`, 1px `--border`, 12.5–13px) is what today's `.btn` base already
      approximates; add Primary (`11px 22px`, radius 10, solid `--accent`, ink
      `--accent-ink`, 600, 13.5px), Secondary (`11px 18px`, `--bg-2`,
      1px `--border`, `--text-dim`) and Ghost (`11px 18px`, transparent).
- [ ] **Step 2.2** Destructive is an accent *tint* with accent text and a 40%
      accent border — **never solid accent, and never red**. Today
      `.btn.destructive` uses `--red` and fills solid red on hover
      (`styles.css:1651-1660`), which the design explicitly rules out.
- [ ] **Step 2.3** Audit the 13 `btn primary` call sites. Every screen must end
      with exactly one solid accent. `Import.tsx:381` currently renders
      `Create / Open Folder Project` as a primary in the screen *header*, which
      would be a second solid accent beside the action bar's.
- [ ] **Step 2.4** Re-cut the visual baselines for **both** platforms — see the
      `snapshotPathTemplate` note in `playwright.config.ts`. A macOS-only
      re-cut turns CI red.

## Phase 4 — Settings: four panels and the `AI assistance` panel (`6a`, `6b`)

`SettingsModal.tsx` is three tabs across the top (`settings` | `connect-ai` |
`diagnostics`). The design is a 1380px dialog, radius 16,
`grid-template-columns: 246px minmax(0,1fr)`, with four named panels in a left
rail: `AI assistance` (badge `CLOUD`), `Connections` (`2`), `Diagnostics`
(green dot), `General`.

- [ ] **Step 3.1** Rebuild the dialog as a rail + panel grid.
      `settingsPanel: 'ai' | 'connections' | 'diagnostics' | 'general'` replaces
      `SettingsTab`. The active rail item is the **one** place a left bar is
      allowed in this design (`--accent-dim` + `inset 2px 0 0 var(--accent)`),
      because it is a rail item and not a selection. Rail footnote, verbatim:
      "Settings are per machine. Cloud consent is per project."
- [ ] **Step 3.2** Build the `AI assistance` panel — the screen the app has
      never had. Three radio cards under `SCORING ENGINE` with their
      consequences in a Mono facts row: Rule-based · local (`DEFAULT`),
      Pi Agent · cloud (`OPT-IN`, nested account row, consent state), and
      Local model · Qwen 3-VL (disabled, dashed radio). Copy is in the handoff
      and is final. This is where the **Selected Harness** setting belongs, so
      do it after [plan 030](030-truthful-ai-usage.md) Phase 1 persists it —
      otherwise the panel writes to component state that resets on navigation.
- [ ] **Step 3.3** Move the model account out of Connections into the account
      row of `AI assistance`; Connections becomes MCP desktop clients only.
- [ ] **Step 3.4** Give the Diagnostics failure branch its designed form. The
      substance is already there — both branches and the ordered guidance steps
      (`DiagnosticsTabPanel.tsx`) — but not the green/red ring cards, the
      `RAN 2 MIN AGO` stamp, the `150px | 1fr` `<dl>`, or the closing note that
      environment-variable steps need an app restart.
- [ ] **Step 3.5** E2E: each panel reachable, the deep link still lands on the
      right one, and the failure card renders from a failing diagnostics
      response.

## Phase 5 — Harness choice as a popover, and consent as a designed gate

- [ ] **Step 4.1** Replace the bare `<select>` labelled `Harness`
      (`Import.tsx:450-462`) with the `6c` popover: trigger `Scored by Pi Agent`
      with a green dot on an accent tint, panel headed `WHO SCORES THIS
      ANALYSIS`, one row per option carrying its consequences in Mono 10.5px,
      footer "Applies to this analysis run." + `Open AI settings`.
- [ ] **Step 4.2** Enforce the handoff's copy rule: toolbar, status bar,
      Settings and Diagnostics all say **"Pi Agent · cloud"**. Never "harness",
      never `pi_agent`, never "AI review model" for the same thing. Use the
      spec terms from `UBIQUITOUS_LANGUAGE.md` in code identifiers only.
- [ ] **Step 4.3** Replace `window.confirm` for cloud consent
      (`Import.tsx:266-275`) with the designed gate from `5b` card 2: what is
      sent ("up to 4 sampled frames per candidate clip — never whole videos,
      never audio"), the route, the boundary ("smoothness stays local"),
      `Keep it local` / `Allow for this project`, and `REVOCABLE IN SETTINGS`.
      Ungranted consent reveals this **inline in the popover**, before the
      Analyze click, not as a modal after it.
- [ ] **Step 4.4** E2E: choosing the cloud harness without consent shows the
      gate and calls no provider; declining leaves the Selected Harness alone.

## Phase 6 — Token deltas

Four values differ from the handoff. Each is small, and each is a real
difference on screen, so fix them together and re-cut the baselines once.

- [ ] **Step 5.1** `--surf` is a **distinct** token in the design
      (`#101317` dark), used for the rail and side panels. The build maps it
      onto `--bg-surface: #12151a`, i.e. the same value as `--bg-2`, so the rail
      and the inner cards on it are the same surface. Split them.
- [ ] **Step 5.2** Dark `--accent-dim` is `rgba(255,77,109,.14)` in the design
      and `0.12` in the build.
- [ ] **Step 5.3** Light `--accd` is the solid `#ffe4ea` in the design, not a
      10% rose alpha.
- [ ] **Step 5.4** Light `--border` is `#dcdee2` in the design; the build has
      `#dcdce2` (transposed).

## Open questions for the design owner

Carried from the handoff's own "Known deltas" section; none of them block a
phase, but Phase 4 and Phase 5 write user-facing copy, so settle them first.

1. **Terminology.** The designs use "Suggested cuts", "Your clips",
   "Rule-based · local" — all listed in `UBIQUITOUS_LANGUAGE.md` as aliases to
   avoid. The handoff's position is that the editor-facing UI should not speak
   the code's vocabulary. Default: keep the design copy verbatim, use the spec
   terms in identifiers. Confirm.
2. **Look Groups** appear only as a `2 SIMILAR` badge; there is no designed
   "show the other 2" view. The build has a working expand toggle
   (`ClipCard.tsx` `onToggleSimilarLooks`) — keep it, or match the design and
   drop it?
3. **Not designed at all:** Undo History as a surface, external-agent activity
   over the MCP server, empty states for Review/Timeline/Export, and
   `UpdateBanner` / `UpdateSection`. All four exist in the build and have no
   reference to conform to.

## Verification

`cd frontend && npm run lint && npm run typecheck && npm run test:main && npm run test:e2e`,
plus `cd backend && PYTHONPATH=. .venv/bin/python -m pytest -q` for anything that
touches a route. Any phase that changes a redesigned surface must either keep
the visual baselines green or re-cut **both** the macOS and Linux sets
deliberately.
