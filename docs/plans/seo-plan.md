# Technical SEO Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

Status: IN PROGRESS — Tasks 1–4 implemented on branch `seo` on 2026-07-15;
shared-preview visual QA and maintainer-owned Search Console Task 5 remain.

**Goal:** Correct the landing page's public claims and add durable search,
social-sharing, crawl-discovery, and verification foundations before investing
in a larger content program.

**Architecture:** Keep `site/index.html` as the canonical product page. Add
metadata, truthful structured data, a sitemap, a reusable dependency-free site
contract, and a PR-time test workflow. Search Console verification and the
first content experiment are separate gated work; the content pilot is defined
in `docs/plans/seo-content-pilot.md`.

**Tech Stack:** Static HTML/CSS, JSON-LD, GitHub Pages, Python 3 standard
library, GitHub Actions, Google Search Console.

## Global Constraints

- Canonical URL: `https://evilkels.github.io/ai-clip-assembler/`.
- Published source: `site/index.html`; do not edit the Electron renderer's
  `frontend/src/renderer/index.html`.
- Preserve the approved visual direction in
  `docs/specs/2026-07-10-landing-page-editorial-refresh.md`.
- The Manual Harness is local and rule-based. Provider-backed AI is optional,
  requires explicit consent per project, and may send sampled frames or clip
  metadata to the configured provider.
- Connecting an external AI assistant through MCP is a separate trust boundary:
  metadata or sampled frames the user asks it to inspect are handled under that
  provider's privacy policy and are not covered by the harness consent gate.
- FCPXML and Resolve XML preserve supported Speed and Transform values. EDL
  deliberately flattens them and surfaces a warning.
- Do not add `meta keywords`, FAQ structured data, fabricated ratings/reviews,
  or an unverified `softwareVersion`.
- Do not add `site/robots.txt`; a GitHub Project Pages repository cannot publish
  the origin-root `/robots.txt` policy from this subpath.
- Do not promise indexing, rankings, rich results, traffic, or AI citations.
- Do not couple site deployment to exact README prose or exact marketing-copy
  strings. Tests protect structural and factual invariants.
- Do not perform GitHub, Search Console, push, PR, or other external mutations
  without explicit authorization.

## Scope decision

Claude's independent review approved the former plan's technical landing work
and rejected executing five guide pages at once. This plan therefore ships the
correctness and technical SEO work only. The first guide becomes a separate
one-page pilot with a human editorial gate. Action-camera and local-first guides
are not implementation tasks until evidence supports them.

## Ownership

| Work | Owner | Why |
|---|---|---|
| Metadata, structured data, sitemap, tests, CI, README alignment | Coding agent | Deterministic repository work. |
| Search Console property verification | Maintainer | Requires the user's Google account and a verification token/method. |
| Rich Results Test, URL Inspection, sitemap submission | Maintainer with agent guidance | Requires authenticated browser access. |
| Query baseline and 28-day review | Maintainer | Search Console account data is private external state. |
| Culling-guide expertise and editorial approval | Maintainer | The guide needs real experience, not plausible agent-generated filler. |
| Implementation of the approved guide | Coding agent | Static page construction after the content gate passes. |

## File map

| File | Responsibility |
|---|---|
| `scripts/tests/site_contract.py` | Shared HTML parser, page discovery, canonical mapping, and relative-link resolution. |
| `scripts/tests/test_site_contract.py` | Invariant tests for all public HTML, metadata, JSON-LD, sitemap coverage, privacy copy, and internal links. |
| `site/index.html` | Canonical product metadata, structured data, accurate hero/FAQ/privacy copy. |
| `site/img/social-card.png` | Large social preview copied from approved cover artwork. |
| `site/sitemap.xml` | Canonical list of every public `site/**/index.html` page. |
| `.github/workflows/test-site.yml` | PR/push-time site contract independent of deployment. |
| `README.md` | Canonical website link and accurate opening product description; existing contributor/security docs remain. |
| `docs/plans/seo-content-pilot.md` | Separately gated first-guide experiment. |

