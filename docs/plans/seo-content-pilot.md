# SEO Content Pilot — Video Culling Workflow

Status: GATED — implementation starts only after the maintainer evidence packet
below exists and the technical SEO foundation is deployed.

**Goal:** Publish one genuinely useful guide for people trying to turn large
amounts of action-sports, drone, or travel footage into a first rough cut, then
use real query and engagement data to decide whether a larger guide cluster is
warranted.

**Pilot URL:**
`https://evilkels.github.io/ai-clip-assembler/guides/video-culling-rough-cut-workflow/`

## Why one guide

The broader draft proposed five pages before search intent or editorial quality
was known. Independent review found likely overlap between drone and action-
camera pages, possible cannibalization between a local-processing page and the
home page, and a weak fit between an XML-conversion article and the app's
actual workflow. One culling guide is the strongest shared problem and provides
a cheaper learning loop.

## Gate 1 — maintainer evidence packet

Elvijs supplies a short working document or issue containing:

- [ ] Five to ten query phrasings observed in Google autocomplete, Search
  Console, Trends, Keyword Planner, relevant creator forums, or real user
  conversations. Record the source and date; do not invent search volume.
- [ ] A manual review of the first page of results for the three strongest
  queries: dominant intent, formats, gaps, and whether users seek a workflow,
  software, or troubleshooting answer.
- [ ] Three first-hand lessons from culling real action-sports/drone/travel
  footage, including what failed or wasted time.
- [ ] One publishable before/after example: source-clip count and duration,
  resulting candidate/rough-cut count and duration, machine context, and the
  human decisions still required.
- [ ] Rights-cleared screenshots or frames, plus attribution/usage notes.
- [ ] Approval of every product, privacy, and export claim against the current
  release.

If this packet is absent, the coding agent must stop. Generic AI-authored prose
is not an acceptable substitute.

### Query-research seed map

These are hypotheses to investigate, not asserted keywords or search-volume
claims. Capture the exact autocomplete/query wording and group it by intent:

| Problem family | Seed searches | Likely page fit |
|---|---|---|
| Too much footage | `how to sort hours of video footage`, `fastest way to cull video footage`, `video culling workflow` | Primary pilot intent. |
| Action-camera overload | `how to organize GoPro footage`, `how to edit hours of GoPro footage`, `choose best clips from action camera` | Fold into pilot examples unless evidence supports a distinct page. |
| Drone rough cuts | `how to sort drone footage`, `drone video editing workflow`, `how to choose drone clips` | Possible later audience-specific guide. |
| First assembly | `how to make a rough cut from raw footage`, `automatically create rough cut`, `best clips to rough cut workflow` | Pilot section; avoid claiming full automatic editing. |
| Performance/proxies | `4k footage slow to edit`, `do I need proxies for 4k drone footage`, `video proxy workflow` | Supporting section or separate guide only if the intent is strong. |
| Editable handoff | `export timeline to DaVinci Resolve`, `FCPXML to DaVinci Resolve`, `EDL vs XML video editing` | Later troubleshooting guide if product users need it. |
| Local/private tools | `offline video culling software`, `local AI video editor`, `private AI video editor` | Home-page positioning first; a separate page risks cannibalization. |

Also record the vocabulary used in creator forums and support conversations.
That language often produces better headings and explanations than mechanically
repeating a high-volume phrase.

## Gate 2 — editorial and page implementation

### Coding-agent files

- Create: `site/guides/video-culling-rough-cut-workflow/index.html`
- Create only if reuse justifies it: `site/guides/guides.css`
- Modify: `site/index.html`
- Modify: `site/sitemap.xml`
- Modify: `scripts/tests/test_site_contract.py`

### Article contract

- Answer the workflow question immediately; do not begin with product history.
- Cover: defining the target cut, making proxies when needed, scene/shot
  segmentation, objective rejection passes, subjective selection, pacing a
  rough cut, preserving source media and editability, and quality control.
- Clearly separate universal advice from AI Clip Assembler-specific steps.
- Explain that local Manual Harness processing is rule-based and that optional
  provider-backed AI requires explicit per-project consent and can transmit
  sampled frames or metadata.
- Explain editable export accurately: FCPXML and Resolve XML preserve supported
  Speed/Transform values; EDL flattens them and warns.
- Include the maintainer's real example and original screenshots with useful alt
  text. Do not fabricate benchmarks, testimonials, authority, or authorship.
- Add one contextual product link where the app genuinely helps; avoid repeated
  keyword-rich calls to action.
- Use a concise title and description based on the validated primary intent,
  one H1, descriptive headings, canonical URL, Open Graph/Twitter metadata,
  `Article` and `BreadcrumbList` JSON-LD, and a visible updated date matching
  the actual publication commit.
- Link back to the guide from a relevant visible section on the home page and
  include it in the sitemap.

### Verification contract

- Extend the invariant suite rather than asserting full prose verbatim.
- Assert the pilot path, canonical, one H1, Article/Breadcrumb structured data,
  reciprocal internal link, sitemap coverage, and required factual concepts.
- Run `python3 scripts/tests/test_site_contract.py -v`.
- Validate rendered mobile/desktop layout and keyboard navigation locally.
- After deployment, the maintainer checks the URL in Search Console and submits
  it for indexing without assuming inclusion or ranking.

## Measurement decision

Open one follow-up issue dated 28 days after publication. Record impressions,
queries, pages, countries/devices when useful, clicks, CTR, average position,
demo/download referrals, and qualitative feedback. Avoid conclusions from tiny
samples; retain the guide if it is useful even before it ranks.

Only then choose among these next experiments:

1. A drone-footage workflow guide, if query evidence shows distinct intent.
2. An editable Resolve/FCPXML handoff guide, if users repeatedly need that
   troubleshooting path.
3. Improving the pilot or home page instead of adding another URL.

Do not create standalone action-camera or “offline editor” pages merely to
cover keywords.

## Implementation prompt for a coding agent

```text
Implement docs/plans/seo-content-pilot.md as a single-guide experiment.

First read AGENTS.md, CONTEXT.md, the relevant ADRs, docs/plans/seo-plan.md,
and the complete pilot. Confirm that the maintainer evidence packet described
under Gate 1 exists and that Tasks 1–4 of the technical SEO plan are deployed.
If either condition is missing, stop and report exactly what is absent; do not
generate generic replacement prose.

When the gates pass, implement only the culling-workflow guide and its required
home-page link, sitemap entry, structured data, responsive styling, and
invariant tests. Preserve the current editorial landing-page design. Use the
maintainer's first-hand material and rights-cleared media, distinguish universal
workflow guidance from product-specific steps, and keep every privacy/export
claim consistent with the current release and ADRs. Do not add additional
keyword pages, FAQ schema, meta keywords, fake dates, fake metrics, reviews, or
search-volume claims.

Use test-first checkpoints, run the static-site contract and relevant repo
checks, inspect the rendered page at desktop and mobile widths, and report the
files changed, commands/results, and any human Search Console steps still due.
Do not push, publish, or mutate external services without explicit approval.
```
