# 034 — Review chat timeline scripting (Lua)

Status: 🟡 in progress — planned 2026-09-29; R1 and S1–S4 done; S5 in progress. Branch: `feat/review-chat-scripting`. Decision record:
[ADR 0006](../adr/0006-review-scripts-compile-to-proposals.md).

## Goal

In the Review step, the Editor can write or paste a short **Lua** script in the
chat — the way they paste a Lua script into DaVinci Resolve's console — and the
Review Agent can answer with one. Running a script shows exactly what it will
change; applying it edits the Working Timeline as one undoable step.

```lua
-- "keep every shot under 3 seconds, best first, then land near 40s"
local clips = library:clips{ decision = "included" }
table.sort(clips, function(a, b) return a.score > b.score end)
timeline:clear()
for _, clip in ipairs(clips) do
  local item = timeline:add(clip)
  if item:duration() > 3 then item:trim(item:source_in(), item:source_in() + 3) end
  if timeline:duration() >= 40 then break end
end
log(("%d shots, %.1fs"):format(timeline:count(), timeline:duration()))
```

**Why scripts, when the agent can already propose JSON Operations:** a JSON
Operation list makes the model do per-item arithmetic against state it only
sees as text, and it cannot express "for every", "until", "sorted by". A script
states the intent and the runtime does the arithmetic against the real
Timeline Document. It is also readable, editable and re-runnable by the Editor,
and scripts the Editor writes need no model and no cloud consent.

## Decisions

| # | Decision |
|---|---|
| D1 | **Lua 5.4 embedded in the backend via `lupa`** (engine and version pinned by the [runtime research](../specs/2026-09-29-lua-scripting-runtime-research.md)). Lua because the Editor asked for the Resolve console workflow and models write Lua well. Not Python (cannot be sandboxed) and not a home-grown DSL. |
| D2 | **Our own small API, not Resolve's.** Names read like an editor's vocabulary (`timeline`, `library`, `item:trim`). Running unmodified `DaVinciResolveScript` scripts is out of scope. |
| D3 | **A script never touches the live Timeline.** It runs against a copy; every mutating API call is one Operation from `timeline_ops.OPERATIONS`, applied to the copy and recorded. Reads see the copy, so later lines see earlier edits. The result is an ordinary **Proposal** whose Operations are the recording (ADR 0002 unchanged: the Operations core stays the only mutation path). |
| D4 | **Run, then Apply — for everyone.** Run is a dry run that shows the change list, item counts and duration before/after, the script's log, or its error with the line number. Apply accepts the Proposal through `apply_batch`: one revision, one undo step. Apply replays the recording and never re-runs the script (pairs order and sort ties differ between runs). Editor scripts and agent scripts use the same flow. |
| D5 | **Replay is exact.** Items created inside a batch get ids seeded by the Proposal id (S2), so `local a, b = item:split(4); b:set_speed(2)` validates in the dry run and replays identically on Apply. |
| D6 | **Stale runs re-run, not rebase.** If the Timeline changed since the run, Apply gets the existing 409; the card offers **Run again**, which runs the same source against the current Timeline and produces a new Proposal. The old one becomes `superseded`. |
| D7 | **Where the Editor writes scripts:** the Review chat composer gets a **Message / Script** switch. Script mode is a monospace editor; ⌘↩ runs it. The Editor's script message carries its own result (Proposal or error). No model call, so no consent is needed. |
| D8 | **Agent scripts:** the Review Agent's reply may carry `"script"`; the backend runs it exactly like an Editor script and attaches the result to the agent message. The prompt's API reference is generated from the same table that binds the API, so prompt and runtime cannot drift. A turn that returns a script or Operations and no Versions attaches **no** fabricated VersionSet. No automatic repair round in v1. |
| D9 | **Sandbox and limits** (verified in the [runtime research](../specs/2026-09-29-lua-scripting-runtime-research.md)): `lupa==2.8`, imported as `lupa.lua54`; a fresh runtime per run, **in a short-lived worker process** (the backend relaunched with `--script-worker`). The API calls `run_script` through `asyncio.to_thread`; `run_script_in_process` is for tests and the worker only. The worker reports ready after boot (startup has its own 10 s budget) and is hard-killed at `timeout + 1 s` after that: the hook cannot interrupt a single native C call, so the process kill is the guarantee, and in-process caps (`string.rep`, `string.find`, `table.move`, a C-call hook, per-Operation deadline checks) turn ordinary overruns into named errors. Closed: every one of the research's 16 escape vectors, including `python`, `getmetatable`, `__gc` and `__close` metatables, coroutines and Lua patterns. Limits: source ≤ 64 KB, ≤ 20 M instructions and ≤ 2 s wall (instruction and C-call hooks), ≤ 16 MiB Lua memory, ≤ 1000 recorded Operations, ≤ 200 log lines of ≤ 500 chars. The first limit, Lua memory error or Operation error is sticky — `pcall` re-raises it and the run fails even if the script returns — and `setmetatable` installs a validated copy, so later changes to the script's table have no effect. API string arguments are capped at 4096 bytes (log lines are cut instead), the recording at 1 MiB of JSON and worker stdout at 16 MiB; the worker streams each log line as it is written, so a killed run keeps its log. |
| D10 | **Same rules as the GUI.** Operations are validated by the Operations core exactly as GUI edits are; an invalid call raises a Lua error at that line and the run produces no Proposal. Agent-specific limits (candidate bounds, no repeats) are not part of v1; see [review-visual-editing](review-visual-editing.md). |
| D11 | **Persisted with the conversation:** a `ScriptRun` (language, engine, source, author `editor`/`agent`, log, error, limits hit) is saved on the Review Message in `review-session.json`, next to its Proposal. |

