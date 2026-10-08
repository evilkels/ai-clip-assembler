# Review visual editing: the AI edits like a Resolve console

The Editor asks for a story cut in the Review chat; the In-App Review Agent
looks across the whole Candidate Clip library, writes a Script, runs it, fixes
its own errors, and answers with exactly one Proposal the Editor can preview,
apply as one undo step, or discard. Failure is one honest message, never a
made-up edit.

## Context

Roadmap milestone 4 ([../ROADMAP.md](../ROADMAP.md)). Builds on
[034](done/034-review-chat-timeline-scripting.md) (Scripts compile to
Proposals, [ADR 0006](../adr/0006-review-scripts-compile-to-proposals.md)) and
runs every model call through the AI call from
[038](038-ai-connection.md) (typed failures, locked-down payload, Claude Code or
Codex as the AI Engine). Depends on 038's milestone 3 phase: the repair loop
multiplies calls and must be tuned on the real engines and their real quota
errors. Payload rule ([ADR 0007](../adr/0007-ai-access-is-granted-when-connecting.md)):
only Frame Samples, file names (never folder paths), clip timings and scores,
the Timeline and the chat leave the Mac.

What the code does today (`backend/src/review_agent.py`,
`backend/src/api.py:1171`): the prompt gets candidate JSON cut at 6,000
characters, frame labels with absolute paths cut at 4,000, the Timeline at
6,000 and the last twelve messages at 6,000; slicing can end mid-record. Frames
are first/middle/last per candidate, stopping at twelve in library order, so
only the first four clips are ever seen. One model call, one local Script run,
no repair. A chat-only turn mints deterministic Versions
(`review_agent.py:541`). The Lua runtime lets any author add an excluded clip
and trim to the whole Source Video (`timeline_script.py:825`, `:853`).

This rewrite absorbs [agent-operable-timeline](done/agent-operable-timeline.md).
Carried over: the pan part of the transform preview (4.4) and propose → apply
Playwright coverage (4.5). Dropped: chat token streaming (not in v1.0.0 per the
roadmap) and "crop" as a separate control (a Transform is scale plus pan;
there is no crop field, see `models.py:185`). The old plan's section 1
(transport, consent before dispatch) is 038's; its section 5 (export
verification) is [032](032-valid-fcpxml-and-nle-verification.md)'s.
agent-operable-timeline was marked superseded by this plan on 2026-10-08.

### Decisions

- **D1 Evidence module.** New `backend/src/review_evidence.py` builds
  everything the AI sees: candidate records, the Timeline record, contact
  sheets, coverage and compacted history. `review_agent.py` only formats the
  prompt. One function, `eligible_candidates(project, document)`, decides
  membership for records, sheets and the fingerprint; `_review_inputs` in
  `api.py` calls it instead of filtering by hand.
- **D2 Complete compact records, never sliced.** One JSON object per line per
  Candidate Clip: `n` (1-based position in this list), `id`, `file` (file name
  only), `in`, `out`, `dur` (seconds, one decimal), `score`, `smooth`,
  `visual` (one decimal), `look` (Look Group or null), `decision`
  (`included` / `excluded` / `unreviewed`), `items` (how many Timeline Items
  play it), `reason` (cut to 80 characters). Excluded clips stay in the list,
  flagged, so the AI can say "you excluded X" instead of guessing. Cap: 400
  records; above that the lowest-scored are omitted and `coverage` says how
  many. At 120 bytes a record, 400 records are about 48 KB.
