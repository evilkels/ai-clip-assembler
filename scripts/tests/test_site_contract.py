from __future__ import annotations

import re
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

# CI runs this file as a script (`python3 scripts/tests/test_site_contract.py`),
# which puts this directory on sys.path rather than the repo root, so the
# package-qualified import below would not resolve. Docs run it as
# `python3 -m unittest scripts.tests.test_site_contract`, where it does. Add the
# repo root so both invocations work.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.tests.site_contract import (
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

    def test_download_menus_expose_current_release_assets_for_both_architectures(self) -> None:
        home = self.parsed[SITE / "index.html"]
        assets = {
            "Apple Silicon": "https://github.com/evilkels/ai-clip-assembler/releases/download/v0.1.6/AI.Clip.Assembler-0.1.6-arm64.dmg",
            "Intel": "https://github.com/evilkels/ai-clip-assembler/releases/download/v0.1.6/AI.Clip.Assembler-0.1.6-x64.dmg",
        }
        menus = re.findall(
            r'<details class="download-menu">(.*?)</details>',
            home.html,
            flags=re.DOTALL,
        )

        self.assertEqual(len(menus), 3)
        for asset_url in assets.values():
            self.assertEqual(home.html.count(asset_url), 3)
        for menu in menus:
            for label, asset_url in assets.items():
                self.assertIn(f'href="{asset_url}"', menu)
                self.assertIn(label, menu)

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