---

### Task 1: Add invariant-based static-site tests

**Files:**

- Create: `scripts/tests/site_contract.py`
- Create: `scripts/tests/test_site_contract.py`

**Interfaces:**

- Produces: `discover_pages()`, `expected_url(path)`, and `parse_page(path)` for
  current and future static pages.
- Produces: `python3 scripts/tests/test_site_contract.py -v` with no third-party
  dependencies.

- [x] **Step 1: Create `scripts/tests/site_contract.py`.**

```python
from __future__ import annotations

import json
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "site"
BASE = "https://evilkels.github.io/ai-clip-assembler/"


@dataclass
class ParsedPage:
    title: str = ""
    h1s: list[str] = field(default_factory=list)
    metas: dict[str, str] = field(default_factory=dict)
    links: dict[str, str] = field(default_factory=dict)
    anchors: list[str] = field(default_factory=list)
    json_ld: list[object] = field(default_factory=list)
    html: str = ""


class _Parser(HTMLParser):
    def __init__(self, html: str) -> None:
        super().__init__()
        self.page = ParsedPage(html=html)
        self._capture: str | None = None
        self._buffer: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        values = dict(attrs)
        if tag == "meta":
            key = values.get("property") or values.get("name")
            if key and values.get("content"):
                self.page.metas[key] = values["content"]
        elif tag == "link" and values.get("rel") and values.get("href"):
            self.page.links[values["rel"]] = values["href"]
        elif tag == "a" and values.get("href"):
            self.page.anchors.append(values["href"])
        elif tag in {"title", "h1"}:
            self._capture = tag
            self._buffer = []
        elif tag == "script" and values.get("type") == "application/ld+json":
            self._capture = "json-ld"
            self._buffer = []

    def handle_endtag(self, tag: str) -> None:
        if self._capture == tag:
            text = " ".join("".join(self._buffer).split())
            if tag == "title":
                self.page.title = text
            else:
                self.page.h1s.append(text)
            self._capture = None
        elif tag == "script" and self._capture == "json-ld":
            self.page.json_ld.append(json.loads("".join(self._buffer)))
            self._capture = None

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buffer.append(data)


def discover_pages() -> list[Path]:
    return sorted(SITE.rglob("index.html"))


def expected_url(path: Path) -> str:
    relative_parent = path.relative_to(SITE).parent
    if relative_parent == Path("."):
        return BASE
    return f"{BASE}{relative_parent.as_posix()}/"


def parse_page(path: Path) -> ParsedPage:
    html = path.read_text(encoding="utf-8")
    parser = _Parser(html)
    parser.feed(html)
    return parser.page


def local_anchor_target(page_path: Path, href: str) -> Path | None:
    parsed = urlsplit(href)
    if parsed.scheme or parsed.netloc or href.startswith(("#", "mailto:")):
        return None
    clean_path = unquote(parsed.path)
    if not clean_path:
        return None
    if clean_path.startswith("/ai-clip-assembler/"):
        target = SITE / clean_path.removeprefix("/ai-clip-assembler/")
    elif clean_path.startswith("/"):
        return None
    else:
        target = (page_path.parent / clean_path).resolve()
    if clean_path.endswith("/") or target.suffix == "":
        target /= "index.html"
    return target
```

- [x] **Step 2: Create `scripts/tests/test_site_contract.py`.**