- **D3 Contact sheets, not loose frames.** Frame Samples reach the AI as
  labelled contact sheets built with Pillow (already a dependency): 4 × 5
  tiles of 320 × 180 px with a 24 px caption strip `#n  FILE  m:ss`, so one
  sheet is 1280 × 1020 px. The **library sheet set** has one tile per
  non-excluded candidate, the Frame Sample nearest the clip's midpoint, in
  library order (source file, then time) so progression is visible; above 160
  candidates the top 160 by Overall Score are kept, still in library order, and
  coverage says so. The **Timeline sheet set** has first, middle and last
  Frame Samples inside each Timeline Item's bounds, in Timeline order, up to 20
  items. Hard cap: 11 sheets per call. Sheets are written to
  `<samples_dir>/sheets/<sha1 of the tile list>.jpg` and reused when the hash
  matches. Captions carry no paths; the AI call from 038 attaches only these
  files.
- **D4 One closer look per turn.** The reply contract is
  `{"message", "script"?, "look"?: [clip ids, at most 8]}`. A reply with
  `look` and no `script` gets one more call with **detail sheets** for those
  clips (every Frame Sample in bounds, up to 24 tiles per clip, at most 10
  sheets) plus the first reply's message. The second reply cannot `look`
  again; a `look` there is ignored. This stays inside ADR 0007: only Frame
  Samples are added.
- **D5 Script → error → repair, bounded.** When the Script fails
  (syntax, runtime, operation, limit), the backend sends a repair call with the
  Script source, the error (kind, line, message), the run log, and the policy
  reminder from D6, asking for the complete corrected Script. At most **2
  repairs** (so at most 3 Script runs and, with D4, at most 4 AI calls per
  turn). Stop conditions: a run without error that records Operations → one
  Proposal; a run without error that records nothing → a chat-only message with
  the log and no Proposal; 2 repairs spent → one honest failure message
  (`I tried three times and my script still fails at line N: <message>.
  Nothing was changed. You can edit the last script below.`) with the last
  `ScriptRun` attached; a typed AI failure from 038 at any round → that
  failure's message, no Proposal. `payload.rounds` on the agent message lists
  each extra round (`{"kind": "look" | "repair", "line", "message"}`). No
  Versions and no Proposal are ever minted on failure; earlier Proposals in the
  session are untouched.
- **D6 Eligibility lives in the Lua runtime.** `ScriptPolicy` in
  `timeline_script.py`, chosen by author. Both authors: `timeline:add` of an
  excluded clip is an operation error at that line (`library:include` first
  is the way back, as today). Agent only: `item:trim` and `item:split` outside
  the Candidate Clip's own bounds are operation errors (the AI has only seen
  those frames); `item:set_speed` outside 0.25–4× is an operation error. The
  Editor keeps source-wide trims (GLOSSARY: Trim may extend). The rules are
  rendered into the API reference from the same policy object so prompt and
  runtime agree.
- **D7 Exactly one Proposal; Versions retired.** The AI edits by Script only.
  `versions` and `operations` leave the reply contract; the turn never attaches
  a `version_set`; `deterministic_versions`, `_validate_versions` and the
  "Suggested cuts" gallery go (Phase 5). Owner confirmation pending
  (asked 2026-10-08); until answered, this is the plan. The playable sequence player built for
  Versions (`VersionPlayer`, `useSequencePlayer`, `VersionScrubber`) is kept
  and renamed, because it is the cheap playable preview of a Proposal (D8).
