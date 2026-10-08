# 038: AI Connection — honest AI errors, then Claude or ChatGPT through the Editor's own program

Supersedes: [030](done/030-truthful-ai-usage.md) (its one open step, "consent must be discoverable", is carried here as 5.6).

The app reports every AI failure by Provider name with what to do and when a limit resets, sends nothing beyond listed Frame Samples and text, and lets the Editor connect their own Claude or ChatGPT through a welcome wizard and a Providers screen. Pi is removed once Codex works.

## Context

Roadmap milestones 2 and 3 ([ROADMAP](../ROADMAP.md)): milestone 2 is
Phases 1–2, milestone 3 is Phases 3–5, then Pi is removed (Phase 6) and the
docs follow (Phase 7). Each phase is one PR. This plan implements
[ADR 0007](../adr/0007-ai-access-is-granted-when-connecting.md) (AI Access is
granted once, when connecting) and
[ADR 0008](../adr/0008-ai-runs-through-the-editors-own-provider-program.md)
(the AI Engines are the Editor's installed Claude Code and Codex; the app never
installs or signs in to them).

What the code does today (verified 2026-10-08 on `main` at `2874cd1`):

- Two call sites spawn the `pi` CLI with its `read` tool enabled, absolute
  frame paths in the prompt, and the repo root as cwd:
  `backend/src/pi_cli_harness.py` `_call_pi_cli` (scoring, one call per
  Candidate Clip) and `backend/src/review_agent.py` `default_review_agent`
  (Review turns, up to 12 frames). A third, `_ping_review_model` in
  `backend/src/api.py`, is the Diagnostics ping and runs with no AI Access check.
- Every failure collapses to one string. Scoring returns `_fallback_result`
  with a `warning` text; Review replies "I couldn't reach the review model just
  now" and, because that reply carries no script, `run_review_turn` then mints
  deterministic Versions (`review_agent.py`, the `if validated_versions or not
  (source or operations)` branch). The Diagnostics guidance keys off substrings
  (`_AUTH_MARKERS`, `_NETWORK_MARKERS`) and has no usage-limit case.
- Consent is `cloud_ai_consent` on the project manifest
  (`backend/src/project_store.py` `ProjectManifest`), saved only by a
  `window.confirm` in `frontend/src/renderer/src/routes/Import.tsx`
  `handleAnalyze`, and gated in `api.py` at `/analyze` (`is_cloud_harness`) and
  `_review_inputs`. Settings › AI assistance shows it but cannot change it.
- Sign-in is Pi's ChatGPT OAuth in Electron main
  (`frontend/src/main/reviewModelAuth.ts`), with the `pi` executable found by a
  login-shell probe (`frontend/src/main/piExecutable.ts`) and passed to the
  backend as `PI_BIN`. MCP client setup (`frontend/src/main/mcpConnect.ts`,
  `ConnectionsTabPanel.tsx`) is separate and stays.
- The backend runs with cwd = Electron `userData`, so
  `.ai-clip-assembler/settings.json` (`backend/src/app_settings.py`) is the
  per-machine settings file.

Carried over from 030: the no-consent chat stub must point at a working grant
action, Settings must grant and revoke, and an E2E must grant from that surface
and see the real agent. All three are tasks here (5.5, 5.6).

Replaces in [031](031-app-restyle-conformance.md): all of **Phase 5**
(Steps 4.1 harness popover, 4.2 "Pi Agent · cloud" copy rule, 4.3 consent gate,
4.4 consent E2E) and the harness/consent halves of **Step 2.2** (rail AI row
label) and **Step 2.6** (status-bar middle fact). 031's shipped Phase 4 panel
(`AiAssistancePanel.tsx`) is rebuilt by 5.2 here; 031 Step 2.11 (harness trigger
in the selection bar) stays in 031 but takes its trigger label from D13.

### Decisions

- **D1 Engine supervision runs in the Python backend**, package
  `backend/src/ai_engines/`. Both AI call sites, the per-project gate, the
  settings file and the analysis thread already live there; Python speaks
  JSON-RPC over stdio and newline-delimited JSON as well as Node does; and we
  run one tool-less turn per request, so the Claude Agent SDK and T3's
  session graph add nothing. Moving supervision to Electron main would need a
  backend→main job channel that does not exist. Electron main keeps only what
  needs the desktop: capturing the login-shell `PATH` (today's
  `piExecutable.ts` probe, generalised), the **Choose program…** file dialog,
  and opening vendor download pages.
- **D2 Module layout.** `ai_engines/__init__.py` exposes `get_engine(provider)`;
  `ai_engines/types.py` holds `AiRequest`, `AiReply`, `AiFailure`,
  `AiFailureKind`, `EngineStatus`; `ai_engines/engine.py` the `AiEngine`
  protocol (`status()`, `sign_in()`, `run(request) -> AiReply`,
  `usage() -> Optional[UsageSnapshot]`); `ai_engines/pi.py` (Phase 1, deleted
  in Phase 6), `ai_engines/claude_code.py`, `ai_engines/codex.py`;
  `ai_engines/discovery.py` (search order, fixture-testable);
  `ai_engines/payload.py` (lockdown); `ai_engines/messages.py` (Provider-named
  copy). `api.py` gains `ai_connection` routes in a new
  `backend/src/ai_connection.py` (state + gate), mounted as a router.
