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
