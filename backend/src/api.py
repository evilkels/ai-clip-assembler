"""
AI Clip Assembler - FastAPI Backend

Provides REST endpoints for local video ingestion, smooth drone clip analysis,
timeline assembly, and editor export files.
"""

import shutil
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .clip_assembly import AssemblyPreferences, assemble_smooth_clips
from .export_engine import generate_edl, generate_fcpxml
from .local_qwen_harness import enhance_clips_with_local_qwen
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
    if request.harness_id not in ("manual", "local_qwen"):
        raise HTTPException(status_code=400, detail="Only manual and local_qwen harnesses are available in the drone MVP")

    all_clips = []
    harness_metadata = {}
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
        if request.harness_id == "local_qwen":
            result, used_ai = enhance_clips_with_local_qwen(result, frame_scores)
            if not used_ai:
                harness_metadata["warning"] = result.metadata.get(
                    "warning", "Local Qwen fallback: Ollama/model unavailable"
                )
            else:
                harness_metadata["model_used"] = result.metadata.get("model_used")
                harness_metadata["local"] = True
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
    if request.harness_id == "local_qwen":
        response["metadata"] = harness_metadata
    return response


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
        file_path.write_text(generate_edl("AI Clip Assembler", clips), encoding="utf-8")
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
    }


@app.get("/harnesses")
async def list_harnesses():
    return {
        "harnesses": [
            {"id": "manual", "name": "Manual / Rule-based", "type": "rule", "enabled": True},
            {"id": "local_qwen", "name": "Local Qwen Vision", "type": "local", "enabled": True},
            {"id": "claude_code", "name": "Claude Code", "type": "agent", "enabled": False},
            {"id": "codex", "name": "Codex", "type": "agent", "enabled": False},
            {"id": "pi_agent", "name": "Pi Agent", "type": "agent", "enabled": False},
        ]
    }


def project_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id


def clips_in_timeline_order(project: dict) -> list:
    clips_by_id = {clip["clip_id"]: clip for clip in project.get("clips", [])}
    timeline_ids = (project.get("timeline") or {}).get("clips", [])
    if not timeline_ids:
        return project.get("clips", [])
    return [clips_by_id[clip_id] for clip_id in timeline_ids if clip_id in clips_by_id]


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