- **D3 Failure categories** (`AiFailureKind`, a `Literal`):
  `not_installed`, `incompatible_version`, `signed_out`, `usage_limit`
  (optional `resets_at` ISO-8601 UTC and `window` "5h" | "weekly" | null),
  `rate_limited` (optional `retry_after_sec`), `timed_out`, `network`,
  `unusable_reply`, `engine_error` (non-zero exit or protocol error, with a
  500-char sanitised detail), `cancelled`. `AiFailure` =
  `{kind, provider, message, action, detail?, resets_at?, retry_after_sec?}`
  where `action` is one of `open_providers`, `sign_in`, `retry`, `wait`,
  `none`. Two more kinds come from the gate (D15), not from an engine:
  `ai_not_connected` (AI Access not granted or no Active Provider;
  `provider` null; action `open_providers`; message "No AI connected yet.
  Connect Claude or ChatGPT in Settings › AI.") and `ai_off_for_project`
  (`provider` = the Active Provider; action `open_providers`; message "AI is
  off for this project. Turn it on in Settings › AI."). An Active Provider
  that is not ready yields that engine's own failure (`not_installed`,
  `incompatible_version` or `signed_out`). The code shows `incompatible_version`, `network`, `engine_error` and
  `cancelled` are needed beyond the ADR's six (version check in
  `reviewModelAuth.ts`, `_NETWORK_MARKERS`, non-zero exits, analysis cancel).
- **D4 Messages** live in `ai_engines/messages.py`, Provider-named, format
  `<Provider> <what happened>. <what to do>.` Examples that are final copy:
  `usage_limit` → "ChatGPT usage limit reached. It resets at 14:00 — your
  earlier suggestions are kept." (time in the Mac's local zone, "resets in
  about 3 h" when more than 12 h away, no time clause when `resets_at` is
  unknown); `signed_out` → "Claude is signed out. Sign in from Settings ›
  Providers."; `not_installed` → "Claude Code is not installed. Open Settings ›
  Providers to download it."; `timed_out` → "ChatGPT did not answer within
  2 minutes. Try again."; `unusable_reply` → "Claude answered, but not in a
  form the app can use. Try again." Never "harness", "Pi", "consent", "model".
- **D5 No Versions on failure.** A Review turn whose engine call fails stores
  an agent message with `payload.failure = AiFailure` and no `version_set`;
  the renderer's `latestVersionSet` already walks back to the last message
  that has one, so earlier suggestions stay. `deterministic_versions` is
  called only for a Manual-Harness project with no Active Provider (unchanged
  for that case).
- **D6 Scoring fallback stays a fallback** (030 decision): a failed AI scoring
  run keeps the rule-based ranking, Effective Harness `manual`, and carries the
  `AiFailure` in `metadata.per_video[].failure` instead of a warning string.
  Scoring is still all-or-nothing per run; it stops at the first failure.
