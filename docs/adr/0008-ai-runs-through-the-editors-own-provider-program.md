# 0008: AI runs through the Editor's own Claude Code or Codex, which the app never installs

## Status

Accepted (2026-10-08). Retires the Pi Agent route and the unimplemented Claude
Code / Codex "harnesses" with API keys described in `docs/HARNESS_SPEC.md`.

## Context

The Editor should use the subscription they already pay for — Claude Pro/Max or
ChatGPT Plus/Pro — with no API keys and no terminal. Until v0.4.0 every AI call
went through the third-party Pi CLI, signed in to ChatGPT by reusing Codex's
OAuth client; the Editor had to install Pi with npm. Checked against vendor
terms on 2026-10-08:

- Anthropic allows a third-party app to run the user's own, unmodified Claude
  Code with the user's own subscription login, provided the product accepts
  Anthropic's Commercial Terms, keeps Claude Code's built-in sign-in, and never
  collects or relays the user's credentials. A product's own claude.ai login
  (which Pi's Anthropic route amounts to) is prohibited.
- OpenAI's Codex (Apache-2.0) signs in with ChatGPT, accepts images, and
  reports usage limits with reset times. Pi's reuse of Codex's OAuth client is
  not sanctioned by OpenAI.
- The Claude and ChatGPT desktop apps already ship Claude Code and Codex
  programs on the Editor's Mac, so most Editors need no extra install.

Considered: bundling Claude Code and Codex inside the DMG (rejected: signing our
bundle re-signs Anthropic's binary, which breaks the "unmodified" condition, and
the copies go stale); downloading them on first connect (rejected by the owner:
the app should not install vendor software); keeping Pi (rejected: account risk
and one more thing to explain).

## Decision

- The **Providers** are **Claude** and **ChatGPT**. Their **AI Engines** are the
  Editor's installed Claude Code and Codex. The app never installs, bundles,
  updates or signs in to them, and never reads or stores their credentials.
- Finding an engine, in order: a program the Editor chose → standard install
  locations and PATH → the copy inside the Claude or ChatGPT desktop app. Each
  is validated by `--version` and its own sign-in status, and **Check again**
  re-scans.
- When an engine is missing, the app links to the vendor download (Claude
  desktop app, ChatGPT desktop app, or the standalone CLI). When it is signed
  out, the app starts the engine's own browser sign-in in the background; the
  Editor never sees a terminal.
- Setup follows T3 Code's pattern: a skippable welcome wizard on first launch,
  a Providers screen in Settings showing installed → signed in → ready per
  Provider, and one **Active Provider** at a time with no automatic fallback.
- Failures are classified (not installed, signed out, usage limit with reset
  time, rate limited, timed out, unusable reply) and shown as such.
- Pi is removed once Codex works; API keys may return later as an advanced
  option.

## Consequences

- The app accepts Anthropic's Commercial Terms (owner: yes).
- Engine locations inside the desktop apps are not a vendor contract; detection
  is re-run on every check and covered by tests with fixture paths.
- Usage counts against the Editor's own subscription limits; scoring every clip
  spends them, so AI calls are batched and cached and the Editor can finish AI
  scoring later.
