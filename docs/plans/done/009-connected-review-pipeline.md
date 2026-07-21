# Connected Review Pipeline Implementation Plan

**Status:** DONE (2026-06-28, reconcile pass). Planned at commit `f6dedc6`, 2026-06-21. Design spec: `docs/specs/2026-06-21-connected-review-pipeline-design.md`. Depends on plans 005-008.

**Goal:** Connect agent chat, the three playable Version proposals, Source Clips, and the authoritative Working Timeline with optimistic chat messages, durable provenance, conflict-safe application, and visible state relationships between all four surfaces.

**Architecture:** The persisted Timeline Document remains the only mutable export state — no parallel mutation path. Backend-owned monotonic revisions guard prepared writes (stale `expected_revision` → HTTP 409, zero mutation). Backend-owned SHA-256 fingerprints (`sequence_fingerprint`, `review_context_fingerprint`) determine content equality/staleness — revisions are concurrency tokens only, fingerprints are the actual identity check. Backend-created `VersionSet`s carry their generation context (`based_on_timeline_revision` + both fingerprints) so a stale proposal can be detected even if the revision counter has moved for unrelated reasons. A lifted `useReviewConversation` controller feeds both chat and the Version gallery from one source; Source Clips and the gallery derive their status badges from the same live Timeline snapshot rather than independent state.

**Key decisions (with rationale):**
- Canonical sequence fingerprint deliberately excludes `item_id` — only `source_clip_id`, `start_sec`, `end_sec`, `speed`, and `transform.{scale,x,y}` (floats rounded to 6dp, scores to 4dp, canonical JSON `sort_keys=True`) are hashed, so two Timelines with the same content but different item IDs are recognized as equal.
- Version regeneration must always be explicit and visible (an actual chat turn) — never a silent background model call. Version scrubbers navigate only; they never edit order/bounds/speed/transform (that stays a separate, later concern).
- Optimistic chat messages use a client-generated `client_message_id` for idempotent retry — the backend returns the same correlated response on retry rather than duplicating the message, since no database/distributed queue was in scope (a STOP condition explicitly rules out adding one).
- Frontend never generates or hashes a runtime `VersionSet` — the deterministic fallback previously in `frontend/.../mockVersions.ts` was ported into a typed backend factory so Manual Harness and model-unavailable turns still return a real backend-owned VersionSet instead of a client-side fake.
- Work was split between an "orchestrator" agent (scope/integration/review authority) and a "CLAUDE" implementation worker for two file-scoped tasks (Task 1: timeline identity/concurrency; Task 3: version playback scrubbers), each constrained to one task and required to produce exactly one commit — a collaboration-protocol choice to keep concurrent-edit risk low on a HIGH-risk (persisted schema, concurrency) plan.

**Landed commits:** `2ed448c` (revision-safe state identity), `a1caad8` (version provenance), `173bbbc`/`c093a6f` (version playback scrubbers), `279778d` (optimistic chat), `7d1900e`/`9db763e` (connected pipeline state), `95b2262` (scrubber/playhead alignment).

**Verification status:** Verified green at `f469e43` — 319 backend tests, ruff, frontend typecheck, frontend build, and `e2e/compare-versions.spec.ts` (1 passed). Explicitly **not re-run** in the reconcile pass that closed this plan: the full 3-spec Playwright suite (only the one spec above ran), `scripts/synthetic_e2e_qa.py`, the `react-doctor` diff gate, and an independent whole-branch Claude review — the plan's own Task 6 checklist (full release gates, independent review, adjudication of findings) was left unchecked, and closure notes state these were judged non-blocking rather than completed.

**Surprises / gotchas:**
- Revisions and fingerprints are deliberately different concepts: undo restores prior *content* but does **not** restore the old revision number (revision always increments monotonically forward, even across undo).
- A stale `expected_revision` must cause zero mutation (verified by an explicit red test), not a partial apply.
