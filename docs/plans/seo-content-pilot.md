# SEO content pilot — video culling workflow

Status: GATED. Start only after technical SEO deploys and the maintainer evidence
packet exists. Target: `/guides/video-culling-rough-cut-workflow/`.

## Goal and decision

Publish one useful guide from footage overload to a first rough cut, then use
real query and engagement data before expanding. Five speculative pages were
rejected due to unproven intent, drone/action overlap, local-processing home-page
cannibalization, and weak XML-conversion fit.

## Evidence gate

Elvijs must supply dated observed query wording, manual SERP review, first-hand
culling lessons, one publishable before/after example, rights-cleared images,
and claim approval against the current release. Without it, stop: generic
AI-authored expertise or fabricated volume/benchmarks is unacceptable.

## Implementation contract

Create the guide page; link it from `site/index.html` and `site/sitemap.xml`;
extend `scripts/tests/test_site_contract.py`. Answer the workflow immediately,
cover target-cut planning through QC, separate universal advice from product
steps, and explain these truths:

- Manual Harness is rule-based; provider-backed AI requires consent.
- FCPXML/Resolve XML preserve supported speed/transform; EDL flattens and warns.
- Examples and claims come from maintainer evidence, not invented authority.

Add correct metadata, JSON-LD, date, one product link, accessible imagery, and
rendered-layout verification. Run `python3 scripts/tests/test_site_contract.py -v`
and manually confirm Search Console after deploy.

## Measurement

After 28 days, record impressions, queries, clicks, CTR, position, and feedback
without over-reading tiny samples. Evidence may justify a distinct drone guide,
export troubleshooting, or improving the pilot/home page—not automatic expansion.
