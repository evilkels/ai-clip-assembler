# Project Shell Header and Project List Redesign

> **Status:** DONE (2026-08-12) at `c186ef4`, with a follow-up row/confirm-dialog
> polish pass at `998f6d7`. All four tasks shipped; the temporary Task 1 probe
> spec was removed as required.

**Goal:** Put the current project's identity in one place above the whole layout,
fix the main content area clipping horizontally, and turn the sidebar Projects
list into stable, ordered rows with Open, Rename and Remove actions.

**Branch:** `feat/project-shell-header`, based on `fix/statusbar-and-update-visibility`.

## Global constraints

- No new runtime dependencies. No backend (`backend/**`) changes.
- Renaming affects the **recents label only**. It must not rename the folder on
  disk, touch the project manifest, or call the backend. Say so in the UI copy.
- Do not modify `src/main/updateCheck.ts`, `UpdateBanner.tsx`, `UpdateSection.tsx`,
  or their tests beyond what the shell-grid row change strictly requires.
- Keep `assertApplicationSender` on any new `ipcMain.handle`.
- Style with existing CSS custom properties from `src/renderer/src/styles/tokens.css`.
  No inline colors, no hardcoded hex.
- Every existing test must still pass: `npm run lint`, `npm run typecheck`,
  `npm run test:main`, `npm run test:backend`, `npm run test:e2e`.

---

## Task 1: Fix the main content area clipping horizontally

The Import page clips its content on the right: the source-videos table and the
"7 source files" line are cut off, and the long folder path in the page header
pushes the layout wider than its column.

**Root cause to verify first:** `.main` is `display: flex` with `min-width: 0`,
but its child `.page` (`styles.css`) is `flex: 1` with no `min-width: 0`. A flex
item's default `min-width: auto` means `.page` refuses to shrink below its
content's intrinsic width — the wide table and the unbroken folder path. `.main`
has `overflow: hidden`, so the excess is clipped rather than scrolled.

**Files:** `frontend/src/renderer/src/styles.css`

- [ ] **Step 1:** Confirm the diagnosis by measurement before changing anything.
      Write a temporary Playwright check asserting
      `document.querySelector('.page')!.scrollWidth > clientWidth` on `/#/import`
      with several source videos loaded. Record the numbers in the PR body.
- [ ] **Step 2:** Add `min-width: 0` to `.page`. Ensure `.page-header` and its
      text children can shrink: give the header's text block `min-width: 0`, and
      let the folder path truncate with `overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap` rather than widening the layout. Keep the full path in
      a `title` attribute so it stays discoverable.
- [ ] **Step 3:** The table must not be clipped. Wrap it in a container that
      scrolls horizontally (`overflow-x: auto`) when it genuinely cannot fit,
      instead of overflowing a clipped ancestor.

**Acceptance:** on `/#/import` at the 1024px minimum width and at 1440px, with a
project whose folder path is at least 60 characters and 7+ source videos:
`.page` has `scrollWidth === clientWidth`, every table header cell is within the
viewport, and no element extends past `.main`'s right edge.

---

## Task 2: Project identity above the whole layout

**Files:**
- Create: `frontend/src/renderer/src/layouts/ProjectHeader.tsx`
- Modify: `frontend/src/renderer/src/layouts/AppShell.tsx`,
  `frontend/src/renderer/src/routes/Import.tsx`,
  `frontend/src/renderer/src/layouts/Sidebar.tsx`, `styles.css`

The shell is a grid. It currently has three rows: banner slot, workspace, status
bar (`grid-template-rows: auto minmax(0, 1fr) 28px`).

> **Read the comment above `.app-banners` in `styles.css` before touching this.**
> Every row's element must remain a grid item at all times. A `display: none` on
> a collapsed row shifts every later row up one, which is exactly the bug that
> made the 28px status bar render ~156px tall. Collapse a row to zero height
> instead, and extend `e2e/app-shell-layout.spec.ts` to measure the new row.

- [ ] **Step 1:** Add a `ProjectHeader` as the shell's **first** row, spanning
      the full window width above the sidebar and the banner slot. Rows become
      `auto auto minmax(0, 1fr) 28px`.
- [ ] **Step 2:** Contents: the project's display name as the prominent element,
      the folder path beside it in muted, truncating text with the full path in
      `title`, and a Rename button (Task 4). With no project open, show a single
      calm "No project open" line — never an empty bar of dead space.