- **D8 Playable preview is in.** `Proposal` gains `after_items` (the simulated
  result's items joined with `file_id`/`file_name`), and the Proposal card
  gets a **Preview** toggle that plays them with the existing sequence player.
  Nothing is written; the Timeline revision does not change.
- **D9 History is compacted, not sliced.** The last 8 messages as
  `{role, text ≤ 600 chars, script: {ok, error line+message, operation count,
  first 5 change-list lines}}`; the most recent agent Script source is included
  in full (cut at 8 KB), older sources are not. No `version_set`, no paths.
- **D10 Kickoff is one call.** The opening turn asks for a one-line take with
  no Script and gets no look or repair rounds: opening Review must not spend
  four calls of the Editor's quota.
- **D11 Transport is 038's.** The AI call from 038 is awaited off the event
  loop, enforces the attachment list and returns typed failures. This plan
  passes it a prompt and a list of sheet paths and nothing else.

## Phase 1: Library-wide evidence

- [ ] 1.1 Add `eligible_candidates(project, document)` in
  `backend/src/review_evidence.py` and use it from `_review_inputs`. Done when
  `backend/tests/test_review_evidence.py::test_eligible_candidates_flags_excluded_instead_of_dropping`
  passes and `test_api.py::test_excluded_clips_are_hidden_from_the_review_agent`
  is rewritten to assert the excluded clip appears with `decision: "excluded"`.
- [ ] 1.2 Candidate records per D2 (`candidate_records(...)` → list of dicts,
  `records_jsonl(...)` → text). Done when a test with 500 candidates asserts
  every line parses as JSON, exactly 400 records are present, the omitted
  count is in `coverage`, and the text contains no `/` character.
- [ ] 1.3 Timeline record: ordered items as `{n, id, clip_n, clip_id, file,
  in, out, speed, scale, x, y, dur}` plus `profile`, `target_sec`, `total_sec`,
  as JSON Lines with a header line. Done when a test on a 30-item Timeline
  asserts all 30 lines and the header totals.
- [ ] 1.4 Contact sheets per D3: `build_sheets(tiles, out_dir)` with Pillow,
  `library_tiles(...)` and `timeline_tiles(...)` choosing Frame Samples via
  `timestamped_frame_paths` (`api.py:1090`). Done when tests assert: 23 tiles
  → 2 sheets of the stated size; captions are `#n  FILE  m:ss` with no path;
  a second call with the same tiles reuses the file (mtime unchanged); an
  empty library yields no sheets; 200 candidates yield 8 sheets with the
  omitted count in coverage. Runs under `asyncio.to_thread`.
- [ ] 1.5 `coverage` dict `{clips, records, sheet_frames, timeline_items,
  sheets, omitted}` returned with the evidence and saved on the agent message
  as `payload.coverage`. Done when
  `test_review_agent.py::test_turn_saves_coverage_on_the_agent_message` passes.
- [ ] 1.6 `compact_history(messages)` per D9. Done when a test with 20
  messages, two with scripts and one with a legacy `version_set`, asserts 8
  entries, the newest script source present and the older one absent, and
  no `version_set` key.

## Phase 2: Eligibility in the Lua runtime

- [ ] 2.1 `ScriptPolicy(author, refuse_excluded=True, confine_to_clip,
  speed_range)` in `timeline_script.py`; `run_script`,
  `run_script_in_process` and `script_worker.py` take `policy`;
  `_run_script_proposal` in `review_agent.py` passes the author's policy. Done
  when every existing `test_timeline_script.py` test passes unchanged with the
  Editor policy.
- [ ] 2.2 Excluded clips: `_Session.add` raises an operation error
  `clip #n (FILE in–out s) is excluded; call library:include(clip) first`.
  Done when `test_add_of_an_excluded_clip_is_an_operation_error_with_its_line`
  passes for both policies and
  `test_api.py::test_editor_script_sees_excluded_clips_and_can_restore_them`
  still passes.
- [ ] 2.3 Agent trims stay inside the clip: `trim` and `split` outside
  `SourceClip.start_sec..end_sec` raise
  `in–out s is outside clip #n (a–b s); the AI may only use footage it has
  seen`. Done when `test_agent_policy_confines_trim_and_split_to_the_clip`
  passes and `test_editor_policy_still_trims_to_the_source_video` passes.
- [ ] 2.4 Agent speed range 0.25–4×. Done when
  `test_agent_policy_rejects_speed_outside_range` passes and the Editor policy
  accepts 8×.
- [ ] 2.5 Policy lines in the API reference (`_build_reference(policy)`), the
  agent prompt uses the agent reference. Done when
  `test_api_reference_names_exactly_what_the_runtime_exposes` and a new
  `test_agent_reference_states_the_policy_rules` pass.

## Phase 3: One turn, one Proposal

- [ ] 3.1 Reply contract per D4 and D7: `_parse_agent_json` accepts
  `message`, `script`, `look`; ignores `operations` and `versions`. Done when
  `test_parse_agent_json_reads_look_and_ignores_versions` passes.
- [ ] 3.2 Rewrite `_AGENT_PROMPT`: role, the story-cut brief (open, journey,
  reveal, close; fit the target duration; use clips from across the files;
  name `#n` and file names in prose), what the sheets are (`#n` in a caption
  is record `n`), the three evidence sections, the agent API reference, the
  reply contract. Prompt text and sheet paths go to the AI call from 038.
  Done when `test_prompt_has_no_paths_and_carries_coverage` passes and a
  measured prompt for 400 records is under 80 KB (number recorded in the test).
- [ ] 3.3 Closer-look round per D4 (`detail_tiles(clip_ids)` in
  `review_evidence.py`). Done when
  `test_look_reply_gets_one_detail_call_then_one_proposal` passes with a fake
  AI call that returns `look` first and a Script second, asserting two calls,
  detail sheets only on the second, one Proposal.
- [ ] 3.4 Repair loop per D5 (`run_review_turn`). Done when these pass in
  `test_review_agent.py`: `test_script_error_is_repaired_once_then_proposes`
  (fail, fix → one Proposal, `payload.rounds` has one repair with the line),
  `test_two_failed_repairs_end_in_one_honest_failure` (three errors → no
  Proposal, the failure text names the last line, last `ScriptRun` attached),
  `test_ai_failure_during_repair_keeps_earlier_proposals` (typed failure from
  038 on round 2 → its message, earlier Proposal still `pending`),
  `test_empty_recording_is_a_chat_only_reply`.
- [ ] 3.5 Kickoff per D10. Done when
  `test_api.py::test_review_kickoff_runs_a_proactive_turn` asserts exactly one
  AI call and no Script.
- [ ] 3.6 Call budget: a turn makes at most 4 AI calls and attaches at most 11
  sheets per call; the backend logs `review turn: N calls, M sheets, K bytes`.
  Done when `test_turn_never_exceeds_four_calls` passes with a fake that always
  asks to look and always fails.
- [ ] 3.7 (after H3) Stop minting Versions: remove the `version_set` branch from
  `run_review_turn`, `deterministic_versions`, `_FALLBACK_RECIPES`,
  `_validate_versions`; delete their tests. Done when no test or source in
  `backend/` references `deterministic_versions` and `test_api.py` asserts a
  chat-only turn's `payload` has no `version_set`.

## Phase 4: Review UI

- [ ] 4.1 Proposal card coverage and rounds: `Looked at 48 clips on 3 sheets`,
  `fixed after 1 retry`, `38.5 s of 40 s target` (from `payload.coverage`,
  `payload.rounds`, `after_duration_sec` and `target_duration_sec`) in
  `frontend/src/renderer/src/components/ProposalCard.tsx`. Done when
  `e2e/review-ai-turn.spec.ts` (4.5) asserts all three strings.
- [ ] 4.2 Honest failure card: an agent message with a `ScriptRun` error and
  no Proposal shows the error with its line and the Script with **Edit** (today
  only Editor scripts have Edit, `ScriptRunCard.tsx:27`). Done when the e2e
  asserts Edit loads the agent's Script into the composer.
- [ ] 4.3 Playable preview per D8: backend `Proposal.after_items` (add
  `file_id` to `SourceClip` in `timeline_ops.py:57`, fill it in
  `build_timeline_sources`, `api.py:928`); frontend **Preview** toggle on the
  Proposal card mounting the sequence player. Done when
  `test_review_agent.py::test_proposal_carries_after_items` passes and the e2e
  asserts playback advances while `GET /timeline/document` revision is
  unchanged.
- [ ] 4.4 Pan preview (carried from agent-operable-timeline):
  `ClipPreview.tsx:164` applies `scale(s) translate(x*100%, y*100%)` from a
  `transform` prop; `Timeline.tsx:618`, the sequence player and
  `TimelineItemRow.tsx:73` pass and edit `x`/`y`. Done when
  `e2e/timeline-playback.spec.ts` asserts the computed transform after
  setting x = 0.1.
- [ ] 4.5 `e2e/review-ai-turn.spec.ts` with 038's fake engine fixture: ask for
  a 40-second story cut → fake fails once then fixes → card shows the 4.1
  strings → Preview plays → Apply → Timeline route shows the items → one Undo
  restores the previous item list (the revision number goes up; undo is a
  new revision, `TimelineController.undo`). Done when it passes in
  `.github/workflows/test.yml` and is listed in `frontend/e2e/README.md`.
- [ ] 4.6 Verify Apply is one undo step (it is:
  `test_accepting_a_script_proposal_is_one_revision_and_one_undo`,
  `test_accept_is_one_atomic_revision_event_and_undo_snapshot`). Done when
  both are cited in 4.5's spec header and 4.5 asserts a single Undo click.

## Phase 5: Retire Versions, document

- [ ] 5.1 (after H3) Frontend: delete `VersionGallery`, `VersionCard`,
  `VersionApplyDialog`, `state/versionState.ts`, `types/version.ts`, the
  "Suggested cuts" zone and "Refresh suggestions" in `routes/Review.tsx`;
  rename `VersionPlayer` → `SequencePlayer` (props `items`, `title`) and
  `VersionScrubber` → `SequenceScrubber`; delete `e2e/compare-versions.spec.ts`
  and its README row. Done when `npm run lint`, `npm run typecheck` and
  `npm run test:e2e` pass with no `Version` identifier left in
  `frontend/src/renderer/src` (`grep -rn "VersionSet\|CreativeVersion"` empty).
- [ ] 5.2 (after H3) Backend: remove `CreativeVersionItem`, `CreativeVersion`,
  `VersionSet` from `models.py`, `review_context_fingerprint` from
  `review_state.py`; the review-session loader drops `payload.version_set`
  from old messages and bumps `schema_version` to 3; `gen:types` regenerated.
  Keep `replace_timeline` (an Operation with tests, used over MCP). Done when
  `test_project_store.py::test_review_session_v2_payloads_lose_version_sets`
  passes and `check:types-fresh` is clean.
- [ ] 5.3 Docs: `docs/USER_GUIDE.md` gains "Ask for a story cut" before
  "Scripting in Review" (what the AI sees, retries, Preview, Apply, Undo);
  `docs/ARCHITECTURE.md` replaces the "Creative Versions" paragraph with the
  evidence + loop description; `docs/MANUAL_QA_GUIDE.md` "Timeline and agents"
  gets the story-cut checklist. Done when the three files mention no
  "Versions" or "Suggested cuts".

## Human tasks

- [ ] H1 With Claude as the Active Provider, on
  `~/Movies/DRONE_VIDEO/ESTEPONA_03-05-26`: ask `Make a 40-second story cut:
  calm opening, the coast, the reveal of the town, a quiet close.` Record in
  this file: calls made, sheets attached, rounds, whether the Proposal used
  all four files, and whether Preview, Apply and Undo behaved.
- [ ] H2 The same with ChatGPT as the Active Provider, including one run that
  hits the usage limit, to confirm the failure message and that earlier
  Proposals survive.
- [ ] H3 Confirm that the "Suggested cuts" Versions gallery is retired (D7).
  Tasks 3.7, 5.1 and 5.2 wait for this answer; if the answer is no, they are
  rewritten to keep Versions as Editor-requested alternatives and never mint
  them on a failed or chat-only turn.
