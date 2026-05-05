"""
AI Clip Assembler - FastAPI Backend

Provides REST endpoints for local video ingestion, smooth drone clip analysis,
timeline assembly, and export generation.
"""

import shutil
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .clip_assembly import AssemblyPreferences, assemble_smooth_clips
from .frame_extraction import extract_frames
from .models import FrameSample
from .quality_scoring import score_samples_from_images
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
    video_path = project_dir(project_id) / "videos" / safe_name
    video_path.parent.mkdir(parents=True, exist_ok=True)
    with video_path.open("wb") as output:
        shutil.copyfileobj(file.file, output)

    try:
        metadata = probe_video(video_path)
    except FFprobeUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except FFprobeError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    metadata.file_id = file_id
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
    if request.harness_id != "manual":
        raise HTTPException(status_code=400, detail="Only manual harness is available in the drone MVP")

    all_clips = []
    sequence_clip_ids = []
    total_duration = 0.0
    for video in projects[project_id]["videos"]:
        samples = extract_frames(
            input_path=Path(video["file_path"]),
            frames_dir=project_dir(project_id) / "frames" / video["file_id"],
            file_id=video["file_id"],
            sample_fps=float(request.preferences.get("sample_fps", 1.0)),
            max_width=int(request.preferences.get("max_width", 960)),
        )
        frame_scores = score_samples_rule_based(samples)
        result = assemble_smooth_clips(
            file_id=video["file_id"],
            file_name=video["file_name"],
            frames=frame_scores,
            preferences=preferences_from_request(request.preferences),
        )
        clips = [clip.model_dump() for clip in result.clips]
        all_clips.extend(clips)
        sequence_clip_ids.extend(result.sequence.clips)
        total_duration += result.sequence.total_duration_sec

    projects[project_id]["clips"] = all_clips
    projects[project_id]["timeline"] = {
        "total_duration_sec": round(total_duration, 3),
        "clips": sequence_clip_ids,
    }
    return {
        "project_id": project_id,
        "harness_id": request.harness_id,
        "status": "complete",
        "clips": all_clips,
        "sequence": projects[project_id]["timeline"],
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

    return {
        "project_id": project_id,
        "format": format,
        "status": "generated",
        "file_path": None,
    }


@app.get("/harnesses")
async def list_harnesses():
    return {
        "harnesses": [
            {"id": "manual", "name": "Manual / Rule-based", "type": "rule", "enabled": True},
            {"id": "local_qwen", "name": "Local Qwen Vision", "type": "local", "enabled": False},
            {"id": "claude_code", "name": "Claude Code", "type": "agent", "enabled": False},
            {"id": "codex", "name": "Codex", "type": "agent", "enabled": False},
            {"id": "pi_agent", "name": "Pi Agent", "type": "agent", "enabled": False},
        ]
    }


def project_dir(project_id: str) -> Path:
    return PROJECTS_DIR / project_id


def preferences_from_request(preferences: dict) -> AssemblyPreferences:
    return AssemblyPreferences(
        min_clip_duration_sec=float(preferences.get("min_clip_duration_sec", 3.0)),
        max_clip_duration_sec=float(preferences.get("max_clip_duration_sec", 15.0)),
        smoothness_threshold=float(preferences.get("smoothness_threshold", 7.0)),
        target_duration_sec=float(preferences.get("target_duration_sec", 120.0)),
    )


def score_samples_rule_based(samples: list) -> list:
    frame_samples = [
        sample if isinstance(sample, FrameSample) else FrameSample.model_validate(sample)
        for sample in samples
    ]
    return score_samples_from_images(frame_samples)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
