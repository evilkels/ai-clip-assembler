# Connected Review Pipeline Design

Date: 2026-06-21
Status: Draft for review
Owner: Elvijs

## Goal

Make Review behave as one understandable editing workflow rather than four
adjacent surfaces. Agent chat, complete Version previews, Source Clips, and the
Working Timeline must share an explicit state model while preserving the
editor's authority over the exportable cut.

The design also fixes two concrete real-footage issues:

1. An editor message must appear immediately instead of waiting for the agent.
2. Every Version preview needs a segmented playback timeline with cut position,
   boundaries, and source context.

## Observed problems

- `ReviewChatPanel` only reconciles messages from the completed `/review/turn`
  response. The submitted editor message is invisible during a long model call.
- `VersionPlayer` plays a sequence but exposes only Play/Pause. It does not show
  total progress, clip boundaries, the current source, or seek affordances.
- Source Clip Include/Exclude already mutates the backend-authoritative Timeline
  Document, but the Review layout does not explain that this changes export.
- Agent Versions are immutable preview recipes. Manual timeline edits do not
  mutate them, and the UI provides no current/stale/provenance state.
- `Use this version` replaces the Working Timeline. The current confirmation
  does not summarize which later manual edits will be lost.
- Pending agent Proposals are simulated against one Timeline Document but can
  be accepted after a user or MCP client changes that document.

## Decisions

### Connected Pipeline

Keep the existing compare-first layout and make the direction explicit:

1. **Direct**: chat captures creative direction and creates Proposals and
   VersionSets.
2. **Compare**: three immutable complete Versions can be played and inspected.
3. **Inspect**: Source Clips are the shared Candidate Clip catalogue and can be
   manually included/excluded.
4. **Commit**: the Working Timeline is the only mutable, exportable cut.

Rejected alternatives:

- **Unified cut tabs** would make Versions and the Working Timeline siblings in
  one editor. It is a larger redesign and weakens three-way comparison.
- **Agent-centred review** would embed Versions primarily in chat. It makes
  comparison harder and overweights conversational interaction.

### Authority

- The persisted Timeline Document remains the sole authority for export.
- Previewing a Version never mutates the Timeline Document.
- Source Clip Include/Exclude always targets the Working Timeline.
- An in-app agent operation remains proposed until the editor accepts it.
- External MCP edits use the same operations core and reconcile over SSE.
- Applying a complete Version atomically replaces the Working Timeline in one
  undoable operation.
- Existing Versions never regenerate automatically after an edit or incur a
  hidden model call.

### Three Versions remain intentional

An external `claude -p` design review questioned whether three cuts create too
much cognitive load. This product explicitly uses three-way complete-cut
comparison, so the implementation retains three Versions. The UI may render
two when the validated agent response contains only two; it must not fabricate
an empty third Version.

## Domain model

### Timeline revision: concurrency only

Add `revision: int = 0` to `TimelineDocument`. The `TimelineController`
increments it monotonically after every successful state transition:

- apply, including Include/Exclude and `replace_timeline`
- undo and redo
- accepted agent operation batch

The revision is persisted with the document and returned through existing
Timeline APIs. It answers, "Has another writer committed since this work was
prepared?" It does **not** determine whether two cuts are equal.

Mutation requests that apply prepared work carry `expected_revision`. The
backend compares it inside the controller's write lock. A mismatch returns
HTTP 409 with the current document; the frontend reconciles and explains that
the Working Timeline changed.

### Fingerprints: content and staleness

Revision counters give false stale results after changes are undone. Use
server-generated SHA-256 fingerprints over canonical JSON instead.

`sequence_fingerprint` normalizes ordered Timeline Items to:

```text
source_clip_id, start_sec, end_sec, speed,
transform.scale, transform.x, transform.y
```

It excludes `item_id`, because a Version recipe has no live item IDs. Canonical
JSON uses sorted keys and compact separators; times, speed, and transforms are
rounded to six decimal places before hashing. This fingerprint answers whether
a Version's playable sequence exactly matches the Working Timeline.

`review_context_fingerprint` covers every input that can materially change an
agent VersionSet:

- normalized sequence above
- sorted Timeline decisions
- profile and target duration
- the exact bounded Candidate Clip context supplied to the producer: IDs, file
  IDs, Scene IDs, bounds, speeds, and scores (scores round to four decimals)

It answers whether a VersionSet was generated from the current review context.
The context builder owns both deterministic candidate selection and this
fingerprint; prompt string truncation must not define context membership.
Re-analysis that changes a consumed Candidate Clip therefore makes prior
Versions stale even when the sequence itself did not change.

Both fingerprints are computed by a focused backend helper and returned, not
trusted from clients.

### VersionSet

Replace the frontend's unqualified `Version[]` state with:

```ts
interface VersionSet {
  version_set_id: string;
  versions: Version[];
  created_at: string;
  based_on_timeline_revision: number;
  based_on_sequence_fingerprint: string;
  based_on_review_context_fingerprint: string;
}
```

The VersionSet is stored in the originating agent Review Message payload. The
message itself supplies the originating `message_id`; that ID is not duplicated
inside the set.

