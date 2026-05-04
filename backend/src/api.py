"""
AI Clip Assembler — FastAPI Backend

Provides REST endpoints for:
- Video ingestion and analysis
- AI harness clip suggestions
- Timeline assembly
- Export generation (FCPXML, EDL)
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Literal
import uuid
import json
from pathlib import Path

app = FastAPI(
    title="AI Clip Assembler API",
    version="0.1.0",
    description="Local-first video analysis and AI clip assembly backend"
)

# CORS for Electron frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory store (replace with SQLite/JSON later)
projects = {}


class VideoMetadata(BaseModel):
    file_id: str
    file_name: str
    duration_sec: float
    fps: float
    resolution: List[int]


class ClipSuggestion(BaseModel):
    clip_id: str
    file_id: str
    start_sec: float
    end_sec: float
    smoothness_score: float
    visual_interest_score: float
    overall_score: float
    ai_reason: str


class AnalysisRequest(BaseModel):
    project_id: str
    harness_id: Literal["local_qwen", "claude_code", "codex", "pi_agent", "manual"]
    preferences: dict


@app.get("/")
async def root():
    return {"status": "ok", "version": "0.1.0"}


@app.post("/projects")
async def create_project():
    """Create a new project."""
    project_id = str(uuid.uuid4())
    projects[project_id] = {
        "project_id": project_id,
        "videos": [],
        "clips": [],
        "timeline": None
    }
    return {"project_id": project_id}


@app.post("/projects/{project_id}/videos")
async def upload_video(project_id: str, file: UploadFile = File(...)):
    """Upload a video file for analysis."""
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # TODO: Save file, run FFmpeg probe, extract metadata
    file_id = str(uuid.uuid4())
    video = {
        "file_id": file_id,
        "file_name": file.filename,
        "status": "uploaded",
        "metadata": None
    }
    projects[project_id]["videos"].append(video)
    return {"file_id": file_id, "status": "uploaded"}


@app.post("/projects/{project_id}/analyze")
async def analyze_videos(project_id: str, request: AnalysisRequest):
    """Run AI harness analysis on all videos in project."""
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # TODO: Run FFmpeg frame extraction, OpenCV analysis, harness routing
    return {
        "project_id": project_id,
        "harness_id": request.harness_id,
        "status": "analyzing",
        "clips": []
    }


@app.get("/projects/{project_id}/clips")
async def get_clips(project_id: str):
    """Get all suggested clips for a project."""
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"clips": projects[project_id].get("clips", [])}


@app.post("/projects/{project_id}/export")
async def export_timeline(
    project_id: str,
    format: Literal["fcpxml", "edl", "resolve_xml"]
):
    """Export assembled timeline to professional editor format."""
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # TODO: Generate FCPXML / EDL / Resolve XML
    return {
        "project_id": project_id,
        "format": format,
        "status": "generated",
        "file_path": None
    }


@app.get("/harnesses")
async def list_harnesses():
    """List available AI harnesses."""
    return {
        "harnesses": [
            {"id": "local_qwen", "name": "Local Qwen Vision", "type": "local", "enabled": True},
            {"id": "claude_code", "name": "Claude Code", "type": "agent", "enabled": False},
            {"id": "codex", "name": "Codex", "type": "agent", "enabled": False},
            {"id": "pi_agent", "name": "Pi Agent", "type": "agent", "enabled": False},
            {"id": "manual", "name": "Manual / Rule-based", "type": "rule", "enabled": True}
        ]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