```python
from __future__ import annotations

import unittest
import xml.etree.ElementTree as ET

from site_contract import (
    BASE,
    SITE,
    discover_pages,
    expected_url,
    local_anchor_target,
    parse_page,
)


class StaticSiteContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pages = discover_pages()
        cls.parsed = {path: parse_page(path) for path in cls.pages}

    def test_every_page_has_unique_search_metadata(self) -> None:
        self.assertGreaterEqual(len(self.pages), 1)
        titles: set[str] = set()
        descriptions: set[str] = set()
        for path, page in self.parsed.items():
            self.assertEqual(len(page.h1s), 1, path)
            self.assertTrue(page.title.strip(), path)
            description = page.metas.get("description", "")
            self.assertGreaterEqual(len(description), 50, path)
            self.assertLessEqual(len(description), 180, path)
            self.assertEqual(page.links.get("canonical"), expected_url(path), path)
            self.assertEqual(
                page.metas.get("robots"),
                "index,follow,max-image-preview:large",
                path,
            )
            self.assertNotIn("keywords", page.metas, path)
            self.assertNotIn(page.title, titles, path)
            self.assertNotIn(description, descriptions, path)
            titles.add(page.title)
            descriptions.add(description)

    def test_json_ld_is_parseable_and_avoids_retired_faq_markup(self) -> None:
        for path, page in self.parsed.items():
            self.assertGreaterEqual(len(page.json_ld), 1, path)
            self.assertNotIn('"FAQPage"', page.html, path)
            self.assertNotIn("schema.org/Question", page.html, path)

    def test_home_social_metadata_and_software_graph_are_truthful(self) -> None:
        home = self.parsed[SITE / "index.html"]
        canonical = f"{BASE}"
        social_image = f"{BASE}img/social-card.png"

        self.assertEqual(home.metas.get("og:type"), "website")
        self.assertEqual(home.metas.get("og:url"), canonical)
        self.assertEqual(home.metas.get("og:image"), social_image)
        self.assertEqual(home.metas.get("twitter:card"), "summary_large_image")
        self.assertEqual(home.metas.get("twitter:image"), social_image)
        self.assertTrue(home.metas.get("og:image:alt", "").strip())
        self.assertTrue(home.metas.get("twitter:image:alt", "").strip())
        self.assertTrue((SITE / "img/social-card.png").is_file())

        graph = home.json_ld[0].get("@graph", [])
        nodes = {node.get("@type"): node for node in graph}
        self.assertIn("WebSite", nodes)
        self.assertIn("SoftwareApplication", nodes)
        software = nodes["SoftwareApplication"]
        self.assertEqual(software.get("url"), canonical)
        self.assertEqual(software.get("offers", {}).get("price"), 0)
        self.assertTrue(software.get("isAccessibleForFree"))
        self.assertNotIn("softwareVersion", software)
        self.assertNotIn("aggregateRating", software)
        self.assertNotIn("review", software)

    def test_public_copy_preserves_privacy_and_export_boundaries(self) -> None:
        home = self.parsed[SITE / "index.html"]
        lower = home.html.lower()
        self.assertNotIn("footage never leaves", lower)
        self.assertIn("cloud ai is opt-in per project", lower)
        self.assertIn("external ai assistant", lower)
        self.assertIn("external provider's privacy policy", lower)
        self.assertIn("edl", lower)
        self.assertIn("flatten", lower)

    def test_sitemap_and_public_pages_are_the_same_set(self) -> None:
        root = ET.parse(SITE / "sitemap.xml").getroot()
        namespace = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        sitemap_urls = {
            node.text for node in root.findall("sm:url/sm:loc", namespace)
        }
        page_urls = {expected_url(path) for path in self.pages}
        self.assertEqual(sitemap_urls, page_urls)

    def test_every_relative_anchor_resolves_to_a_file(self) -> None:
        for path, page in self.parsed.items():
            for href in page.anchors:
                target = local_anchor_target(path, href)
                if target is not None:
                    self.assertTrue(target.is_file(), f"{path}: {href} -> {target}")


if __name__ == "__main__":
    unittest.main()
```

- [x] **Step 3: Run the contract and confirm the red state.**

```bash
python3 scripts/tests/test_site_contract.py -v
```

Expected: FAIL on missing canonical/robots metadata, inaccurate privacy copy,
missing EDL flatten language, missing JSON-LD, or missing sitemap. Syntax and
import errors are not expected failures.

- [ ] **Step 4: Commit the red contract if commits are authorized.**

```bash
git add scripts/tests/site_contract.py scripts/tests/test_site_contract.py
git commit -m "test(site): define static SEO invariants"
```