- [ ] **Step 3:** Remove the resulting duplication. The project name and path
      currently appear in the Import page subheading and again in
      `.sidebar-current` at the bottom of the sidebar. Both go; the header is now
      the single place project identity lives. Leave each page's own title
      ("Import", "Review") alone.
- [ ] **Step 4:** Extend `e2e/app-shell-layout.spec.ts`: with and without a
      banner, assert the header occupies its own row, the status bar is still
      exactly 28px and flush with the viewport bottom, and
      `workspaceHeight === viewportHeight - 28 - bannerHeight - headerHeight`.

---

## Task 3: Stable, ordered project rows

Clicking a project currently reorders the list: `openProjectFolder` calls
`addRecentProject`, which moves the clicked entry to the front of `recent.json`,
and the sidebar renders that raw order. The list must not move under the cursor.

**Files:** `frontend/src/renderer/src/layouts/Sidebar.tsx`, plus a new pure
sort helper with unit tests.

- [ ] **Step 1:** Sort for display: case-insensitive `localeCompare` on the
      display name (`name ?? basename(folderPath)`), tie-broken by `folderPath`
      so the order is total and deterministic. Put this in a pure exported
      function and unit-test it, including the tie-break and mixed case.
- [ ] **Step 2:** Keep writing `lastOpenedAt` — recency data stays; it simply
      stops driving the visual order.
- [ ] **Step 3:** Redesign each row as a card: display name on its own line,
      state chip (`open` / `missing`) aligned right, and an actions row beneath
      with **Open**, **Rename**, **Remove**, plus **Locate** only when
      `missing`. Today the bare word "Remove" sits under every project with no
      affordance — these must read as buttons, be at least 24px tall, keep a
      visible `:focus-visible` ring, and each carry an `aria-label` naming the
      project (e.g. `Remove sunday-biking-saulkrasti`) so four identical
      "Remove" labels are still distinguishable.
- [ ] **Step 4:** Removal is destructive-adjacent: it must state that it only
      forgets the project from this list and leaves the folder and footage on
      disk. A `title` is not enough — put it in the confirm affordance or the
      section hint.
- [ ] **Step 5:** E2E: seed four recents with names that sort differently from
      their `lastOpenedAt` order, assert the rendered order is alphabetical,
      click the last one, and assert the order is **unchanged** afterwards.

---

## Task 4: Rename a project

Renaming sets the recents label only. No backend endpoint exists for project
names and none is to be added here.

**Files:** `frontend/src/main/index.ts`, `frontend/src/preload/index.ts`,
`frontend/src/renderer/src/api/client.ts`, `Sidebar.tsx`, `ProjectHeader.tsx`,
plus `frontend/tests/main/` unit tests.

- [ ] **Step 1:** Add a pure, exported, unit-tested normalizer for a submitted
      name: trim; reject empty or whitespace-only; cap at 80 characters; strip
      control characters. An invalid name leaves the stored name untouched and
      surfaces a message — it must not write a broken entry or throw into the
      renderer as an unhandled rejection.
- [ ] **Step 2:** Add `ipcMain.handle('project:recent-rename', ...)` beside the
      existing recents handlers. Assert the sender, validate that `folderPath`
      and `name` are non-empty strings, normalize, write, and return the enriched
      recents list exactly as `project:recent-add` does. Renaming an unknown
      `folderPath` is a no-op returning the unchanged list, not an error.
- [ ] **Step 3:** Expose it through the preload bridge and `client.ts`, matching
      the surrounding optional-method style so the browser-only path degrades.
- [ ] **Step 4:** Inline edit in the sidebar row and from the header's Rename
      button: a text input seeded with the current name, Save and Cancel,
      `Enter` saves, `Escape` cancels, focus moves into the input on open and
      returns to the trigger on close. Label the input; do not rely on
      placeholder text alone.
- [ ] **Step 5:** E2E: rename from the sidebar and confirm the new name appears
      in both the row and the shell header, that the list re-sorts to the new
      name's alphabetical position, that `Escape` discards, and that submitting
      whitespace leaves the original name intact.

---

## Definition of done

1. `npm run lint`, `npm run typecheck`, `npm run test:main`,
   `npm run test:backend`, `npm run test:e2e` all pass. Paste the counts.
2. The measurements from Task 1 Step 1 and Task 2 Step 4, before and after.
3. Screenshots of the shell header and the redesigned project list in **both**
   light and dark themes — the tokens differ per theme and low contrast in one of
   them is a defect, not a detail.
4. No `display: none` on any `.app-shell` grid row. State this explicitly.
5. Temporary probe specs deleted; only real regression tests remain.
