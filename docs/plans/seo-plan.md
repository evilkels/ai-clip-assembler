# Technical SEO Foundation Implementation Plan

**Status:** IN PROGRESS — Tasks 1-4 implemented on branch `seo` (2026-07-15). Task 5 (Google Search Console verification) is maintainer-owned and remains outstanding; shared-preview visual QA is also outstanding.

**Goal:** Correct the landing page's public claims and add durable search, social-sharing, crawl-discovery, and verification foundations before investing in a larger content program.

**Architecture:** `site/index.html` stays the one canonical product page (not the Electron renderer's own `frontend/src/renderer/index.html`). Work adds truthful metadata/structured data, a sitemap, a dependency-free Python test harness (`scripts/tests/site_contract.py` + `test_site_contract.py`) that parses every `site/**/index.html` and asserts title/description uniqueness, canonical/robots tags, JSON-LD shape, sitemap-page parity, and working relative links — plus a PR-time CI workflow independent of the deploy workflow. Search Console verification and the first content-guide pilot are separate, explicitly gated pieces of work (`docs/plans/seo-content-pilot.md`).

**Key decisions (with rationale):**
- Scope was deliberately narrowed: an earlier version of this plan proposed shipping five guide pages at once; an independent review approved only the technical/correctness landing work and rejected doing all five guides immediately. The first guide became its own one-page pilot requiring a human editorial gate — agent-generated culling-guide "expertise" without real experience was judged unacceptable filler.
- No `meta keywords`, no FAQ structured data (FAQ content is shown in page-native markup instead, explicitly without schema), no fabricated ratings/reviews, and no unverified `softwareVersion` — the JSON-LD `SoftwareApplication` node intentionally omits `aggregateRating`, `review`, and `softwareVersion`.
- No `site/robots.txt` was added: a GitHub Project Pages repo cannot publish an origin-root `/robots.txt` from this subpath, so adding one would misleadingly imply control it doesn't have.
- Both previous absolute privacy claims were corrected to accurate conditional language: "cloud AI is opt-in per project" replaces an absolute local-only claim, and connecting an external AI assistant via MCP is called out as a separate trust boundary governed by that provider's own privacy policy, not the app's consent gate.
- EDL export is documented as deliberately flattening Speed and Transform values (with a surfaced warning), unlike FCPXML/Resolve XML which preserve them — this factual distinction is enforced by a test, not just prose.
- Ownership is split explicitly: deterministic repository work (metadata, tests, CI, README alignment) is agent-owned; anything requiring the maintainer's authenticated Google account (Search Console property verification, Rich Results Test, URL Inspection, query baseline) is maintainer-owned.

**Status of components:**
- Task 1 (site contract test harness) — done.
- Task 2 (truthful search/social metadata, social-card image, sitemap) — done.
- Task 3 (corrected visible hero/privacy/FAQ copy, README alignment) — marked done except its final verification step (green contract run + visual desktop/390px light/dark inspection), which is still checked off as pending in the plan.
- Task 4 (PR-time `test-site.yml` CI workflow) — done.
- Task 5 (Search Console property verification, sitemap submission, Rich Results Test, 28-day query baseline, dated follow-up issue) — not started; explicitly maintainer-owned and requires supplying a real verification file (no placeholder/guessed filename to be committed).

**Surprises / gotchas:**
- Tests protect structural/factual invariants (metadata shape, privacy-copy phrases, link integrity) rather than coupling to exact marketing prose, so copy can be edited freely as long as the underlying claims stay true.
- The 28-day measurement follow-up needs a dated GitHub issue ("Review landing SEO after 28 days") — creating it requires explicit authorization since it's an external-state mutation.
