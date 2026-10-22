---
type: Note
title: Roadmap overview behavior contract
description: Defines browser acceptance checks for the roadmap overview and its saved answers, navigation, and privacy.
status: draft
created: 2026-10-22
---
# Overview behavior contract

Target: http://127.0.0.1:8769/ (owner-only local page; no public deployment).
Read this contract only. Do not read page source, repository files, git, tests or reviewer findings. Browser DOM/accessibility interaction and rendered screenshots are allowed. Do not modify files. Return the report in your final answer.

C1. At desktop and 390px, the first screen explains the released baseline versus main and v0.5.0 owner checks; the page has no horizontal overflow.
C2. Auto/Gaišs/Tumšs switches change appearance, keep one pressed state, survive reload, and Auto follows system preference.
C3. Each decision offers selectable answers; selecting then reloading retains an answer. Selecting it again clears it. Separate questions retain independent answers. Copy answers yields a readable Latvian list with question ids and selected answers; if clipboard is unavailable a text field presents the same text. Notīrīt with confirmation removes answers after reload.
C4. Status filter buttons narrow the full item table, Vis­i restores all items. Clicking a track pill reveals its own row even after a different filter was selected. At phone width, clicking a group status bar opens and filters the item list.
C5. Section navigation scrolls to a section without opening its disclosures; specific PR/item links open containing disclosures. Every visible control is usable by keyboard and touch-sized. Details can be opened and closed. The portrait screenshot loads with descriptive alt text.
C6. Page viewing/answer selection causes no external network requests or messages; only deliberate external links navigate away. Do not submit anything or mutate GitHub. Product QA, NLE imports, authentic model calls and real iPhone behavior are out of scope.

Exercise refresh and repeated selection as anti-cheat probes. Report every clause pass/fail/blocked/out of scope with observable evidence. Use an isolated browser session/tab to avoid other reviewer state. If no browser tools are available say blocked, do not inspect source as fallback. No delegation.