- **D6b Batched and resumable scoring** (ADR 0008). One scoring request
  carries up to **5 Candidate Clips** with up to 4 Frame Samples each (≤ 20
  images; D7's scoring limit is per clip). Frames are staged as
  `clip-K-frame-N.jpg` with K = 1..5 in request order, and the prompt lists
  `K → clip label`; the reply schema is
  `{"scores": [{"k": int, "visual_interest": number, "reason": string}]}`.
  Scores are matched by `k`; a missing or duplicate `k` leaves that clip
  unscored and it is retried once in the next batch, then kept rule-based.
  Each scored clip is cached as today (keyed per Candidate Clip and its frame
  set, plus the Active Provider). After a failure the clips already scored
  stay cached and applied; `POST /projects/{id}/ai-scoring/resume` scores only
  the uncached Candidate Clips from the existing library (no FFmpeg, no
  vidstab), and the Import page shows **Finish AI scoring (N clips left)**
  next to the failure message.
- **D7 Payload lockdown** is one function, `payload.build(request)`, and one
  invariant tested directly: an `AiRequest` is `{images: list[Path], text:
  str, schema: dict, timeout_sec: float}`; every image must be a `.jpg` under
  the project's `clipassembler/analysis/samples/` directory and at most 12
  (Review) or 4 (scoring). Before the engine runs, the images are copied into
  a fresh empty scratch directory (`tempfile.mkdtemp(prefix="aca-ai-")`) as
  `frame-01.jpg` … and the engine's cwd is that directory; it is deleted
  afterwards. Text reaching the engine names files by `Path.name` only:
  candidate JSON drops `frame_path`/`file_path` and keeps `file_name`; frame
  labels are `{clip_id, file_name, scene_id, start_sec, end_sec, frame: "frame-03.jpg"}`.
  No engine gets a file-read tool, a shell, MCP servers or the user's hooks.
- **D8 Claude Code invocation** (flags verified against `--help` of 2.1.293 on
  PATH and the desktop copy 2.1.229):
  `claude -p --tools "" --permission-mode dontAsk --no-session-persistence
  --strict-mcp-config --setting-sources "" --output-format stream-json
  --verbose --json-schema <schema> --input-format stream-json --model sonnet`,
  cwd = scratch dir, env = `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`,
  `TMPDIR` only (no `ANTHROPIC_*`, no `CLAUDE_CONFIG_DIR`, so the Editor's
  default sign-in is used; the same env rule applies to Codex, without
  `CODEX_HOME`). The
  prompt and the images go in on stdin as one `user` message whose
  `message.content` is text blocks plus base64 `image` blocks (the SDK says
  images belong in `message.content`; the exact block shape is 3.1's first
  probe). `--permission-prompts none` is added when the engine version is
  ≥ 2.1.259. `--bare` and `--restricted` are not used: `--bare` never reads
  the subscription login, and `--restricted` is absent from the desktop copy.
  Minimum version 2.1.200 (the `dontAsk` mode). The reply is the `result`
  line's `structured_output`; `rate_limit_event` lines and the assistant
  `error` field (`authentication_failed`, `rate_limit`, `billing_error`,
  `overloaded`) map to D3.
- **D9 Codex invocation** is `codex app-server` started with every tool-bearing
  feature off and no user MCP servers:
  `--disable shell_tool --disable unified_exec --disable browser_use
  --disable browser_use_external --disable computer_use --disable apps
  --disable plugins --disable multi_agent --disable hooks --disable
  image_generation --disable code_mode_host --disable skill_search --disable
  skill_mcp_dependency_install --disable in_app_browser --disable
  in_app_local_automation -c mcp_servers={} -c web_search="disabled"`
  (feature names from `codex features list` on 0.159.3; a name the installed
  version does not know is dropped after 3.1 checks it). It runs over stdio (one process per
  request, not a daemon; `--no-daemon` is not needed for app-server) with the
  JSON-RPC methods verified in `codex app-server generate-json-schema` of
  0.159.3: `initialize` {clientInfo}, `initialized`, `thread/start`
  `{cwd: <scratch>, sandbox: "read-only", approvalPolicy: "untrusted",
  ephemeral: true, baseInstructions: <system text>}`, `turn/start`
  `{threadId, input: [{type: "text", text}, {type: "localImage", path} …],
  outputSchema, effort}`, then read notifications until `turn/completed`
  (`turn.status` completed | failed | interrupted). Every server request
  `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
  `item/permissions/requestApproval` and `tool/requestUserInput` is answered
  with the decline decision, and the first `item/started` of type
  `commandExecution` makes the client send `turn/interrupt` and report
  `unusable_reply` — the read-only sandbox can still read any file, so the
  tools are switched off first and a command that still starts is never
  allowed to finish (second guard, not the boundary). `codex exec --json` is rejected because it
  runs model-chosen commands with no client veto. Model: none passed (the
  Editor's Codex default); `effort: "low"` for scoring requests (one call per
  Candidate Clip, so cost matters most there) and the engine default for
  Review turns. If 3.1 finds `turn/start` has no `effort` field, use the
  `-c model_reasoning_effort="low"` config override on the app-server process
  for scoring. Claude uses `--model sonnet` for both (D8); the Advanced model
  override (D14) changes either. Minimum version 0.156.0.
- **D10 Sign-in** spawns the vendor's own login command with stdin closed and
  the output captured: `claude auth login` (opens the browser itself) and
  `codex login` (same). The backend keeps the child alive up to 5 minutes and
  re-reads status when it exits. Status: `claude auth status --json` →
  `loggedIn` (exit 0 signed in, 1 not; verified both ways, the signed-out
  shape has `authMethod: "none"`); `codex login status` → exit 0 with
  "Logged in using ChatGPT", exit 1 with "Not logged in" (verified both
  ways). If 3.1 finds a login command needs a TTY, the fallback is the same
  command inside a `pty.fork()` pseudo-terminal; for Codex the second
  fallback is app-server `account/login/start {type: "chatgpt"}` → `authUrl`
  handed to Electron main, which opens it only if the host is `auth.openai.com`
  (the allowlist pattern of today's `isAllowedOpenAiAuthUrl`).
- **D11 Quota.** ChatGPT: app-server `account/rateLimits/read` →
  `rateLimits.primary|secondary.{usedPercent, resetsAt (unix s),
  windowDurationMins}` and `rateLimitReachedType`; shown on the Providers card
  ("Weekly 42 % used · resets Fri 14:00") and used as `resets_at` on a
  `usageLimitExceeded` turn error. Claude: the CLI exposes no quota call we
  verified; `resets_at` is taken from a `rate_limit_event` when present and
  otherwise omitted (3.1 probes the event).
- **D12 Timeouts.** `--version` and status 5 s; app-server `initialize` 15 s;
  scoring request 120 s per Candidate Clip; Review turn 240 s; Diagnostics ping
  30 s; sign-in 300 s. A process still alive at the deadline is killed
  (`SIGTERM`, then `SIGKILL` after 5 s) and reported `timed_out`.
- **D13 Harness ids.** The Selected Harness becomes `manual` | `ai`; the
  manifest validator maps the old `pi_agent` to `ai` (same pattern as
  `REMOVED_HARNESS_IDS`). Effective Harness is `ai` when AI scoring
  succeeded, `manual` otherwise. UI copy: "Rule-based · local" and
  "AI · <Active Provider>" (e.g. "AI · Claude"); the Import selection-bar
  trigger reads "Scored by Claude" / "Scored by rules".
- **D14 Data model, per machine**, in `.ai-clip-assembler/settings.json`
  through `app_settings.py` (new editable keys, same file):
  `active_provider: "claude" | "chatgpt" | null`,
  `ai_access_granted_at: ISO-8601 | null`,
  `engine_paths: {claude: str | null, chatgpt: str | null}` (Choose program),
  `welcome_completed_at: ISO-8601 | null`,
  `ai_model_override: {claude: str | null, chatgpt: str | null}` (advanced).
  AI Access is granted iff `ai_access_granted_at` is set; Disconnect clears it
  and `active_provider`. There is no fallback Provider: if the Active
  Provider is not ready, calls fail with the matching `AiFailure`.
- **D15 Per project**: `ProjectManifest.cloud_ai_consent` is replaced by
  `ai_enabled: bool = True`; `PROJECT_SCHEMA_VERSION` goes 1 → 2 and
  `open_project` accepts version 1, sets `ai_enabled = True` whatever the old
  value was (the old flag only recorded whether a dialog had been answered;
  nothing is sent until Connect and allow), drops the old key and rewrites the
  manifest. Route `PUT /projects/{id}/cloud-ai-consent` becomes
  `PUT /projects/{id}/ai-enabled` `{enabled}`; the response field is
  `ai_enabled`. The gate for any engine call is
  `ai_access_granted and active_provider and project.ai_enabled`, in one
  function `ai_connection.gate(project_id) -> Optional[AiFailure]` used by
  `/analyze`, Review turns and Diagnostics.
- **D16 Detection order and candidates** (`discovery.py`, parameterised by
  `home`, `applications`, `path_entries`): (1) `engine_paths[provider]`;
  (2) `PATH` from the login shell, then `~/.local/bin`, `/opt/homebrew/bin`,
  `/usr/local/bin`, `~/.nvm/versions/node/*/bin` newest first, `~/.volta/bin`,
  `~/.bun/bin`; (3) desktop apps: Claude → highest version directory under
  `~/Library/Application Support/Claude/claude-code/<ver>/claude.app/Contents/MacOS/claude`
  (`claude-code-vm/` is skipped and any file starting with `\x7fELF` is
  rejected); ChatGPT → `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`,
  then `/Applications/Codex.app/Contents/Resources/codex`. A candidate counts
  only when its `--version` output matches its engine's parser: Claude
  `^(\d+\.\d+\.\d+) \(Claude Code\)$` (e.g. `2.1.293 (Claude Code)`),
  Codex `^codex-cli (\d+\.\d+\.\d+)(-[0-9A-Za-z.]+)?$` (e.g.
  `codex-cli 0.159.3`, `codex-cli 0.162.0-alpha.2`; a pre-release counts as
  its base version). The discovery tests use these exact strings as fixture
  output. `EngineStatus` =
  `{provider, installed, version, path, source: "chosen" | "path" | "desktop_app",
  signed_in, ready, failure?}` where `ready = installed and version ok and signed_in`.
- **D17 Setup surfaces.** `WelcomeWizard.tsx`, shown on first launch while
  `welcome_completed_at` is null, three steps: "Your footage stays on your
  Mac" (what AI adds, Skip), "Pick Claude or ChatGPT" (two cards with the
  D16 status and the four buttons **Download**, **Sign in**, **Check again**,
  **Choose program…**), "Connect and allow" (the D18 statement and the one
  button). Settings › **AI** (rail label changes from "AI assistance"; badge
  shows the Active Provider or OFF) holds `ProvidersPanel.tsx`: the same two
  cards, an Active Provider radio, **Connect and allow** / **Disconnect**,
  the current project's **AI: On / Off** switch, the scoring choice
  (rule-based vs AI) from today's panel, and an "Advanced" disclosure with
  engine path, version, Choose program… and model override. Download links:
  Claude → `https://claude.ai/download` and `https://code.claude.com/docs/en/quickstart`;
  ChatGPT → `https://learn.chatgpt.com/docs/app` and `https://learn.chatgpt.com/docs/codex/cli`.
- **D18 Connect and allow statement** (final copy, also the README/User Guide/
  site text): "When AI is on, the app sends sampled pictures from your
  footage, file names, clip timings and scores, your current edit, and the
  Review chat (including scripts and their results) to Claude or ChatGPT
  through the program signed in on this Mac. Folder paths, video files and
  audio are never sent. This applies to every project; you can turn AI off per
  project. Disconnecting stops it everywhere."
- **D19 Diagnostics** ping goes through the Active Provider engine with an
  `AiRequest` of zero images and the text "Reply with the single word OK";
  with AI Access off or no Active Provider it returns
  `{skipped: true, reason: "ai_off"}` and the panel says "AI is not connected.
  Nothing was sent." The Diagnostics rail button stays (031 may still remove
  it).
- **D20 MCP** stays in Settings › Connections, unchanged in function, with the
  heading sentence "Your client, your traffic: what Claude Desktop or Codex
  reads here goes to that provider under your own account. AI Access does not
  cover it."
- **D21 Tests.** Fake engines are executable fixtures in
  `backend/tests/fixtures/engines/` (`claude`, `codex`, `pi`; Python scripts
  with a `#!/usr/bin/env python3` line) that implement `--version`, the
  status commands, the login command (exits 0 after writing a marker file),
  `claude -p` stream-json and the app-server JSON-RPC subset of D9. The
  scenario comes from `ACA_FAKE_ENGINE=ok|signed_out|usage_limit|rate_limited|hang|garbage|runs_command`.
  `ACA_AI_ENGINE_SEARCH_ROOTS` (a path list) replaces the real search roots in
  tests so CI never finds or spawns a real engine, and a test asserts the
  real roots are not consulted when it is set. Playwright specs stub
  `/ai/connection*` and `/diagnostics`. Gates are those in
  `.github/workflows/test.yml`.

### Verified against vendor docs or `--help` on this Mac (2026-10-08)

- Claude Code 2.1.293 and the desktop copy 2.1.229 both accept `--tools`,
  `--json-schema`, `--input-format`, `--permission-mode dontAsk`,
  `--setting-sources`, `--strict-mcp-config`, `--no-session-persistence`,
  `--output-format`; `--permission-prompts` and `--restricted` are 2.1.259+/2.1.248+
  and absent from the desktop copy. `claude auth status --json` and
  `claude auth login` exist; exit codes verified both signed in and out.
- Codex 0.159.3 (PATH) and 0.162.0-alpha.2 (ChatGPT.app) both have
  `app-server`, `login status`, `exec --json --output-schema -i --sandbox
  --ephemeral --skip-git-repo-check -C`. The app-server method names, `UserInput`
  `localImage`, `SandboxMode`, `AskForApproval`, `GetAccountResponse`,
  `LoginAccountResponse` (`authUrl`, `loginId`), `GetAccountRateLimitsResponse`,
  `RateLimitWindow`, `TurnError.codexErrorInfo` (`usageLimitExceeded`,
  `rateLimitExceeded`, `unauthorized`, `serverOverloaded`,
  `httpConnectionFailed`) come from the generated schema.
- `claude-code-vm/2.1.138/claude` is an ELF binary (first bytes checked).
- Anthropic's legal page permits running the unmodified binary with the
  user's own subscription login under the Commercial Terms (research-c, q17).

### Assumed, to probe first (3.1)

- The exact `image` block shape for stream-json input, and whether
  `structured_output` appears on the stream-json `result` line as it does with
  `--output-format json`.
- The `rate_limit_event` line shape and whether a subscription usage limit
  surfaces there, in the assistant `error` field, or only as result text.
- Whether `claude auth login` and `codex login` complete without a TTY.
- The Codex item notification names for a command execution
  (`item/started` with `item.type == "commandExecution"`) and the decline
  decision literal for each approval request (schema lists `decision`
  objects; the exact deny value is to be read from `CommandExecutionRequestApprovalResponse.json`).
- Whether `codex app-server` honours `approvalPolicy: "untrusted"` for `cat`-class
  commands or runs them unprompted; if it runs them, 3.5's interrupt-on-command
  rule is the only guard and the plan notes it.

## Phase 1: One AI seam with typed failures (on today's Pi engine)

- [ ] 1.1 Create `backend/src/ai_engines/` with `types.py` (`AiRequest`, `AiReply`, `AiFailure`, `AiFailureKind` per D3), `engine.py` (`AiEngine` protocol) and `pi.py` (`PiEngine.run` wrapping today's `_call_pi_cli` command line). Done when `backend/tests/test_ai_engine_pi.py` runs the fake `pi` fixture in each `ACA_FAKE_ENGINE` scenario and asserts the `AiFailureKind` it yields (`signed_out`, `usage_limit` with `resets_at`, `rate_limited`, `timed_out`, `unusable_reply`, `engine_error`, `not_installed` for a missing path).
- [ ] 1.2 Add `ai_engines/messages.py` with the D4 copy and `format_failure(failure, now, tz)`. Done when `test_ai_messages.py` checks each kind for both Provider names, the three reset-time forms, and that no message contains "harness", "Pi", "consent" or "model".
- [ ] 1.3 Route scoring through the seam, batched per D6b: `enhance_clips_with_pi_cli` becomes `enhance_clips(engine, …)` in a new `backend/src/ai_scoring.py` (cache, blend and re-rank code moved as is), and a failure writes `AiFailure` to `metadata.per_video[].failure` with Effective Harness `manual` (D6). Done when `test_analysis_service.py` shows a `usage_limit` run keeps the rule-based ranking, records the failure dict, and `test_api.py::test_analyze_…` exposes `metadata.per_video[].failure` in the `/analyze` response and on reopen; `test_ai_scoring.py` shows 12 clips take 3 engine calls, a reply missing one `k` leaves only that clip for the next batch, and a `usage_limit` on call 2 keeps call 1's five scores applied and cached.
- [ ] 1.4 Add `POST /projects/{id}/ai-scoring/resume` and the **Finish AI scoring (N clips left)** button (D6b). Done when `test_api.py::test_ai_scoring_resume_scores_only_uncached_clips` shows the fake engine receives only the uncached clips and `run_vidstabdetect`/`extract_frames` are never called, and `e2e/review-ai-failures.spec.ts` (stubbed) shows the button with the right count after a stubbed usage-limit analysis. (after 1.3)
- [ ] 1.5 Route Review turns through the seam: `default_review_agent` becomes `engine_review_agent(engine)` returning either `AiReply` or `AiFailure`; `run_review_turn` stores a failed turn as an agent message with `payload.failure` and no `version_set` (D5). Done when `test_review_agent.py` asserts a failed turn mints no Versions, the previous message's `version_set` remains the latest, and the stored text equals `format_failure(...)`.
- [ ] 1.6 Carry the failure through the client: add `failure?: AiFailure` to `ReviewMessage.payload` and `metadata.per_video[]` types in `frontend/src/renderer/src/api/client.ts` (regenerate `types/generated.ts`), render it in `ReviewChatPanel.tsx` as a `chat-failure` card with the message and an action button mapped from `failure.action` (`open_providers` → Settings › AI, `sign_in` → Settings › AI, `retry` → the existing Retry), and replace the Harness Fallback notice text in `routes/Review.tsx` with the same message. Done when `e2e/review-ai-failures.spec.ts` (stubbed) shows the ChatGPT limit message with "resets at", keeps the earlier Versions visible, and the Import notice names the Provider.
- [ ] 1.7 Diagnostics use the seam: `_ping_review_model` becomes `engine.run(AiRequest(images=[], text="Reply with the single word OK"))` and returns `{reachable, failure?, elapsed_sec}`; `_reachability_guidance` and the `_*_MARKERS` tables are deleted in favour of `format_failure`. Done when `test_api.py::test_diagnostics_*` cover reachable, `signed_out` and `timed_out`, and `DiagnosticsTabPanel.tsx` renders `failure.message` and `failure.action` (E2E in `settings-connections.spec.ts` updated).

## Phase 2: Payload lockdown

- [ ] 2.1 Add `ai_engines/payload.py`: `validate_images(paths, samples_dir, limit)`, `stage(request) -> StagedRequest` (copies into the scratch dir, renames to `frame-NN.jpg`, returns the cwd and the new paths) and `cleanup`. Done when `test_ai_payload.py` rejects a path outside `samples_dir`, a symlink that resolves outside it, a non-`.jpg`, and more than the limit; and shows the scratch dir holds exactly the listed files and is removed after `run`.
- [ ] 2.2 Strip paths from text: `review_agent.py` builds candidate JSON and frame labels without `frame_path`/`file_path` (D7), and `ai_scoring.py`'s prompt lists `frame-NN.jpg` names. Done when `test_ai_payload.py::test_text_has_no_paths` serialises a Review and a scoring request from a fixture project under `/tmp/secret-folder/` and asserts neither the text nor the engine argv contains `/`-separated paths or the folder name, while every `file_name` still appears.
- [ ] 2.3 Lock the Pi engine down to the same contract: `PiEngine` runs in the scratch cwd with `--tools ""` (no `read`), images attached only as `@frame-NN.jpg` from the scratch dir, and `env` reduced to `PATH`, `HOME`. Done when `test_ai_engine_pi.py::test_argv_is_locked_down` asserts the argv has no `read` tool, no absolute paths outside the scratch dir, and the fake engine records its cwd as the scratch dir.
- [ ] 2.4 Prove the boundary end to end: a backend test runs an analysis plus one Review turn against the fake engine and the fake records every argv, cwd, stdin byte and file it was asked to open. Done when `test_ai_boundary.py` asserts the recorded set of opened files equals the staged `frame-NN.jpg` set, no `.MP4`/`.MOV` path appears anywhere, and the cwd is empty apart from those files.
- [ ] 2.5 Tag the milestone: `docs/HARNESS_SPEC.md` gets a short "Payload boundary" section stating D7 (the full rewrite is 7.1). Done when the section lists exactly what is sent (Frame Samples as JPEG, file names, clip timings and scores, the Timeline, the chat) and the test file that proves it.

## Phase 3: Claude Code and Codex engines

- [ ] 3.1 [research] Probe the assumed facts on the installed engines, read-only, and record the answers as sub-bullets here: (a) the stream-json `user` message image block accepted by `claude -p --input-format stream-json` (try `{type: "image", source: {type: "base64", media_type: "image/jpeg", data}}`), (b) whether `structured_output` is on the stream-json `result` line, (c) the `rate_limit_event` shape (`claude -p --output-format stream-json --verbose` on a trivial prompt), (d) whether `claude auth login` / `codex login` finish with stdin closed and no TTY (use `CLAUDE_CONFIG_DIR` / `CODEX_HOME` pointing at a temp dir so the real login is untouched; cancel at the browser), (e) the exact decline value in `CommandExecutionRequestApprovalResponse.json` and the item notification for a command start, (f) whether `approvalPolicy: "untrusted"` prompts for `cat`. Done when each of (a)–(f) has a one-line answer with the command used, and D8–D10 are amended in the same PR if an answer differs.
- [ ] 3.2 Generalise the login-shell probe: rename `frontend/src/main/piExecutable.ts` to `userShellPath.ts` exporting `captureLoginShellPath()` (the `PATH` of `/bin/zsh -lic`), pass it to the backend as `ACA_LOGIN_SHELL_PATH`, and delete the `pi`-specific candidate list. Done when `tests/main/userShellPath.test.ts` covers the marker parsing and the fallback to `process.env.PATH`, and `backendLifecycle.test.ts` shows the variable in the spawn env.
- [ ] 3.3 Add `ai_engines/discovery.py` (D16) and `GET /ai/connection` returning `{active_provider, ai_access_granted_at, providers: {claude: EngineStatus, chatgpt: EngineStatus}, usage?: …}`. Done when `test_ai_discovery.py` builds fixture trees under `tmp_path` (chosen path wins over PATH; PATH wins over the desktop app; newest nvm version first; `claude-code-vm` and an ELF decoy are skipped; a missing `--version` word is "not installed"; a version below minimum is `incompatible_version`) and `/ai/connection` reflects them with `ACA_AI_ENGINE_SEARCH_ROOTS`.
- [ ] 3.4 Prove the boundary on the real engines: add `scripts/ai_boundary_probe.py`, which writes a canary file with a random token under `$TMPDIR`, then runs one Claude and one Codex request with the exact D8 and D9 command lines as subprocesses (scratch cwd, D8 env) asking the model to read that file and quote it. Done when, run locally on a Mac with both engines signed in, the output shows for each engine that the token is absent from the reply and no tool or command item was started, and the run's output is pasted as a sub-bullet here. If either engine reads the canary, stop and report to the orchestrator before 3.5 (the fallback is a `sandbox-exec` profile denying file reads outside the scratch dir and the engine's own install and auth paths). (after 3.1)
- [ ] 3.5 Add `ai_engines/claude_code.py` per D8 and `ai_engines/codex.py` per D9 (JSON-RPC client with request ids, notification loop, approval decline, interrupt-on-command, `account/rateLimits/read`). Done when `test_ai_engine_claude.py` and `test_ai_engine_codex.py` run every `ACA_FAKE_ENGINE` scenario against the fake fixtures and assert the `AiFailureKind` (including `usage_limit` with `resets_at` from `usageLimitExceeded` + rate limits for Codex, `signed_out` from `unauthorized` / `authentication_failed`, `unusable_reply` for `runs_command`), the parsed `AiReply` for `ok`, and that the argv/JSON-RPC params match D8/D9 verbatim.
- [ ] 3.6 Add sign-in and re-check routes: `POST /ai/connection/check` (re-run discovery and status), `POST /ai/connection/sign-in {provider}` (D10; returns `{state: "waiting"}` and later statuses show `signed_in`), `POST /ai/connection/sign-in/cancel`, `PUT /ai/connection/engine-path {provider, path | null}`. Done when `test_api.py::test_ai_sign_in_*` show the fake login command writing its marker turns `signed_in` true on the next check, a 300 s deadline reports `timed_out`, cancel kills the child, and a chosen path that fails `--version` is rejected with 422 and leaves the setting unchanged.
- [ ] 3.7 Wire the engines into the seam: `get_engine(active_provider)` returns the Claude or Codex engine; scoring, Review and Diagnostics call it; `ai_model_override` is passed through. Done when `test_api.py::test_analyze_with_fake_claude` and `…_fake_codex` enhance clips, and `test_review_turn_with_fake_codex_usage_limit` returns the ChatGPT message with the reset time taken from the fake's rate-limit snapshot.

## Phase 4: AI Access, Active Provider and AI: On / Off

- [ ] 4.1 Add the D14 keys to `app_settings.py` (`EDITABLE_KEYS` and validation: `active_provider` ∈ {claude, chatgpt, null}; `engine_paths` values absolute or null) and `backend/src/ai_connection.py` with `gate(project_id)` (D15). Done when `test_app_settings.py` round-trips the new keys and `test_ai_connection.py` returns `ai_not_connected` (provider null) for access not granted and for no Active Provider, the engine's own kind (`signed_out` with the provider) for a provider that is not ready, `ai_off_for_project` for project off, and `None` when all four hold.
- [ ] 4.2 Add `POST /ai/connection/connect {provider}` (sets `active_provider` and `ai_access_granted_at`; 409 if the provider is not ready), `POST /ai/connection/disconnect`, `PUT /ai/connection/active-provider {provider}` (409 unless ready). Done when `test_api.py::test_ai_connect_*` cover each status code and show Disconnect clears both keys.
- [ ] 4.3 Migrate the manifest (D15): `PROJECT_SCHEMA_VERSION = 2`, `ai_enabled: bool = True`, the loader accepts version 1 and rewrites it, `pi_agent` maps to `ai` (D13), and `PUT /projects/{id}/ai-enabled` replaces the consent route. Done when `test_project_store.py` opens a saved v1 manifest with `cloud_ai_consent: false` and `harness: pi_agent` and gets `schema_version 2`, `ai_enabled true`, `harness ai`, with the file rewritten; and `test_api.py` shows the new route persists and survives reopen.
- [ ] 4.4 Replace the consent checks with the gate: `/analyze` with `harness_id == "ai"`, `_review_inputs`, and `/diagnostics` call `gate()`; the Review stub for a gated project returns `payload.failure` with `action: "open_providers"` and the text "AI is off for this project. Turn it on in Settings › AI." or "No AI connected yet. Connect Claude or ChatGPT in Settings › AI." Done when `test_api.py` shows a project with `ai_enabled false` never spawns the fake engine for scoring, Review or Diagnostics (the fake's call log stays empty), and the stub text matches.
- [ ] 4.5 Update the renderer state: `ReviewContext` replaces `cloudAiConsent`/`setCloudAiConsent` with `aiEnabled`/`setAiEnabled`, adds an `aiConnection` store (`useAiConnection` hook polling `/ai/connection` on Settings open and after each action), and `client.ts` gains the new routes. Done when `npm run typecheck` passes with `cloud_ai_consent` gone from `frontend/src` and `frontend/e2e`, and the E2E fixtures use `ai_enabled`.

## Phase 5: Welcome wizard and Providers screen

- [ ] 5.1 Build `components/ai/ProviderCard.tsx`: Provider name, three-step status line "installed → signed in → ready" with the current step highlighted, the version and source in Mono, and the buttons **Download** (opens the D17 links through `shell.openExternal` via a new `app:open-external` IPC with an `https:` allowlist), **Sign in** (busy state "Waiting for <Provider>…" with Cancel), **Check again**, **Choose program…** (new `ai:choose-engine` IPC using `dialog.showOpenDialog`, result sent to `PUT /ai/connection/engine-path`), and the usage line from D11 when present. Done when `e2e/providers.spec.ts` (stubbed) shows each state for both Providers, the buttons enabled per state (Sign in only when installed, Download only when not), and Check again re-fetches.
- [ ] 5.2 Replace `AiAssistancePanel.tsx` and `ReviewModelAccountSection.tsx` with `components/ai/ProvidersPanel.tsx` per D17 (two cards, Active Provider radio, Connect and allow with the D18 statement, Disconnect, the project **AI: On / Off** switch, the scoring choice, Advanced disclosure with model override). Rename the rail item to "AI" with the Active Provider as its badge. Done when `settings-connections.spec.ts` is rewritten to: Connect and allow enabled only when the chosen Provider is ready, pressing it calls `/ai/connection/connect` and the badge shows the Provider, Disconnect returns the badge to OFF, the project switch calls `/projects/{id}/ai-enabled`, and no text on the panel says "consent", "harness", "Pi" or "review model".
- [ ] 5.3 Build `components/ai/WelcomeWizard.tsx` (D17) shown by `AppShell` while `welcome_completed_at` is null; Skip on every step and finishing both call `PUT /settings {welcome_completed_at}`. Done when `e2e/welcome-wizard.spec.ts` (stubbed) shows the wizard on first launch, Skip hides it and it does not return on reload, the happy path ends with the Provider badge set, and the three E2E fixture projects set `welcome_completed_at` so existing specs stay green.
- [ ] 5.4 Replace the Import harness `<select>` and the `window.confirm` in `routes/Import.tsx` `handleAnalyze`: the selection bar shows a two-option popover "Scored by rules" / "Scored by <Provider>" (031 Step 2.11's slot); choosing AI when the gate fails shows the gate's message inline with its action button and never calls `/analyze`. Done when `import-workflow-redesign.spec.ts` shows the inline message for "no AI connected" and "AI off for this project", no `/analyze` request is made, and the Selected Harness stays `manual`.
- [ ] 5.5 Carry 030's remainder: the Review chat stub card (4.4) renders its action button opening Settings › AI; the status bar middle fact reads `AI: CLAUDE` / `AI: CHATGPT` / `AI: OFF` (031 Step 2.6's harness variant). Done when `e2e/review-ai-failures.spec.ts` clicks the stub's action and lands on the AI panel, and `app-shell-layout.spec.ts` asserts the three status-bar variants.
- [ ] 5.6 E2E, real backend: with `ACA_AI_ENGINE_SEARCH_ROOTS` pointing at the fake engines, an Editor opens Settings › AI, sees Claude "ready", presses Connect and allow, turns the project's AI on, runs a Review turn and gets a real `AiReply` Proposal; turns AI off and gets the stub. Done when `e2e/ai-connection.spec.ts` passes in `npm run test:e2e` and in CI.

## Phase 6: Remove Pi

- [ ] 6.1 Delete `backend/src/pi_cli_harness.py`, `ai_engines/pi.py`, `backend/tests/test_pi_cli_harness.py`, `test_ai_engine_pi.py`, the `pi` fixture, `scripts/spike_pi_scaling_benchmark.py`, the `PI_*` settings keys and `/harnesses` entries, `load_dotenv` of `PI_*`, and `.env.example` lines. Done when `grep -ri "pi_agent\|pi_bin\|PI_PROVIDER\|earendil" backend scripts .env.example` returns only the D13 `pi_agent` → `ai` manifest mapping in `backend/src/project_store.py` and its regression fixture in `backend/tests/test_project_store.py` and `npm run test:backend` passes.
- [ ] 6.2 Delete `frontend/src/main/reviewModelAuth.ts`, `frontend/src/shared/reviewModelAuth.ts`, `tests/main/reviewModelAuth.test.ts`, `piExecutable.test.ts`, the `review-model-auth:*` IPC handlers and preload methods, `PiRoutingSettings` in `SettingsTabPanel.tsx`, and the `@earendil-works/*` dependencies. Done when `grep -ri "pi-ai\|pi-coding-agent\|review-model-auth\|reviewModel" frontend/src frontend/tests frontend/e2e frontend/package.json` returns nothing and `npm run lint && npm run typecheck && npm run test:main && npm run test:e2e` pass.
- [ ] 6.3 Verify the packaged app no longer needs Pi: `frontend/scripts/stage-runtime-tools.mjs` and `verify-packaged-backend.mjs` reference no `pi`, and the Diagnostics panel on a Mac with no engines shows "not installed" guidance with download links instead of `npm install` steps. Done when `npm run dist` (local) produces a build whose `Resources` contain no Pi package and the manual check is recorded as a sub-bullet.

## Phase 7: Docs and privacy copy

- [ ] 7.1 Rewrite `docs/HARNESS_SPEC.md` to the shipped contract: Providers and AI Engines, the `AiEngine` protocol, D8/D9 invocations, D3 failure kinds, the payload boundary, D16 detection, D12 timeouts; remove the API-key Claude/Codex harnesses and the Pi section. Done when the file mentions neither `pi` nor `api_key` and every flag listed appears in the engine modules.
- [ ] 7.2 Update `docs/ARCHITECTURE.md` (replace "Review model authentication boundary" with the AI Connection boundary: renderer → FastAPI `/ai/connection` → vendor program; Electron main only opens URLs and the file dialog), `docs/adr/0001-*.md` and `docs/adr/0005-*.md` status lines (add "manifest field `ai_enabled`, see [038]"), `docs/adr/0006-*.md` consent reference, and `docs/README.md` (drop the "outdated" note on HARNESS_SPEC). Done when `grep -rn "consent" docs/adr docs/ARCHITECTURE.md` shows only the historical ADR texts.
- [ ] 7.3 Rewrite the privacy and setup copy with the D18 statement: `README.md` "Privacy model" and "Optional cloud AI harness setup" (now "Connect Claude or ChatGPT"), `docs/USER_GUIDE.md` sections "Choosing an AI harness", "Review model account", "Connect your AI" (MCP, with D20 wording), `docs/TROUBLESHOOTING.md` Pi sections (replaced by the D4 messages and what each means), `docs/DEVELOPER_SETUP.md`, and `site/index.html` privacy paragraph and FAQ. Done when every one of these says file names are sent and folder paths, video and audio are not, and `grep -rin "pi\b\|pi_agent\|consent" README.md docs/USER_GUIDE.md docs/TROUBLESHOOTING.md docs/DEVELOPER_SETUP.md site/index.html` is empty.
- [ ] 7.4 Mark the specs (030 and the 031 tasks above were already handed over to this plan on 2026-10-08): add a status note to `docs/specs/2026-06-19-pi-harness-scaling-design.md` and `docs/specs/2026-06-28-byo-subscription-mcp-connect-design.md` ("in-app AI now runs through the Editor's Claude Code or Codex; MCP remains the external route"), then run `python3 scripts/plans.py sync`. Done when both specs carry the note and `python3 scripts/plans.py check` passes.

## Human tasks

- [ ] H1 On this Mac, with real Claude and ChatGPT accounts, run the wizard end to end for both Providers (fresh `CLAUDE_CONFIG_DIR`/`CODEX_HOME` are fine for the sign-in step), then score one Estepona Source Video and run one Review turn with each. Record versions, elapsed times and the usage line shown.
- [ ] H2 Compare the ChatGPT usage percentages and reset time shown on the Providers card with ChatGPT's own usage page; note any mismatch as an inbox issue.
- [ ] H3 Confirm the D18 statement is the wording you want on the site and in the app before 7.3 ships.