## Script API v1

Indices are 1-based; times are source seconds. `Item` handles read the working
copy live, so they are never stale inside a run.

| Call | Operation / effect |
|---|---|
| `timeline:items()` / `timeline:item(i)` / `timeline:count()` | read |
| `timeline:duration()` | read — effective, speed-aware seconds |
| `timeline:add(clip_or_id [, at])` → Item | `add_item` (at 1-based index; default end) |
| `timeline:clear()` | `remove_item` for every item |
| `timeline:set_target_duration(sec)` / `timeline:set_profile(name)` | `set_target_duration` / `set_profile` |
| `item:id()`, `item:clip_id()`, `item:index()`, `item:source_in()`, `item:source_out()`, `item:speed()`, `item:duration()`, `item:transform()` | read |
| `item:trim(in_sec, out_sec)` | `set_bounds` |
| `item:split(at_sec)` → Item, Item | `split_item` |
| `item:move(to)` | `reorder` (1-based) |
| `item:set_speed(x)` | `set_speed` |
| `item:reframe{ scale=, x=, y= }` | `set_transform` |
| `item:remove()` | `remove_item` |
| `library:clips{ decision = "included" \| "excluded" \| "unreviewed" }` | read — array of plain Clip tables |
| `library:clip(id)` | read |
| `library:include(id)` / `library:exclude(id)` / `library:reset(id)` | `include` / `exclude` / `reset_decision` |
| `log(...)`, `print(...)` | append to the run log |

A Clip table: `id`, `file_name`, `source_in`, `source_out`, `duration`,
`score`, `smoothness`, `decision`, `reason`. Standard library available:
`math`, `table`, `utf8`, `ipairs`, `pairs`, `next`, `select`, `type`,
`tostring`, `tonumber`, `error`, `assert`, `pcall`, `setmetatable` (no `__gc`),
and `string` without `dump`, `match`, `gmatch` and `gsub`; `string.find` is
plain-substring only and `string.rep` is capped. `pairs` order over string keys
is unspecified, so scripts that must be repeatable iterate arrays with `ipairs`;
every list the API returns is an array.

