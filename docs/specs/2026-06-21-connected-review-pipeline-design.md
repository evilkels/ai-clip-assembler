# Connected Review Pipeline Design

Date: 2026-06-21 · Status: Approved (shipped) · Owner: Elvijs

## Goal

Make Review behave as one understandable editing workflow rather than four
adjacent surfaces. Agent chat, complete Version previews, Source Clips, and the
Working Timeline share an explicit state model while preserving the editor's
authority over the exportable cut. It also fixed two real-footage issues: an
editor message must appear immediately instead of waiting for the agent, and
every Version preview needs a segmented playback timeline with cut position,
boundaries, and source context.

## Observed problems (at design time)

The submitted editor message was invisible during a long model call.
`VersionPlayer` exposed only Play/Pause. Source Clip Include/Exclude mutates
the backend-authoritative Timeline Document, but the layout did not explain
that this changes export. Agent Versions are immutable preview recipes with
no current/stale/provenance state. `Use this version` replaced the Working
Timeline without summarizing lost manual edits. Pending agent Proposals were
simulated against one Timeline Document but could be accepted after another
writer changed it.

## Decisions

Keep the compare-first layout and make the direction explicit: **Direct**
(chat creates Proposals and VersionSets) → **Compare** (three immutable
complete Versions) → **Inspect** (Source Clips, the shared Candidate Clip
catalogue, manually included/excluded) → **Commit** (the Working Timeline,
the only mutable exportable cut).

Rejected: **Unified cut tabs** (Versions and Working Timeline as siblings —
weakens three-way comparison); **Agent-centred review** (Versions embedded
primarily in chat — makes comparison harder, overweights conversation).

### Authority

The persisted Timeline Document remains the sole authority for export.
Previewing a Version never mutates it. Source Clip Include/Exclude always
targets the Working Timeline. An in-app agent operation remains proposed
until the editor accepts it; external MCP edits use the same operations core
and reconcile over SSE. Applying a complete Version atomically replaces the
Working Timeline in one undoable operation. Existing Versions never
regenerate automatically or trigger a hidden model call. An external
`claude -p` design review questioned whether three cuts create too much
cognitive load; this product explicitly uses three-way comparison, so the
implementation retains three Versions — the UI may render two when the
validated response contains only two, but must not fabricate an empty third.

## Domain model

`TimelineDocument.revision: int` increments monotonically after every
successful state transition. It answers "has another writer committed since
this work was prepared?" — it does **not** determine whether two cuts are
equal. Mutation requests that apply prepared work carry `expected_revision`; a
mismatch returns HTTP 409 and the frontend reconciles. Revision counters give
false-stale results after undo, so server-generated SHA-256 fingerprints over
canonical JSON answer equality instead. `sequence_fingerprint` normalizes
ordered Timeline Items (excluding `item_id`, since a Version recipe has no
live item IDs) and answers whether a Version's sequence exactly matches the
Working Timeline. `review_context_fingerprint` additionally covers Timeline
decisions, profile/target duration, and the bounded Candidate Clip context
supplied to the producer, and answers whether a VersionSet was generated from
the current review context — re-analysis that changes a consumed Candidate
Clip makes prior Versions stale even when the sequence itself did not change.
Both are computed backend-side and returned, never trusted from clients.

A `VersionSet` (versions, `based_on_timeline_revision`, both fingerprints)
lives in the originating agent Review Message; every `Version` stores its own
`sequence_fingerprint`. The backend owns VersionSet creation for every
producer so review rendering never invents an unqualified local VersionSet.
Version state: **In working timeline** (fingerprint matches current
sequence), **Current suggestion** (context fingerprint matches, not
applied), **Out of date** (context fingerprint differs, nothing matches), or
**Unavailable** (a referenced Candidate Clip no longer exists — Apply is
blocked).

Proposals carry `based_on_timeline_revision`. Acceptance is one atomic
controller batch: lock, compare `expected_revision`, simulate, record one
undo snapshot, publish one document/SSE event. A stale Proposal is never
partially replayed; the UI offers **Ask agent to refresh**, not a blind
force-apply. Complete Versions and operation Proposals remain separate wire
shapes but share one product language — both are agent proposals that can be
**Apply to working timeline**.

## Interaction design

A client-generated `client_message_id` lets the editor chat bubble appear
immediately (`Sending`) and reconcile by ID when the turn returns, with
`Not sent · Retry` on failure; the backend is idempotent on that ID.
Each Version card gets a compact segmented scrubber (segment width is
effective duration `(end - start) / speed`, distinct colors mark cut
boundaries) that navigates only — never trims, reorders, or changes speed.
Starting one Version pauses any other player. `useSequencePlayer` is the
single timing authority so the UI does not duplicate segment math.

Source Clips are the Candidate Clip catalogue used by both agent Versions and
the Working Timeline, not another timeline. Each visible clip shows
**Timeline #N** when in the Working Timeline and **Proposed in A/C** only
when the latest VersionSet is current, with Include/Remove copy that names
the target explicitly. Membership badges derive from the bounded current set
and hide when stale.

When review context changes, keep the playable Versions and show one warning
banner. **Ask agent to refresh versions** sends a visible editor message, not
a hidden endpoint or automatic regeneration; old Versions stay playable while
refreshing and a successful response atomically replaces the gallery.
`Use this version` → **Apply to working timeline**. Before mutation, compare
against the **current** Timeline Document (never the Version's original
baseline), with an explicit warning when manual changes will be replaced.
Apply sends `replace_timeline` with `expected_revision`; a revision conflict
refreshes state and re-shows the comparison. Numbered zone labels (`1 ·
Direct`, `2 · Compare`, `3 · Inspect`, `4 · Commit`) replace connecting
lines, with helper text clarifying that Versions are snapshots and only
Source Clip/Working Timeline edits are live.

## Error, conflict, and API changes

Failed chat send retains the optimistic bubble with Retry; a lost successful
response is recovered by message ID without duplication. A stale Proposal
returns a conflict card with Refresh and applies nothing. A Version adoption
conflict retains both the VersionSet and current Working Timeline, then
rebuilds the comparison. Legacy fingerprint/revision fields are backfilled
deterministically on load.
`TimelineDocument` gained persisted `revision` and server-derived
fingerprints; operation requests gained optional `expected_revision`;
`Proposal` gained `based_on_timeline_revision`; `ReviewTurnRequest` gained
`client_message_id`; `ReviewMessage` gained optional `reply_to_message_id`;
the Review Message payload replaced bare `versions` with a typed
`version_set`. No database was introduced — folder-project JSON remains
authoritative.

## Out of scope, and external review

Out of scope: automatic Version regeneration; editing trims/order/speed from
a scrubber; branching/naming multiple Working Timelines; concurrent-edit
merge UI (conflicts refresh and retry instead); rendered proxy files;
changing the three-Version direction; broad Review shell redesign; analytics
across historical VersionSets.

A `claude -p` second-opinion review supported the Connected Pipeline and
drove four corrections: content fingerprints (not revisions) determine
equality/staleness; prepared agent work uses optimistic concurrency; Version
adoption is atomic/undoable against current state; operation and complete-cut
proposals share product language. It also recommended removing
Version-membership badges and dropping to two Versions — both kept as
approved product requirements.
