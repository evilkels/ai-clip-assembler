# Plan 031: App restyle conformance — the sections the build has not caught up to

Status: PHASE 1 DONE (2026-09-03) · PHASES 2-5 TODO · Priority P2 · Effort L · Risk MED · Category UI conformance
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

Audited 2026-09-03 against the shipped renderer. The gap is narrow but real,
and it is concentrated in exactly those newer sections.

## Already conformant — do not re-plan

Verified in the code, not assumed:

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

## Phase 2 — The button system

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

## Phase 3 — Settings: four panels and the `AI assistance` panel (`6a`, `6b`)

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

## Phase 4 — Harness choice as a popover, and consent as a designed gate

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

## Phase 5 — Token deltas

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
phase, but Phase 3 and Phase 4 write user-facing copy, so settle them first.

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
