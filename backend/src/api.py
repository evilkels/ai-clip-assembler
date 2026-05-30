"""
AI Clip Assembler - FastAPI Backend

Provides REST endpoints for local video ingestion, smooth drone clip analysis,
timeline assembly, and editor export files.
"""

import shutil
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .clip_assembly import AssemblyPreferences, assemble_smooth_clips
from .export_engine import choose_timeline_fps, generate_edl, generate_fcpxml
from .local_qwen_harness import enhance_clips_with_local_qwen  # noqa: F401 (postponed; kept for future re-enable)
from .pi_cli_harness import enhance_clips_with_pi_cli
from .frame_extraction import FFmpegError, FFmpegUnavailableError, extract_frames
from .models import FrameSample
from .motion_analysis import (
    FFmpegVidstabError,
    FFmpegVidstabUnavailableError,
    run_vidstabdetect,
)
from .quality_scoring import score_samples_from_images
from .scene_detection import SceneBoundary, assign_scene_ids, detect_scenes
from .video_probe import FFprobeError, FFprobeUnavailableError, probe_video

app = FastAPI(
    title="AI Clip Assembler API",
    version="0.1.0",
    description="Local-first video analysis and AI clip assembly backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

projects = {}
PROJECTS_DIR = Path(".ai-clip-assembler/projects")


class AnalysisRequest(BaseModel):
    project_id: str
    harness_id: Literal["local_qwen", "claude_code", "codex", "pi_agent", "manual"]
    preferences: dict


class TimelineClipUpdate(BaseModel):
    clip_id: str
    start_sec: float
    end_sec: float
    included: bool = True


class TimelineUpdateRequest(BaseModel):
    clips: list[TimelineClipUpdate]


@app.get("/")
async def root():
    return {"status": "ok", "version": "0.1.0"}


@app.post("/projects")
async def create_project():
    project_id = str(uuid.uuid4())
    project_dir(project_id).mkdir(parents=True, exist_ok=True)
    projects[project_id] = {
        "project_id": project_id,
        "videos": [],
        "clips": [],
        "timeline": None,
    }
    return {"project_id": project_id}


@app.post("/projects/{project_id}/videos")
async def upload_video(project_id: str, file: UploadFile = File(...)):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    file_id = str(uuid.uuid4())
    safe_name = Path(file.filename or f"{file_id}.mp4").name
    video_path = project_dir(project_id) / "videos" / f"{file_id}_{safe_name}"
    video_path.parent.mkdir(parents=True, exist_ok=True)
    with video_path.open("wb") as output:
        shutil.copyfileobj(file.file, output)

    try:
        metadata = probe_video(video_path)
    except FFprobeUnavailableError as exc:
        video_path.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except FFprobeError as exc:
        video_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    metadata.file_id = file_id
    metadata.file_name = safe_name
    metadata.file_path = str(video_path)
    video = {
        "file_id": file_id,
        "file_name": safe_name,
        "file_path": str(video_path),
        "status": "ready",
        "metadata": metadata.model_dump(),
    }
    projects[project_id]["videos"].append(video)
    return {"file_id": file_id, "status": "ready", "metadata": metadata.model_dump()}


@app.post("/projects/{project_id}/analyze")
async def analyze_videos(project_id: str, request: AnalysisRequest):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    if request.harness_id not in ("manual", "pi_agent"):
        raise HTTPException(status_code=400, detail="Only manual and pi_agent harnesses are available in the drone MVP")

    all_clips = []
    per_video_results = []
    preferences = preferences_from_request(request.preferences)
    sample_fps = sample_fps_from_request(request.preferences)
    for video in projects[project_id]["videos"]:
        try:
            run_vidstabdetect(
                input_path=Path(video["file_path"]),
                transforms_path=project_dir(project_id) / "motion" / f"{video['file_id']}.trf",
            )
            samples = extract_frames(
                input_path=Path(video["file_path"]),
                frames_dir=project_dir(project_id) / "frames" / video["file_id"],
                file_id=video["file_id"],
                sample_fps=sample_fps,
                max_width=int(request.preferences.get("max_width", 960)),
            )
            scenes = detect_scenes(Path(video["file_path"]))
            samples = assign_scene_ids(samples, scenes)
        except FFmpegVidstabUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except FFmpegVidstabError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except FFmpegUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except FFmpegError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        frame_scores = score_samples_rule_based(samples)
        result = assemble_smooth_clips(
            file_id=video["file_id"],
            file_name=video["file_name"],
            frames=frame_scores,
            preferences=preferences,
        )
        video_metadata = {}
        if request.harness_id == "pi_agent":
            result, used_ai = enhance_clips_with_pi_cli(result, frame_scores)
            video_metadata["used_ai"] = used_ai
            video_metadata["model_used"] = result.metadata.get("model_used")
            video_metadata["file_id"] = video["file_id"]
            if result.metadata.get("warning"):
                video_metadata["warning"] = result.metadata["warning"]
            if result.metadata.get("partial_enhancement"):
                video_metadata["partial_enhancement"] = True
                video_metadata["clips_enhanced"] = result.metadata.get("clips_enhanced")
                video_metadata["clips_total"] = result.metadata.get("clips_total")
        per_video_results.append(video_metadata)
        clips = [clip.model_dump() for clip in result.clips]
        all_clips.extend(clips)

    ranked_clips = sorted(all_clips, key=lambda clip: clip["overall_score"], reverse=True)
    sequence_clip_ids = [clip["clip_id"] for clip in ranked_clips]
    total_duration = sum(clip["duration_sec"] for clip in ranked_clips)

    projects[project_id]["clips"] = ranked_clips
    projects[project_id]["timeline"] = {
        "total_duration_sec": round(total_duration, 3),
        "clips": sequence_clip_ids,
    }
    response = {
        "project_id": project_id,
        "harness_id": request.harness_id,
        "status": "complete",
        "clips": ranked_clips,
        "sequence": projects[project_id]["timeline"],
    }
    if request.harness_id == "pi_agent":
        harness_metadata = {"per_video": per_video_results}
        all_ai = all(v.get("used_ai") for v in per_video_results)
        any_ai = any(v.get("used_ai") for v in per_video_results)
        any_fallback = any(v.get("warning") for v in per_video_results)
        if any_fallback or not all_ai:
            harness_metadata["used_ai"] = any_ai
            fallback_videos = [
                v["file_id"] for v in per_video_results if v.get("warning")
            ]
            harness_metadata["warning"] = (
                f"pi harness fallback for video(s): {', '.join(fallback_videos)}"
                if fallback_videos else "pi harness fallback"
            )
        else:
            harness_metadata["used_ai"] = True
        models_used = list({
            v["model_used"] for v in per_video_results if v.get("model_used")
        })
        if len(models_used) == 1:
            harness_metadata["model_used"] = models_used[0]
        elif models_used:
            harness_metadata["models_used"] = models_used
        harness_metadata["local"] = False
        response["metadata"] = harness_metadata
    return response


@app.put("/projects/{project_id}/timeline")
async def update_timeline(project_id: str, request: TimelineUpdateRequest):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")

    project = projects[project_id]
    if not project.get("clips"):
        raise HTTPException(status_code=400, detail="No analyzed clips available to update")

    resolved_clips = resolve_timeline_clips(project, request.clips)
    total_duration_sec = round(sum(clip["duration_sec"] for clip in resolved_clips), 3)
    project["timeline"] = {
        "clips": resolved_clips,
        "total_duration_sec": total_duration_sec,
    }
    return {
        "project_id": project_id,
        "clips": resolved_clips,
        "total_duration_sec": total_duration_sec,
    }


@app.get("/projects/{project_id}/clips")
async def get_clips(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"clips": projects[project_id].get("clips", [])}


@app.post("/projects/{project_id}/export")
async def export_timeline(project_id: str, format: Literal["fcpxml", "edl", "resolve_xml"]):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    if not projects[project_id].get("clips"):
        raise HTTPException(status_code=400, detail="No clips available to export")

    export_dir = project_dir(project_id) / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    videos_by_id = {video["file_id"]: video for video in projects[project_id]["videos"]}
    clips = clips_in_timeline_order(projects[project_id])

    if format == "edl":
        file_path = export_dir / "timeline.edl"
        file_path.write_text(
            generate_edl("AI Clip Assembler", clips, fps=round_edl_fps(choose_timeline_fps(videos_by_id))),
            encoding="utf-8",
        )
    elif format == "fcpxml":
        file_path = export_dir / "timeline.fcpxml"
        file_path.write_text(generate_fcpxml("AI Clip Assembler", clips, videos_by_id), encoding="utf-8")
    else:
        raise HTTPException(status_code=400, detail="Resolve XML export is not implemented yet")

    return {
        "project_id": project_id,
        "format": format,
        "status": "generated",
        "file_path": str(file_path),
        "clip_count": len(clips),
        "total_duration_sec": round(sum(clip["duration_sec"] for clip in clips), 3),
    }


@app.get("/harnesses")
async def list_harnesses():
    return {
        "harnesses": [
            {"id": "manual", "name": "Manual / Rule-based", "type": "rule", "enabled": True},
            {"id": "pi_agent", "name": "Pi Agent", "type": "agent", "enabled": True},
            {"id": "local_qwen", "name": "Local Qwen Vision", "type": "local", "enabled": False},
            {"id": "claude_code", "name": "Claude Code", "type": "agent", "enabled": False},
            {"id": "codex", "name": "Codex", "type": "agent", "enabled": False},
        ]
    }


def project_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id


def clips_in_timeline_order(project: dict) -> list:
    clips_by_id = {clip["clip_id"]: clip for clip in project.get("clips", [])}
    timeline = project.get("timeline")
    if timeline is None or "clips" not in timeline:
        return project.get("clips", [])

    timeline_entries = timeline.get("clips") or []
    if not timeline_entries:
        return []

    if isinstance(timeline_entries[0], str):
        return [clips_by_id[clip_id] for clip_id in timeline_entries if clip_id in clips_by_id]

    return resolve_timeline_entries(clips_by_id, timeline_entries)


def resolve_timeline_clips(project: dict, updates: list[TimelineClipUpdate]) -> list[dict]:
    clips_by_id = {clip["clip_id"]: clip for clip in project.get("clips", [])}
    seen_clip_ids = set()
    timeline_entries = []

    for update in updates:
        if update.clip_id in seen_clip_ids:
            raise HTTPException(status_code=422, detail=f"Duplicate clip_id: {update.clip_id}")
        seen_clip_ids.add(update.clip_id)

        if update.clip_id not in clips_by_id:
            raise HTTPException(status_code=422, detail=f"Unknown clip_id: {update.clip_id}")

        if update.start_sec >= update.end_sec:
            raise HTTPException(status_code=422, detail=f"Timeline clip must satisfy start_sec < end_sec for {update.clip_id}")

        original_clip = clips_by_id[update.clip_id]
        if update.start_sec < original_clip["start_sec"] or update.end_sec > original_clip["end_sec"]:
            raise HTTPException(
                status_code=422,
                detail=f"Timeline trim is outside original clip bounds for {update.clip_id}",
            )

        if not update.included:
            continue

        timeline_entries.append(
            {
                "clip_id": update.clip_id,
                "start_sec": update.start_sec,
                "end_sec": update.end_sec,
                "duration_sec": round(update.end_sec - update.start_sec, 3),
                "included": True,
            }
        )

    return resolve_timeline_entries(clips_by_id, timeline_entries)


def resolve_timeline_entries(clips_by_id: dict, timeline_entries: list[dict]) -> list[dict]:
    resolved_clips = []
    for timeline_entry in timeline_entries:
        clip_id = timeline_entry["clip_id"]
        if clip_id not in clips_by_id:
            continue
        resolved_clips.append(
            {
                **clips_by_id[clip_id],
                "start_sec": timeline_entry["start_sec"],
                "end_sec": timeline_entry["end_sec"],
                "duration_sec": round(timeline_entry["end_sec"] - timeline_entry["start_sec"], 3),
            }
        )
    return resolved_clips


def round_edl_fps(fps: float) -> int:
    return int(round(fps or 30))


def preferences_from_request(preferences: dict) -> AssemblyPreferences:
    return AssemblyPreferences(
        min_clip_duration_sec=float(preferences.get("min_clip_duration_sec", 3.0)),
        max_clip_duration_sec=float(preferences.get("max_clip_duration_sec", 15.0)),
        smoothness_threshold=float(preferences.get("smoothness_threshold", 7.0)),
        target_duration_sec=float(preferences.get("target_duration_sec", 120.0)),
    )


def sample_fps_from_request(preferences: dict) -> float:
    sample_fps = float(preferences.get("sample_fps", 1.0))
    if sample_fps <= 0:
        raise HTTPException(status_code=422, detail="sample_fps must be greater than 0")
    return sample_fps


def score_samples_rule_based(samples: list) -> list:
    frame_samples = [
        sample if isinstance(sample, FrameSample) else FrameSample.model_validate(sample)
        for sample in samples
    ]
    return score_samples_from_images(frame_samples)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)