# AI Clip Assembler

AI Clip Assembler is a local-first Mac app that turns a folder of raw drone or
travel footage into a first cut, lets the Editor refine it (optionally with
their own Claude or ChatGPT), and exports an editable timeline to DaVinci
Resolve or Final Cut Pro.

## Language

### Product And Users

**AI Clip Assembler**:
A local-first desktop app that finds and assembles useful video clips from raw footage.
_Avoid_: AI editor, video editor, assembler app

**Hobbyist**:
The first target user: someone with hours of drone or travel footage and basic editing skills who never opens a terminal.
_Avoid_: Drone User, drone operator, creator, pro editor

**Editor**:
A person making final decisions about which suggested clips belong in an export.
_Avoid_: User, creator, operator

**Local-First**:
A product constraint where source footage and project data stay on the Editor's Mac; with **AI Access** on, only **Frame Samples** and a text summary go to the **Active Provider**.
_Avoid_: Offline-only, private mode

### Footage And Analysis

**Footage**:
Raw source video files imported into a project.
_Avoid_: Media, clips, videos

**Source Video**:
One imported MP4 or MOV file before analysis or trimming.
_Avoid_: Raw clip, file, footage item

**Frame Sample**:
A still image extracted from a source video at a known timestamp for scoring and preview.
_Avoid_: Thumbnail, frame, image

**Scene**:
A continuous span of source video identified by visual continuity or a scene detector.
_Avoid_: Shot, segment

**Motion Stability**:
A technical estimate of how smooth the camera movement is in a frame or span.
_Avoid_: Smoothness, stabilization

**Smoothness Score**:
A 0-10 score where higher means the footage appears more stable and less shaky.
_Avoid_: Stability score, motion score

**Sharpness Score**:
A 0-10 score where higher means the frame is less blurry.
_Avoid_: Blur score

**Exposure Score**:
A 0-10 score where higher means the image brightness is usable.
_Avoid_: Brightness score

**Contrast Score**:
A 0-10 score where higher means the image has usable tonal separation.
_Avoid_: Contrast metric

**Visual Interest Score**:
A 0-10 semantic score for composition, lighting, subject, or moment quality.
_Avoid_: AI score, interestingness

**Overall Score**:
A weighted score used to rank candidate clips for review.
_Avoid_: Composite score, quality score

### Clip Lifecycle

**Candidate Clip**:
A proposed time range from a source video that may be worth keeping.
_Avoid_: Suggested clip, AI clip, segment

**Look Group**:
A set of Candidate Clips judged visually near-identical. The library surfaces the highest-scored clip per Look Group; edits use at most one clip per Look Group.
_Avoid_: Duplicate group, similarity cluster

**Accepted Clip**:
A candidate clip the editor has chosen to keep for export.
_Avoid_: Included clip, selected clip

**Rejected Clip**:
A candidate clip the editor has chosen not to use.
_Avoid_: Excluded clip, hidden clip

**Clip Reason**:
A short explanation of why a candidate clip was suggested or ranked.
_Avoid_: AI reason, rationale

**Review Board**:
The first MVP interface for filtering, comparing, accepting, rejecting, and ordering candidate clips.
_Avoid_: Clip cards, timeline, dashboard

**Timeline**:
The ordered sequence of **Timeline Items** intended for export, held as the authoritative **Timeline Document**.
_Avoid_: Sequence, assembly

**Timeline Document**:
The single authoritative record of the timeline: ordered **Timeline Items**, assembly profile, target duration, and version.
_Avoid_: Timeline state, project timeline

**Timeline Item**:
One placement of a **Candidate Clip** on the **Timeline**, with its own in/out bounds, **Speed**, and **Transform**. The same candidate may appear as more than one item (multi-instance).
_Avoid_: Clip instance, timeline clip, segment

**Trim**:
A manual adjustment to a **Timeline Item**'s in/out bounds; may **extend** past the original candidate bounds, clamped to the source video duration.
_Avoid_: Cut, crop

**Speed**:
A **Timeline Item**'s playback-rate multiplier (default 1.0); effective timeline duration is source span divided by speed.
_Avoid_: Retime, slow-mo factor