Every `Version` additionally stores its own `sequence_fingerprint`, computed by
the backend after validation. The frontend never implements a competing hash.

The backend owns VersionSet creation for every producer. Pi output is validated
and fingerprinted there; Manual Harness and model-failure paths use a backend
deterministic Version factory with the same contract. The current frontend
`proposeVersions` implementation may be ported as that factory and retained
only as a test fixture during migration. Review rendering never invents an
unqualified local VersionSet.

Version state is derived as follows:

- **In working timeline**: Version fingerprint equals the current sequence
  fingerprint.
- **Current suggestion**: VersionSet context fingerprint equals the current
  review-context fingerprint and the Version is not applied.
- **Out of date**: VersionSet context fingerprint differs and no Version in the
  set matches the Working Timeline.
- **Unavailable**: any referenced Candidate Clip no longer exists after
  re-analysis. Preview may show surviving media, but Apply is blocked and names
  the missing clips.

An applied Version is not immediately labelled stale merely because applying
it advanced the revision: its sequence fingerprint still matches.

### Prepared Proposals

Add `based_on_timeline_revision` to operation Proposals. Accepting a Proposal
uses a new atomic controller batch path:

1. lock the controller
2. compare `expected_revision`
3. simulate all operations
4. record one undo snapshot
5. publish one persisted document and one SSE event

A stale Proposal is not partially replayed against a different timeline. The
UI offers **Ask agent to refresh**, not a blind force-apply action.

The Review turn captures a deep Timeline Document snapshot before calling the
model. Proposal simulation and `based_on_timeline_revision` both use that same
snapshot, even if another writer changes the live controller during the model
call. Acceptance is the point that compares the captured revision with live
state.

Complete Versions and operation Proposals remain separate wire shapes in the
first implementation, but use one product language: both are agent proposals
that can be **Apply to working timeline**. A future backend consolidation is
not required to make the workflow coherent.

## Interaction design

### Optimistic editor messages

On submit:

1. Generate a UUID `client_message_id`.
2. Immediately append an editor bubble with `Sending` state and clear input.
3. POST the message and ID.
4. Reconcile the optimistic bubble by that exact ID when the session returns.
5. On failure, retain the text with `Not sent · Retry`.

Extend `ReviewMessage` with optional `reply_to_message_id` and accept the
client-generated ID as the persisted editor `message_id`. The backend behavior
is idempotent:

- an unseen ID appends the editor message and runs the turn
- an existing ID with a correlated agent reply returns the existing result
- an existing ID without a reply resumes the turn without duplicating the
  editor message

Only one turn is composed at a time in the UI. Stable IDs still protect against
lost responses and retry duplication.

### Version playback timeline

Each Version card includes a compact, segmented scrubber below its video:

- segment width equals effective duration `(end - start) / speed`
- distinct restrained segment colors expose cut boundaries
- playhead tracks total Version time
- label shows `current / total`, `clip N of M`, current filename, and source
  timecode
- clicking or dragging the scrubber seeks into the corresponding segment
- keyboard Left/Right seeks by one second of Version time
- the scrubber navigates only; it never trims, reorders, or changes speed
- starting one Version pauses any other Version player
- reduced-motion preferences disable animated playhead transitions

`useSequencePlayer` becomes the timing authority. It exposes total-time
progress and a seek-by-Version-time method so the UI does not duplicate segment
math.

### Source Clip connection

Source Clips are not another timeline. They are the Candidate Clip catalogue
used by agent Versions and the Working Timeline.

Every visible Source Clip shows:

- **Timeline #N** when present in the Working Timeline
- **Proposed in A/C** only when the latest VersionSet is current
- Include/Remove copy that explicitly names the target: **Add to working
  timeline** / **Remove from working timeline**

Version-membership badges are derived from the bounded current set (at most
four Versions) and hidden when the set is stale. This avoids presenting old
proposal membership as live state.

Any user, accepted-agent, or MCP mutation reconciles the Timeline badge through
the existing authoritative document/SSE path.

### Stale VersionSet and refresh

When current review context differs, retain the playable Versions and show one
warning above the gallery:

> Working Timeline or Source Clips changed since these Versions were created.

The action **Ask agent to refresh versions** sends a visible editor message
that includes the user's intent in plain language. It is not a hidden endpoint
or automatic regeneration. While refreshing, old Versions remain playable and
the header shows `Updating`; a successful response replaces the gallery
atomically with the latest VersionSet.

### Applying a Version

Rename `Use this version` to **Apply to working timeline**. Before mutation,
show a comparison against the **current** Timeline Document, never the Version's
original baseline:

- current and proposed item count/duration
- clips added and removed
- clips whose trims, speed, transform, or position change
- explicit warning when manual changes will be replaced

Apply sends `replace_timeline` with `expected_revision`. A revision conflict
closes no data: refresh current state and ask the editor to review the updated
comparison. Success produces one undo entry and labels the matching Version
**In working timeline**.

### Relationship cues

Use compact numbered zone labels and explanatory copy rather than connecting
lines across a responsive layout:

