# Ubiquitous Language

## Product And Users

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **AI Clip Assembler** | A local-first desktop app that finds and assembles useful video clips from raw footage. | AI editor, video editor, assembler app |
| **Drone User** | The first target user: a person reviewing drone footage to find smooth, usable shots. | Drone beginner, drone operator, creator |
| **Editor** | A person making final decisions about which suggested clips belong in an export. | User, creator, operator |
| **Local-First** | A product constraint where source footage and project data stay on the user's machine by default. | Offline-only, private mode |

## Footage And Analysis

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Footage** | Raw source video files imported into a project. | Media, clips, videos |
| **Source Video** | One imported MP4 or MOV file before analysis or trimming. | Raw clip, file, footage item |
| **Frame Sample** | A still image extracted from a source video at a known timestamp for scoring and preview. | Thumbnail, frame, image |
| **Scene** | A continuous span of source video identified by visual continuity or a scene detector. | Shot, segment |
| **Motion Stability** | A technical estimate of how smooth the camera movement is in a frame or span. | Smoothness, stabilization |
| **Smoothness Score** | A 0-10 score where higher means the footage appears more stable and less shaky. | Stability score, motion score |
| **Sharpness Score** | A 0-10 score where higher means the frame is less blurry. | Blur score |
| **Exposure Score** | A 0-10 score where higher means the image brightness is usable. | Brightness score |
| **Contrast Score** | A 0-10 score where higher means the image has usable tonal separation. | Contrast metric |
| **Visual Interest Score** | A 0-10 semantic score for composition, lighting, subject, or moment quality. | AI score, interestingness |
| **Overall Score** | A weighted score used to rank candidate clips for review. | Composite score, quality score |

## Clip Lifecycle

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Candidate Clip** | A proposed time range from a source video that may be worth keeping. | Suggested clip, AI clip, segment |
| **Look Group** | A set of Candidate Clips judged visually near-identical by embedding similarity. The library surfaces the highest-scored clip per Look Group; edits use at most one clip per Look Group. | Duplicate group, similarity cluster |
| **Accepted Clip** | A candidate clip the editor has chosen to keep for export. | Included clip, selected clip |
| **Rejected Clip** | A candidate clip the editor has chosen not to use. | Excluded clip, hidden clip |
| **Clip Reason** | A short explanation of why a candidate clip was suggested or ranked; currently serialized as `ai_reason` in the harness/API contract. | AI reason, rationale |
| **Review Board** | The first MVP interface for filtering, comparing, accepting, rejecting, and ordering candidate clips. | Clip cards, timeline, dashboard |
| **Timeline** | The ordered sequence of **Timeline Items** intended for export, held as the backend-authoritative **Timeline Document**. | Sequence, assembly |
| **Timeline Document** | The single backend-authoritative record of the timeline: ordered **Timeline Items**, assembly profile, target duration, and version. The GUI and agents are clients of it. | Timeline state, project timeline |
| **Timeline Item** | One placement of a **Candidate Clip** on the **Timeline**, with its own in/out bounds, **Speed**, and **Transform**. The same candidate may appear as more than one item (multi-instance). | Clip instance, timeline clip, segment |
| **Trim** | A manual adjustment to a **Timeline Item**'s in/out bounds; may **extend** past the original candidate bounds, clamped to the source video duration. | Cut, crop |
| **Speed** | A **Timeline Item**'s playback-rate multiplier (default 1.0); effective timeline duration is source span divided by speed. | Retime, slow-mo factor |
| **Transform** | A **Timeline Item**'s digital zoom/pan/crop, expressed as scale and offset; identity by default. | Zoom, pan, crop, reframe |

## Harnesses And Export

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Harness** | A pluggable scoring or reasoning implementation that conforms to the app's clip suggestion contract. | Agent, model, provider |
| **Manual Harness** | The deterministic rule-based harness that uses technical metrics and no AI model. | Rule-based harness, no-AI mode |
| **Local AI Harness** | A harness that uses a local vision model to score or annotate candidate clips. | Qwen harness, Ollama harness |
| **Export** | A generated file that carries the timeline into a professional editing app. | Render, output |
| **FCPXML** | The primary XML export format for Final Cut Pro. | Final Cut XML |
| **EDL** | A simple edit decision list export format for broad editor compatibility. | CMX3600 |
| **Resolve XML** | A DaVinci Resolve-compatible XML export format. | DaVinci XML |

## Agent Control And Editing

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Operation** | A single, validated, reversible mutation of the **Timeline Document** (e.g. split, set speed, set transform, reorder). The one and only way the timeline changes, shared by the GUI and agents. | Command, action, edit |
| **Undo History** | The bounded per-project sequence of **Timeline Document** snapshots that makes every **Operation** reversible via undo/redo. | Edit history, command stack |
| **Proposal** | A staged set of **Operations** plus the resulting diff, suggested by the **In-App Review Agent** and applied only after the **Editor** accepts it. | Suggestion, draft edit, pending change |
| **MCP Server** | The local Model Context Protocol endpoint the backend exposes while running, letting agents call **Operations** and read tools with full project context. | Agent server, tool server |
| **In-App Review Agent** | The hosted conversational agent inside the app; an MCP client of our own **MCP Server** that runs in propose mode (it suggests **Proposals**, it does not apply directly). | Chat bot, assistant, copilot |
| **External Agent** | An agent outside the app (e.g. Claude Code, Cursor, Codex) connected over the **MCP Server**; it applies **Operations** directly because the **Editor** is driving it. | Remote agent, CLI agent |

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
- A **Harness** produces or enriches **Candidate Clips**, but the **Manual Harness** is the MVP default.
- An **Export** serializes the **Timeline Document** as **FCPXML**, **EDL**, or **Resolve XML** (EDL flattens **Speed** and **Transform**).

## Example Dialogue

> **Dev:** "For the drone-first MVP, should the **Local AI Harness** decide which clips go on the **Timeline**?"
>
> **Domain expert:** "No. The **Manual Harness** should first find smooth **Candidate Clips** from technical scores. The **Local AI Harness** can improve **Visual Interest Score** later."
>
> **Dev:** "So the **Review Board** shows **Candidate Clips** ranked by **Overall Score**, with **Smoothness Score** weighted most heavily?"
>
> **Domain expert:** "Exactly. The **Drone User** wants to remove shaky **Footage** quickly, accept the best clips, order them, and create an **Export**."
>
> **Dev:** "And the **Timeline** only contains **Accepted Clips**, not every suggested segment?"
>
> **Domain expert:** "Correct. A **Candidate Clip** becomes part of the **Timeline** only after the **Editor** accepts it."

## Flagged Ambiguities

- "Clip" has been used to mean **Source Video**, **Candidate Clip**, and a placement on the timeline. Use **Source Video** for imported files, **Candidate Clip** for suggested time ranges, and **Timeline Item** for a placement on the **Timeline**.
- "AI score" is too narrow for the MVP because the first scoring path is rule-based. Use **Overall Score**, **Smoothness Score**, or **Visual Interest Score** depending on the meaning.
- "Timeline" has been used for both the editing UI and the data it edits. Use **Review Board** for the candidate-curation UI, **Timeline** for the ordered sequence of **Timeline Items**, and **Timeline Document** when stressing that the backend owns the authoritative record.
- "Manual" can mean hand-editing or rule-based scoring. Use **Manual Harness** for deterministic no-AI scoring and **Trim** or **Accepted Clip** for editor actions.
- "Scene" and "shot" are close. Use **Scene** until the app explicitly models cinematographic shots separately.