**Transform**:
A **Timeline Item**'s digital zoom/pan/crop, expressed as scale and offset; identity by default.
_Avoid_: Zoom, pan, crop, reframe

### AI Connection

**Provider**:
The AI service whose subscription the **Editor** brings: Claude or ChatGPT.
_Avoid_: Model, vendor, harness, review model

**AI Connection**:
The **Editor**'s own **Provider** subscription, linked once through that Provider's official program.
_Avoid_: Account, sign-in, integration

**AI Engine**:
The **Provider**'s official program on the Editor's Mac that the app runs to do AI work: Claude Code for Claude, Codex for ChatGPT. Never shown outside advanced settings.
_Avoid_: Harness, CLI, runtime, Pi Agent

**Active Provider**:
The one **Provider** whose **AI Connection** the app uses when more than one is connected.
_Avoid_: Default provider, fallback provider

**AI Access**:
The **Editor**'s permission, granted with "Connect and allow", for the app to send **Frame Samples**, file names, clip timings and scores, the **Timeline** and the Review chat to the **Active Provider**; switched off per project with "AI: On / Off".
_Avoid_: Consent, cloud consent, opt-in, data sharing

### Harnesses And Export

**Harness**:
The internal scoring implementation behind analysis: rule-based, or AI through the **Active Provider**. Never shown to the **Editor**.
_Avoid_: Agent, model, provider, scoring engine

**Manual Harness**:
The deterministic rule-based harness that uses technical metrics and no AI model.
_Avoid_: Rule-based harness, no-AI mode

**Selected Harness**:
The **Harness** the **Editor** chose for a project. Belongs to the project and survives navigation.
_Avoid_: Harness setting, analysis mode

**Effective Harness**:
The **Harness** that actually produced the current **Candidate Clip** library. Differs from the **Selected Harness** after a fallback or a re-derive.
_Avoid_: Harness used, actual harness

**Harness Fallback**:
A run where the **Selected Harness** could not complete and the rule-based result was used instead, so the **Effective Harness** is the **Manual Harness**.
_Avoid_: Degraded run, AI skipped

**Export**:
A generated file that carries the timeline into a professional editing app.
_Avoid_: Render, output

**FCPXML**:
The primary XML export format for Final Cut Pro, version 1.10, validated
against `backend/tests/fixtures/fcpxml/FCPXMLv1_10.dtd`.
_Avoid_: Final Cut XML

**EDL**:
A simple edit decision list export format for broad editor compatibility.
_Avoid_: CMX3600

**Resolve XML**:
A DaVinci Resolve-compatible XML export format.
_Avoid_: DaVinci XML

### Agent Control And Editing

**Operation**:
A single, validated, reversible mutation of the **Timeline Document** (e.g. split, set speed, set transform, reorder). The one and only way the timeline changes, shared by the GUI and agents.
_Avoid_: Command, action, edit

**Undo History**:
The bounded per-project sequence of **Timeline Document** states that makes every **Operation** reversible via undo/redo.
_Avoid_: Edit history, command stack

**Proposal**:
A staged set of **Operations** plus the resulting diff, suggested by the **In-App Review Agent** or recorded by a **Script Run**, and applied only after the **Editor** accepts it. A stale Proposal that a re-run replaced is superseded.
_Avoid_: Suggestion, draft edit, pending change

**Script**:
A short program, written by the **Editor** or the **In-App Review Agent** in the Review chat, that edits a copy of the **Timeline**; each change it makes is one **Operation**.
_Avoid_: Macro, Resolve script, console script

**Script Run**:
One dry run of a **Script** against the current **Timeline**, saved on its Review chat message: its source, author, log, and either its error or the **Proposal** it recorded. Running is local and needs no **AI Access**.
_Avoid_: Execution, script result

**MCP Server**:
The local Model Context Protocol endpoint the app exposes while running, letting agents call **Operations** and read tools with full project context.
_Avoid_: Agent server, tool server

**In-App Review Agent**:
The conversational agent in the Review chat, run through the **Active Provider**, that sees **Frame Samples** and the **Timeline** and answers with **Proposals**, usually as **Scripts**; it never applies them itself.
_Avoid_: Chat bot, assistant, copilot