- `1 · Direct` — Tell the agent what to change
- `2 · Compare` — Preview complete proposed cuts
- `3 · Inspect` — Add individual Source Clips to the Working Timeline
- `4 · Commit` — Working Timeline · authoritative · sent to export

The persistent helper text is:

> Versions are snapshots. Source Clip edits change the Working Timeline, not
> these previews.

## Error and conflict behavior

- A failed chat send retains the optimistic bubble and exposes Retry.
- A successful backend turn whose response is lost is recovered by message ID
  without a duplicate editor or agent turn.
- A stale operation Proposal returns a conflict card with Refresh; no operation
  is applied.
- A Version adoption conflict retains both the VersionSet and current Working
  Timeline, then rebuilds the comparison.
- A Version referencing removed Candidate Clips is visibly unavailable and
  cannot be applied.
- Agent refresh failure leaves the prior VersionSet playable with its stale
  warning.
- Fingerprint or revision fields missing from legacy persisted data are
  backfilled deterministically during load.

## API and persistence changes

- `TimelineDocument`: add persisted `revision`.
- Timeline document responses: add server-derived sequence and review-context
  fingerprints.
- Timeline operation request: add optional `expected_revision`; prepared work
  requires it, while direct single user operations can continue against the
  latest locked state.
- `Proposal`: add `based_on_timeline_revision`.
- `ReviewTurnRequest`: add `client_message_id`.
- `ReviewMessage`: add optional `reply_to_message_id`.
- Agent Review Message payload: replace bare `versions` with a typed
  `version_set`; retain a read migration for existing persisted `versions`.
- Manual/model-failure Review turns: return backend-created deterministic
  VersionSets; remove frontend fallback as a runtime producer.
- Review Session schema version increments with a backward-compatible loader.

No database is introduced. Folder-project JSON remains authoritative.

## Testing strategy

### Backend

- fingerprint determinism, field coverage, and item-ID independence
- sequence equality after undo/redo despite a newer revision
- monotonic revisions across apply, undo, redo, batch Proposal acceptance, and
  Version adoption
- stale expected-revision rejection with zero mutation
- atomic multi-operation Proposal acceptance with one undo snapshot/event
- chat message idempotency for initial send, lost-response retry, and resume
- VersionSet provenance and fingerprint persistence
- re-analysis invalidates context and blocks Versions with missing clips

### Frontend and Playwright

- delayed Review response shows the editor bubble immediately with Sending
- success reconciles the same message ID; failure retains Retry
- each Version shows segments, total/current time, current filename, and source
  timecode
- clicking a segment seeks correctly and playing a second Version pauses the
  first
- manual Source Clip inclusion updates the Working Timeline and Timeline badge
- a context change shows the stale banner without replacing Versions
- Refresh emits a visible editor turn and atomically replaces the VersionSet
- applying a Version displays a current-state diff, uses revision guarding, and
  remains undoable
- SSE/MCP mutation updates membership and makes prepared work stale
- missing Candidate Clips disable Apply with an explanation

The existing `compare-versions.spec.ts` remains the end-to-end Review contract;
split focused helpers or an additional spec if the file becomes difficult to
diagnose.

## Delivery slices

1. **Immediate conversation feedback**: optimistic/idempotent Review messages.
2. **Authoritative identity**: revision, fingerprints, VersionSet provenance,
   and conflict responses.
3. **Connected application flow**: atomic Proposal batches, current-state Apply
   comparison, Source Clip badges, stale/refresh behavior.
4. **Playable comparison**: segmented Version scrubbers and exclusive playback.
5. **Relationship polish**: numbered zones, explicit target copy, responsive
   and accessibility verification.

Each slice must leave the workflow usable and independently testable.

## Out of scope

- automatic Version regeneration
- editing trims/order/speed from a Version scrubber
- branching or naming multiple persistent Working Timelines
- concurrent-edit merge UI; conflicts refresh and retry instead
- rendered proxy files for Versions
- changing the three-Version comparison product direction
- broad Review shell redesign beyond connection/status cues
- analytics across historical VersionSets

## External design review disposition

The `claude -p` second opinion supported the Connected Pipeline and caused four
material corrections:

- content fingerprints, not revisions, determine equality/staleness
- prepared agent work uses optimistic concurrency
- Version adoption compares against current state and remains atomic/undoable
- operation and complete-cut proposals share product language

It also recommended removing Version-membership badges and reconsidering three
Versions. This design retains bounded current-set membership badges because the
user explicitly wants Source Clips connected to proposals, and retains three
Versions as an approved product requirement. Historical/stale membership is
deliberately not shown.

## Success criteria

- An editor message is visible within the submit event, before network response.
- Every Version exposes complete-cut position and segment boundaries and can be
  sought without mutating anything.
- The UI clearly identifies the Working Timeline as the export authority.
- A Source Clip visibly reports whether it is in the Working Timeline and in a
  current Version proposal.
- Manual, accepted-agent, and MCP edits converge through one live Timeline
  Document.
- Stale Proposals or Version adoptions cannot silently overwrite newer work.
- The editor can intentionally refresh stale Versions without losing the old
  playable set on failure.