## Slices

Each slice is its own branch off `feat/review-chat-scripting`, worked by a
delegated implementer in `.worktrees/`, reviewed here, and merged back.

| Slice | Scope | Depends on | Status |
|---|---|---|---|
| R1 | Runtime research: pin lupa engine/version, verified sandbox + limits sketch, PyInstaller needs | — | 🟢 [done](../specs/2026-09-29-lua-scripting-runtime-research.md) |
| S1 | Remove the Local Qwen harness (owner decision 2026-09-29), with a load-compat test for projects that selected it | — | 🟢 merged |
| S2 | Deterministic item ids inside a prepared batch (D5) | — | 🟢 merged |
| S3 | `backend/src/timeline_script.py`: sandboxed runtime, API bindings, recording, limits, errors — pure module, no HTTP | R1, S2 | 🟢 merged (S3–S3d, after two independent reviews) |
| S4 | Contract: `ScriptRun` model, `ReviewMessage.script`, `superseded` status, `POST /projects/{id}/review/script`, agent `script` replies (D8), prompt API reference, generated types | S3 | 🟢 merged (after an independent review and one fix round) |
| S5 | Frontend: composer switch, script message rendering, Run/Apply/Run again, e2e `review-scripting.spec.ts` | S4 | 🔴 |
| S6 | Ship: pin `lupa` in `requirements.txt`, PyInstaller spec, packaged-backend smoke, User Guide "Scripting in Review", glossary terms | S3 (packaging), S5 (docs) | 🟡 lupa pin, spec and `--script-worker` done in S3; a local PyInstaller (Python 3.12, arm64) build ran scripts through the packaged worker on 2026-10-02; docs and an endpoint-level smoke remain |

### Acceptance by slice

- **S3** — each API call records the expected Operation with 0-based args;
  reads reflect earlier writes; split handles are mutable and the recording
  replays through `apply_batch(id_seed=…)` to the dry-run result; the same
  script on the same document records identical Operations; each blocked
  capability raises; runaway loop, memory bomb, >1000 Operations and log
  overflow stop with a named limit; runtime and syntax errors carry the script
  line; an Operations-core error surfaces as a Lua error at the calling line.
- **S4** — Editor script → Proposal on the Editor's message, no agent call and
  no consent required; agent reply with `script` → Proposal on the agent
  message with no fabricated VersionSet; accept is one revision and one undo
  snapshot; stale accept is 409 and Run again supersedes; errors persist and
  reload with the session; the event loop keeps answering during a slow run.
- **S5** — e2e: paste the Goal's example → preview lists the changes → Apply →
  Timeline shows the new order and trims → Undo restores; a syntax error
  shows its line and nothing changes; a stale run offers Run again.
- **S6** — the packaged backend runs a script; the User Guide documents the
  API with three worked examples.

## Out of scope

- Running Resolve (`DaVinciResolveScript`) or any other app's scripts, and any
  bridge to an external Editing App. #84's original framing stays closed.
- Saved script libraries, snippets, sharing, scheduling.
- Script access to frames, files, network, audio or analysis.
- `run_script` for External Agents over MCP (they already call Operations).
- Automatic repair rounds when an agent script fails.

## Risks

- **Sandbox escape.** Mitigated by D9, the R1 escape tests carried into S3's
  suite, and no filesystem or Python objects exposed. A script can only change
  the Timeline, and only after Apply.
- **Packaging.** lupa is a compiled extension; S6 proves the DMG backend loads it.
- **Model quality.** Agent scripts may be wrong; the dry run, the error line and
  the Editor's approval are the guard in v1.

## Relation to other work

[review-visual-editing](review-visual-editing.md) (#84's current spec) is
sequenced after this plan. S4 delivers its "no fabricated Versions" rule for
script and Operation turns; its visual context, candidate-bound enforcement and
export verification remain there.