**Marker**:
A note pinned to a moment on the **Timeline**, exported as a marker to the editing app.
_Avoid_: Comment, tag, flag

**Story Section**:
A named part of the edit's story (for example intro, journey, reveal, outro) that groups consecutive **Timeline Items**.
_Avoid_: Beat, chapter, act

**External Agent**:
An agent outside the app (e.g. Claude Desktop, Codex) connected over the **MCP Server**; it applies **Operations** directly because the **Editor** is driving it, and it is outside **AI Access**.
_Avoid_: Remote agent, CLI agent

## Relationships

- A **Project** contains one or more **Source Videos**.
- A **Source Video** produces many **Frame Samples** during analysis.
- A **Frame Sample** receives technical scores such as **Smoothness Score**, **Sharpness Score**, **Exposure Score**, and **Contrast Score**.
- A run of high-scoring **Frame Samples** can become a **Candidate Clip**.
- An **Editor** accepts or rejects **Candidate Clips** on the **Review Board**.
- Accepting a **Candidate Clip** adds a **Timeline Item** to the **Timeline Document**; one candidate may back several items (multi-instance).
- A **Timeline Item** carries its own bounds, **Speed**, and **Transform**.
- Every change to the **Timeline Document** is an **Operation**, recorded in the **Undo History** so it can be reversed.
- The **In-App Review Agent** offers **Proposals** the **Editor** accepts or rejects; an **External Agent** applies **Operations** directly over the **MCP Server**.
- A **Script Run** turns a **Script**'s recorded **Operations** into one **Proposal**; applying it is one undo step, and a stale one is re-run rather than rebased.
- A **Harness** produces or enriches **Candidate Clips**; the **Manual Harness** needs no **AI Connection**.
- An **Editor** has at most one **Active Provider**; its **AI Engine** does the AI work, and **AI Access** decides whether a project may use it.
- **Story Sections** group **Timeline Items**; **Markers** pin notes to moments. Both travel with an **Export**.
- An **Export** serializes the **Timeline Document** as **FCPXML**, **EDL**, or **Resolve XML** (EDL flattens **Speed** and **Transform**).

## Flagged ambiguities

- "Clip" has been used to mean **Source Video**, **Candidate Clip**, and a placement on the timeline. Use **Source Video** for imported files, **Candidate Clip** for suggested time ranges, and **Timeline Item** for a placement on the **Timeline**.
- "AI score" is too narrow for the MVP because the first scoring path is rule-based. Use **Overall Score**, **Smoothness Score**, or **Visual Interest Score** depending on the meaning.
- "Timeline" has been used for both the editing UI and the data it edits. Use **Review Board** for the candidate-curation UI, **Timeline** for the ordered sequence of **Timeline Items**, and **Timeline Document** when stressing that the backend owns the authoritative record.
- "Manual" can mean hand-editing or rule-based scoring. Use **Manual Harness** for deterministic no-AI scoring and **Trim** or **Accepted Clip** for editor actions. Never say "manual mode" to an Editor: it reads as "you are editing by hand" when it means "scoring was rule-based".
- "Harness" has been used for both what the **Editor** picked and what actually ran. Say **Selected Harness** for the choice and **Effective Harness** for what produced the current **Candidate Clips**; they diverge on a **Harness Fallback** or a re-derive.
- The **Harness** and the **In-App Review Agent** are different concepts — a rule-based **Selected Harness** does not imply an absent agent. Both use the same **AI Connection** and one **AI Access** gate. See [ADR 0005](docs/adr/0005-harness-and-review-agent-are-independent.md) and [ADR 0007](docs/adr/0007-ai-access-is-granted-when-connecting.md).
- "Consent", "cloud consent" and "review model" were used for what is now **AI Access** and the **Provider**. Never show "consent", "harness", "Pi" or "review model" to the **Editor**; say **Connect and allow**, **AI: On / Off**, Claude or ChatGPT.
- "Scene" and "shot" are close. Use **Scene** until the app explicitly models cinematographic shots separately.