### Task 2: Implement truthful landing-page search and social metadata

**Files:**

- Modify: `site/index.html`
- Create: `site/img/social-card.png`
- Create: `site/sitemap.xml`

**Interfaces:**

- Consumes: canonical URL and factual constraints above.
- Produces: indexable page metadata, social preview, `WebSite` and
  `SoftwareApplication` entities, and sitemap coverage.

- [x] **Step 1: Copy the approved cover banner for social previews.**

```bash
cp assets/cover-banner.png site/img/social-card.png
sips -g pixelWidth -g pixelHeight site/img/social-card.png
```

Expected: `1376 × 768`.

- [x] **Step 2: Add exact search metadata in `<head>`.**

```html
<title>AI Clip Assembler — Local-First Drone Video Culling for macOS</title>
<meta name="description" content="Cull raw drone footage locally on your Mac, review scored clips, and export editable FCPXML, DaVinci Resolve XML, or EDL timelines. Free and open source." />
<meta name="robots" content="index,follow,max-image-preview:large" />
<link rel="canonical" href="https://evilkels.github.io/ai-clip-assembler/" />
```

Add Open Graph and Twitter metadata using the same title/description, canonical
URL, absolute `img/social-card.png` URL, `summary_large_image`, dimensions
`1376 × 768`, and descriptive image alt text.

- [x] **Step 3: Add one JSON-LD `@graph`.**

Include:

- `WebSite` with stable `@id` `<canonical>#website`, name, and URL;
- `SoftwareApplication` with stable `@id` `<canonical>#software`, name, URL,
  description, `MultimediaApplication`, macOS, free offer (`price: 0`), release
  page `downloadUrl`, MIT license URL, screenshot, feature list, and
  `isAccessibleForFree: true`;
- no rating, review, FAQ entity, or `softwareVersion`.

- [x] **Step 4: Create the one-page sitemap.**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://evilkels.github.io/ai-clip-assembler/</loc>
  </url>
</urlset>
```

- [x] **Step 5: Run the contract.**

```bash
python3 scripts/tests/test_site_contract.py -v
```

Expected: metadata/JSON-LD/sitemap tests PASS; factual-copy test remains red.

### Task 3: Correct visible product copy and preserve the README

**Files:**

- Modify: `site/index.html`
- Modify: `README.md`

- [x] **Step 1: Use this hero copy.**

```html
<h1>Cull hours of drone footage <em>into a cut worth keeping.</em></h1>
<p class="hero-sub">
  AI Clip Assembler is a free, local-first macOS app that scores raw footage
  for sharpness, motion stability, and exposure, then exports an editable
  FCPXML, DaVinci Resolve XML, or EDL timeline.
</p>
```

- [x] **Step 2: Correct both absolute privacy claims.**

Use `Apple Silicon & Intel · local by default · cloud AI is opt-in per project`
in the closing note. Replace the Open source column's “footage never leaves”
sentence with `Read the code that enforces local defaults and project-scoped
cloud consent.`

- [x] **Step 3: Add visible FAQ content without FAQ schema.**

Answer these four questions in page-native markup and styles:

1. Does AI Clip Assembler upload my footage?
2. Which video editors can use the exported timeline?
3. Does it support Apple Silicon and Intel Macs?
4. Is AI Clip Assembler free and open source?

The privacy answer must distinguish the Manual Harness from optional
provider-backed AI. The export answer must explicitly say EDL flattens Speed
and Transform with a warning.

- [x] **Step 4: Add canonical project links and refine only the README opening.**

Add Website, Releases, and User guide links below the banner. Update only the
opening two paragraphs to describe free local-first macOS culling, editable
handoffs, and opt-in provider-backed AI. Preserve Current status, Privacy model,
installation, development, security, and license sections.

- [ ] **Step 5: Run the green contract and visually inspect.**

```bash
python3 scripts/tests/test_site_contract.py -v
python3 -m http.server 4173 --directory site
```

Inspect desktop and 390px layouts in light/dark modes. Expected: all contract
tests PASS, no overflow, no missing assets, and no browser-console errors.

### Task 4: Add a PR-time site contract independent of deployment

**Files:**

- Create: `.github/workflows/test-site.yml`
- Leave: `.github/workflows/pages.yml` focused on deployment.

- [x] **Step 1: Create the workflow.**

```yaml
name: Test static site

