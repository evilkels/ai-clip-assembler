# Self-hosted fonts

IBM Plex Sans and IBM Plex Mono, Latin subset (`U+0000-00FF` and the small set of
punctuation Google's `latin` slice includes), served from this directory so the
landing page makes no third-party network request. The page's whole pitch is that
nothing leaves your machine; loading fonts from a CDN contradicted that.

| File | Family | Weights | Size |
| --- | --- | --- | --- |
| `ibm-plex-sans-latin-var.woff2` | IBM Plex Sans | 400–700 (variable) | 40KB |
| `ibm-plex-mono-latin-400.woff2` | IBM Plex Mono | 400 | 10KB |
| `ibm-plex-mono-latin-500.woff2` | IBM Plex Mono | 500 | 10KB |
| `ibm-plex-mono-latin-600.woff2` | IBM Plex Mono | 600 | 10KB |

Plex Sans is a variable font, so one file covers every weight the page uses.
Plex Mono is static here and needs one file per weight.

Licensed under the SIL Open Font License 1.1 — see `LICENSE.txt`. Retain that file
and the copyright notice if these are ever re-exported or re-subset.

Refreshing them: request the Google Fonts CSS with a modern browser User-Agent
(an old one yields TTF rather than WOFF2), take the `/* latin */` blocks, and
download those URLs. Do not add a build step for this; four static files is the
whole system.