on:
  pull_request:
    paths:
      - 'site/**'
      - 'scripts/tests/site_contract.py'
      - 'scripts/tests/test_site_contract.py'
      - 'README.md'
      - '.github/workflows/test-site.yml'
  push:
    branches: [main]
    paths:
      - 'site/**'
      - 'scripts/tests/site_contract.py'
      - 'scripts/tests/test_site_contract.py'
      - 'README.md'
      - '.github/workflows/test-site.yml'

jobs:
  test-site:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - name: Verify static site contract
        run: python3 scripts/tests/test_site_contract.py -v
```

- [x] **Step 2: Verify locally.**

```bash
python3 scripts/tests/test_site_contract.py -v
git diff --check
```

Expected: PASS and no whitespace errors.

### Task 5: Verify Search Console and record the baseline

**Owner:** Maintainer, with agent assistance after the verification value is
provided.

- [ ] **Step 1: Add the GitHub Pages URL-prefix property in Search Console.**

Property: `https://evilkels.github.io/ai-clip-assembler/`.

- [ ] **Step 2: Choose HTML-file verification and give the downloaded file to
  the coding agent.**

The agent copies the exact file into `site/` without renaming or editing it.
Commit it so GitHub Pages serves the verification URL. Do not put a placeholder
token or guessed filename in the repository.

- [ ] **Step 3: Complete authenticated validation.**

- verify the property;
- submit `/sitemap.xml`;
- inspect the canonical landing URL;
- request indexing once;
- run the Rich Results Test and record warnings separately from errors;
- export the previous 28 days of queries/pages or record “no data yet.”

- [ ] **Step 4: Create a dated measurement issue.**

Use title `Review landing SEO after 28 days` and include the baseline date,
follow-up date, indexed status, Google-selected canonical, impressions, clicks,
CTR, average position, and relevant branded/non-branded queries. This external
issue creation requires explicit authorization.

## Final verification

```bash
python3 scripts/tests/test_site_contract.py -v
git diff --check
git status --short
```

Report test results, visual checks, Search Console status, and remaining human
actions. Do not claim production indexing until URL Inspection confirms it.

## Coding-agent assignment prompt

```text
Implement Tasks 1 through 4 of docs/plans/seo-plan.md. This is implementation,
not another planning pass.

Read AGENTS.md, CONTEXT.md, ADR-0001, ADR-0003, ADR-0004,
docs/specs/2026-07-10-landing-page-editorial-refresh.md, README.md, the current
site/index.html, and the full plan before editing.

Follow the test-first checkpoints. Preserve the approved landing design and all
unrelated user changes. Do not overwrite the README. Do not add meta keywords,
FAQ schema, robots.txt, fabricated ratings/reviews/version data, or absolute
privacy claims. Keep provider-backed AI and EDL degradation wording faithful to
the ADRs.

Run:
  python3 scripts/tests/test_site_contract.py -v
  git diff --check

Serve site/ locally and inspect desktop/390px plus light/dark modes using the T3
in-app preview if available. Do not push, open a PR, edit GitHub repository
settings, or access Search Console. Task 5 remains maintainer-owned until a real
verification file is supplied. At handoff report files, exact verification
output, visual checks, and remaining maintainer actions.
```

## References

- [Google SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)
- [Google title links](https://developers.google.com/search/docs/appearance/title-link)
- [Google snippets](https://developers.google.com/search/docs/appearance/snippet)
- [Google canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
- [Google sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google SoftwareApplication structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- `docs/adr/0001-local-first-and-cloud-consent.md`
- `docs/adr/0004-editable-export-and-edl-degradation.md`
