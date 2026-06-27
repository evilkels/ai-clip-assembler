"""
AI Clip Assembler - FastAPI Backend

Provides REST endpoints for local video ingestion, smooth drone clip analysis,
timeline assembly, and editor export files.
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import List, Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

# Load repo-root .env before harness imports: PI_*/OLLAMA_* are read at import time.
load_dotenv()

from .clip_assembly import AssemblyPreferences, assemble_smooth_clips
from .assembly_profiles import AssemblyProfile, build_draft_timeline, recommend_assembly_profile
from .export_engine import (
    choose_timeline_fps,
    edl_flatten_warnings,
    generate_edl,
    generate_fcpxml,
    generate_resolve_xml,
)
from .app_settings import EDITABLE_KEYS, get_settings, update_settings
from .local_qwen_harness import enhance_clips_with_local_qwen  # noqa: F401 (postponed; kept for future re-enable)
from .pi_cli_harness import REPO_ROOT, enhance_clips_with_pi_cli
from .frame_extraction import FFmpegError, FFmpegUnavailableError, extract_frames
from .models import FrameSample
from .motion_analysis import (
    FFmpegVidstabError,
    FFmpegVidstabUnavailableError,
    parse_trf,
    run_vidstabdetect,
)
from .models import TimelineDocument
from .project_store import (
    InvalidProjectManifestError,
    NoSourceVideosFoundError,
    ProjectFolderNotWritableError,
    ProjectNotFoundError,
    ProjectStoreError,
    UnsafeProjectFolderError,
    create_or_open_project as create_or_open_folder_project,
    delete_project_files,
    load_timeline_document,
    migrate_legacy_timeline,
    project_state_dir,
    read_analysis_results,
    rescan_project,
    write_analysis_results,
    write_timeline_document,
)
from .mcp_server import TimelineMCPServer
from .review_agent import ProposalStore, ReviewAgentError, default_review_agent, run_review_turn
from .review_state import review_context_fingerprint, sequence_fingerprint
from .timeline_ops import (
    SourceClip,
    TimelineController,
    TimelineOpError,
    TimelineRevisionConflict,
)
from .timeline_service import TimelineEventBroker
from .quality_scoring import score_samples_from_images
from .scene_detection import SceneBoundary, assign_scene_ids, detect_scenes  # noqa: F401 - public test seam
from .video_probe import FFprobeError, FFprobeUnavailableError, probe_video

# uvicorn's logger so progress messages reach the dev console without extra config
logger = logging.getLogger("uvicorn.error")

app = FastAPI(
    title="AI Clip Assembler API",
    version="0.1.0",
    description="Local-first video analysis and AI clip assembly backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server (npm run dev)
        "http://127.0.0.1:5173",
        "null",  # packaged/preview Electron renderer loads via file:// (Origin: null)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

projects = {}
PROJECTS_DIR = Path(".ai-clip-assembler/projects")
VIDEO_STREAM_CHUNK_SIZE = 1024 * 1024

# Backend-authoritative Timeline Document layer. One TimelineController per
# project owns the document + undo history + write lock; the broker fans out
# `timeline-changed` events to connected clients (GUI over SSE) so the GUI is a
# thin live-syncing client of the document rather than the source of truth.
_timeline_controllers: dict[str, TimelineController] = {}
_timeline_broker = TimelineEventBroker()

# In-app review agent (propose mode). The model call is injected so it is
# testable/overridable; proposals are staged here and replayed through the
# operations core on accept.
_proposal_store = ProposalStore()
_review_agent = default_review_agent
_review_locks: dict[str, asyncio.Lock] = {}

# --- Analysis cancellation -------------------------------------------------
# A SIGTERM'd ffmpeg exits 0 (looks like success), so cancelling needs an
# explicit cooperative flag plus a handle on the running subprocess to kill.
_analysis_cancel: dict[str, threading.Event] = {}
_analysis_active_proc: dict[str, subprocess.Popen] = {}


class AnalysisCancelled(Exception):
    """Raised inside the pipeline when the user aborts an in-flight analysis."""


def _check_cancelled(project_id: str) -> None:
    event = _analysis_cancel.get(project_id)
    if event is not None and event.is_set():
        raise AnalysisCancelled()


def _make_cancellable_runner(project_id: str):
    """A subprocess.run-compatible runner that registers the live process so a
    cancel request can kill it immediately, then surfaces AnalysisCancelled."""

    def runner(cmd, check=False, capture_output=False, text=False, **_kwargs):
        _check_cancelled(project_id)
        pipe = subprocess.PIPE if capture_output else None
        proc = subprocess.Popen(cmd, stdout=pipe, stderr=pipe, text=text)
        _analysis_active_proc[project_id] = proc
        try:
            out, err = proc.communicate()
        finally:
            _analysis_active_proc.pop(project_id, None)
        _check_cancelled(project_id)
        if check and proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=out, stderr=err)
        return subprocess.CompletedProcess(cmd, proc.returncode, stdout=out, stderr=err)

    return runner


class AnalysisRequest(BaseModel):
    project_id: str
    harness_id: Literal["local_qwen", "claude_code", "codex", "pi_agent", "manual"]
    preferences: dict
    # When provided, only these source videos are analyzed (file_id values).
    # Empty/omitted means analyze every source video in the project.
    file_ids: Optional[List[str]] = None


class TimelineClipUpdate(BaseModel):
    clip_id: str
    start_sec: float
    end_sec: float
    included: bool = True


class TimelineUpdateRequest(BaseModel):
    clips: list[TimelineClipUpdate]
    decisions: dict[str, Literal["included", "excluded"]] = {}
    profile: Optional[Literal["short_social", "cinematic_highlight", "long_scenic", "custom"]] = None
    target_duration_sec: Optional[float] = None


class DraftRequest(BaseModel):
    profile: AssemblyProfile
    target_duration_sec: Optional[float] = None


class ProjectFolderRequest(BaseModel):
    folder_path: str


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
    _proposal_store.configure_project(project_id)
    return {"project_id": project_id}


@app.post("/projects/from-folder")
async def create_project_from_folder(request: ProjectFolderRequest):
    folder_path = Path(request.folder_path).expanduser()
    try:
        manifest = create_or_open_folder_project(folder_path)
    except NoSourceVideosFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ProjectFolderNotWritableError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except UnsafeProjectFolderError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (ProjectNotFoundError, FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidProjectManifestError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ProjectStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    project_id = str(uuid.uuid4())
    videos = videos_from_manifest(folder_path, manifest)
    restored = read_analysis_results(folder_path)
    clips = restored["clips"] if restored else []
    timeline = restored.get("timeline") if restored else None
    projects[project_id] = {
        "project_id": project_id,
        "project_folder": str(folder_path),
        "project": manifest.model_dump(),
        "videos": videos,
        "clips": clips,
        "timeline": timeline,
        "harness_id": restored.get("harness_id") if restored else None,
    }
    _proposal_store.configure_project(project_id, folder_path)
    return {
        "project_id": project_id,
        "project_folder": str(folder_path),
        "project": manifest.model_dump(),
        "videos": videos,
        "clips": clips,
        "timeline": timeline,
    }


@app.post("/projects/{project_id}/rescan")
async def rescan_project_sources(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    if not project.get("project_folder"):
        raise HTTPException(status_code=400, detail="Rescan is only available for folder projects")

    folder_path = Path(project["project_folder"])
    try:
        manifest = rescan_project(folder_path)
    except ProjectStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    videos = videos_from_manifest(folder_path, manifest)
    project["project"] = manifest.model_dump()
    project["videos"] = videos
    # Existing clips/timeline stay valid for already-analyzed videos; the user
    # re-analyzes to cover newly discovered footage.
    return {
        "project_id": project_id,
        "project_folder": str(folder_path),
        "project": manifest.model_dump(),
        "videos": videos,
    }


@app.delete("/projects/{project_id}/files")
async def delete_project_owned_files(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    if not project.get("project_folder"):
        raise HTTPException(status_code=400, detail="Delete project files is only available for folder projects")

    deleted = delete_project_files(Path(project["project_folder"]))
    del projects[project_id]
    return {"project_id": project_id, "deleted": deleted}


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


@app.get("/projects/{project_id}/videos/{file_id}/media")
async def get_project_video_media(
    project_id: str,
    file_id: str,
    range_header: Optional[str] = Header(default=None, alias="Range"),
):
    video = registered_video(project_id, file_id)
    video_path = Path(video["file_path"])
    if not video_path.exists() or not video_path.is_file():
        raise HTTPException(status_code=404, detail="Video file not found")
    media_type = media_type_for_video(video_path)
    if range_header:
        return ranged_video_response(
            video_path,
            range_header,
            media_type=media_type,
        )
    return FileResponse(
        video_path,
        media_type=media_type,
        filename=video["file_name"],
        content_disposition_type="inline",
        headers={"Accept-Ranges": "bytes"},
    )


def set_analysis_progress(project_id: str, **fields) -> None:
    progress = projects[project_id].setdefault("analysis_progress", {})
    now = time.time()
    progress.setdefault("started_at", now)
    fields.setdefault("updated_at", now)
    progress.update(fields)


@app.get("/projects/{project_id}/analyze/status")
async def get_analysis_status(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    progress = projects[project_id].get("analysis_progress")
    if not progress:
        return {"phase": "idle"}
    status = dict(progress)
    started_at = status.get("started_at")
    if isinstance(started_at, (int, float)):
        status["elapsed_sec"] = round(max(0.0, time.time() - started_at), 2)
    return status


@app.post("/projects/{project_id}/analyze")
def analyze_videos(project_id: str, request: AnalysisRequest):
    # Sync on purpose: the pipeline is blocking subprocess work, and a sync
    # endpoint runs in a worker thread so the server stays responsive.
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    if request.harness_id not in ("manual", "pi_agent"):
        raise HTTPException(status_code=400, detail="Only manual and pi_agent harnesses are available in the drone MVP")
    current = projects[project_id].get("analysis_progress") or {}
    if current.get("phase") == "analyzing":
        raise HTTPException(status_code=409, detail="Analysis already in progress for this project")

    # Validate request preferences up front so bad input wins over selection state.
    sample_fps_from_request(request.preferences)
    selected = selected_videos(project_id, request)
    if request.file_ids is not None and not selected:
        raise HTTPException(status_code=400, detail="No source videos selected for analysis")

    _analysis_cancel[project_id] = threading.Event()
    projects[project_id]["analysis_progress"] = {}
    set_analysis_progress(
        project_id,
        phase="analyzing",
        harness_id=request.harness_id,
        step="starting",
        video_index=0,
        video_total=len(selected),
        file_name=None,
        clip_index=0,
        clip_total=0,
        message="Preparing analysis",
        error=None,
    )
    try:
        response = run_analysis_pipeline(project_id, request)
    except AnalysisCancelled:
        set_analysis_progress(
            project_id, phase="cancelled", message="Analysis cancelled", error=None
        )
        raise HTTPException(status_code=409, detail="Analysis cancelled")
    except HTTPException as exc:
        set_analysis_progress(project_id, phase="error", error=str(exc.detail))
        raise
    except Exception as exc:
        set_analysis_progress(project_id, phase="error", error=str(exc))
        raise
    finally:
        _analysis_cancel.pop(project_id, None)
        _analysis_active_proc.pop(project_id, None)
    set_analysis_progress(
        project_id,
        phase="complete",
        step="complete",
        message="Analysis complete",
        timings=response["timings"],
    )
    return response


def selected_videos(project_id: str, request: AnalysisRequest) -> list[dict]:
    """Source videos to analyze: the requested subset, or all when unfiltered.

    Order follows the project's video order so progress indices stay stable.
    """
    videos = projects[project_id]["videos"]
    if request.file_ids is None:
        return list(videos)
    wanted = set(request.file_ids)
    return [v for v in videos if v["file_id"] in wanted]


@app.post("/projects/{project_id}/analyze/cancel")
async def cancel_analysis(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    progress = projects[project_id].get("analysis_progress") or {}
    if progress.get("phase") != "analyzing":
        return {"status": "idle"}
    event = _analysis_cancel.setdefault(project_id, threading.Event())
    event.set()
    proc = _analysis_active_proc.get(project_id)
    if proc is not None and proc.poll() is None:
        proc.kill()
    set_analysis_progress(project_id, message="Cancelling analysis…")
    return {"status": "cancelling"}


def run_analysis_pipeline(project_id: str, request: AnalysisRequest) -> dict:
    pipeline_started = time.monotonic()
    all_clips = []
    per_video_results = []
    timings = []
    preferences = preferences_from_request(request.preferences)
    sample_fps = sample_fps_from_request(request.preferences)
    cancellable_runner = _make_cancellable_runner(project_id)
    videos_to_analyze = selected_videos(project_id, request)
    total_videos = len(videos_to_analyze)
    for index, video in enumerate(videos_to_analyze, start=1):
        _check_cancelled(project_id)
        video_started = time.monotonic()
        video_timing = {"file_name": video["file_name"]}
        set_analysis_progress(
            project_id,
            video_index=index,
            file_name=video["file_name"],
            clip_index=0,
            clip_total=0,
            message=f"Preparing video {index}/{total_videos}: {video['file_name']}",
        )
        try:
            logger.info(
                "Analyze %d/%d %s: motion analysis (vidstabdetect)",
                index, total_videos, video["file_name"],
            )
            set_analysis_progress(
                project_id,
                step="motion_analysis",
                message=(
                    f"Video {index}/{total_videos}: running FFmpeg motion analysis "
                    "(this can take a while on long clips)"
                ),
            )
            phase_started = time.monotonic()
            transforms_path = analysis_dir(project_id) / "motion" / f"{video['file_id']}.trf"
            run_vidstabdetect(
                input_path=Path(video["file_path"]),
                transforms_path=transforms_path,
                runner=cancellable_runner,
            )
            video_timing["motion_analysis_sec"] = round(time.monotonic() - phase_started, 2)
            logger.info(
                "Analyze %d/%d %s: extracting frame samples",
                index, total_videos, video["file_name"],
            )
            set_analysis_progress(
                project_id,
                step="frame_extraction",
                message=f"Video {index}/{total_videos}: extracting frame samples",
            )
            phase_started = time.monotonic()
            samples = extract_frames(
                input_path=Path(video["file_path"]),
                frames_dir=samples_dir(project_id) / video["file_id"],
                file_id=video["file_id"],
                sample_fps=sample_fps,
                max_width=int(request.preferences.get("max_width", 960)),
                runner=cancellable_runner,
            )
            video_timing["frame_extraction_sec"] = round(time.monotonic() - phase_started, 2)
            logger.info(
                "Analyze %d/%d %s: detecting scenes",
                index, total_videos, video["file_name"],
            )
            set_analysis_progress(
                project_id,
                step="scene_detection",
                message=f"Video {index}/{total_videos}: detecting scene boundaries",
            )
            phase_started = time.monotonic()
            scenes = detect_scenes(Path(video["file_path"]))
            samples = assign_scene_ids(samples, scenes)
            video_timing["scene_detection_sec"] = round(time.monotonic() - phase_started, 2)
        except FFmpegVidstabUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except FFmpegVidstabError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except FFmpegUnavailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except FFmpegError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        phase_started = time.monotonic()
        if transforms_path.exists():
            fps = float((video.get("metadata") or {}).get("fps") or 30.0)
            frame_scores = score_samples_rule_based(samples, parse_trf(transforms_path, fps=fps))
        else:
            frame_scores = score_samples_rule_based(samples)
        result = assemble_smooth_clips(
            file_id=video["file_id"],
            file_name=video["file_name"],
            frames=frame_scores,
            preferences=preferences,
            scene_bounds={
                scene.scene_id: (scene.start_sec, scene.end_sec)
                for scene in scenes
            },
            source_duration_sec=float(
                (video.get("metadata") or {}).get("duration_sec") or 0.0
            ) or None,
        )
        video_timing["assembly_sec"] = round(time.monotonic() - phase_started, 2)
        video_timing["ai_scoring_sec"] = 0.0
        logger.info(
            "Analyze %d/%d %s: %d candidate clip(s) assembled",
            index, total_videos, video["file_name"], len(result.clips),
        )
        video_metadata = {}
        if request.harness_id == "pi_agent":
            logger.info(
                "Analyze %d/%d %s: scoring %d clip(s) with pi — one CLI call per clip, can take minutes",
                index, total_videos, video["file_name"], len(result.clips),
            )
            set_analysis_progress(
                project_id,
                step="scoring_clips",
                clip_index=0,
                clip_total=len(result.clips),
                message=(
                    f"Video {index}/{total_videos}: scoring {len(result.clips)} clip(s) "
                    "with Pi"
                ),
            )
            phase_started = time.monotonic()
            def pi_progress(done, total, _index=index):
                # Abort between clips when the user cancels (pi runs its own
                # subprocess per clip, so we can't kill it mid-call).
                _check_cancelled(project_id)
                set_analysis_progress(
                    project_id,
                    clip_index=done,
                    clip_total=total,
                    message=f"Video {_index}/{total_videos}: Pi scored {done}/{total} clip(s)",
                )

            result, used_ai = enhance_clips_with_pi_cli(
                result,
                frame_scores,
                progress_callback=pi_progress,
                cache_dir=analysis_dir(project_id) / "ai-scores",
            )
            video_timing["ai_scoring_sec"] = round(time.monotonic() - phase_started, 2)
            video_metadata["used_ai"] = used_ai
            video_metadata["model_used"] = result.metadata.get("model_used")
            video_metadata["file_id"] = video["file_id"]
            if result.metadata.get("warning"):
                video_metadata["warning"] = result.metadata["warning"]
            if result.metadata.get("scoring_seconds_per_clip"):
                video_metadata["scoring_seconds_per_clip"] = result.metadata[
                    "scoring_seconds_per_clip"
                ]
        per_video_results.append(video_metadata)
        # Carry the source file's capture time and full duration onto each clip so
        # the UI can place clips on a per-file track and sort by true capture time.
        source_meta = video.get("metadata") or {}
        source_created_at = source_meta.get("created_at")
        source_duration_sec = source_meta.get("duration_sec")
        clips = []
        for clip in result.clips:
            clip_dict = clip.model_dump()
            clip_dict["source_created_at"] = source_created_at
            clip_dict["source_duration_sec"] = source_duration_sec
            clips.append(clip_dict)
        all_clips.extend(clips)
        video_timing["video_total_sec"] = round(time.monotonic() - video_started, 2)
        timings.append(video_timing)

    analyzed_file_ids = {video["file_id"] for video in videos_to_analyze}
    all_clips.extend(
        clip
        for clip in projects[project_id].get("clips", [])
        if clip.get("file_id") not in analyzed_file_ids
    )
    # Backfill source metadata on merged-in clips from earlier runs so the per-file
    # track and chronological sort behave consistently across the whole set.
    enrich_clips_with_source_metadata({"clips": all_clips, "videos": projects[project_id]["videos"]})
    ranked_clips = sorted(all_clips, key=lambda clip: clip["overall_score"], reverse=True)
    logger.info("Analyze complete: %d clip(s) across %d video(s)", len(ranked_clips), total_videos)
    existing_timeline = projects[project_id].get("timeline")
    existing_clips = projects[project_id].get("clips", [])
    if isinstance(existing_timeline, dict) and existing_timeline.get("source") == "manual":
        accepted_ids = {
            entry["clip_id"]
            for entry in existing_timeline.get("clips", [])
            if isinstance(entry, dict) and entry.get("clip_id")
        }
        new_ids = {clip["clip_id"] for clip in ranked_clips}
        ranked_clips.extend(
            clip for clip in existing_clips
            if clip.get("clip_id") in accepted_ids and clip.get("clip_id") not in new_ids
        )
        timeline = existing_timeline
    else:
        recommendation = recommend_assembly_profile(ranked_clips)
        timeline = build_draft_timeline(
            ranked_clips,
            profile=recommendation["profile"],
            target_duration_sec=recommendation["target_duration_sec"],
        )

    projects[project_id]["clips"] = ranked_clips
    projects[project_id]["timeline"] = timeline
    projects[project_id]["harness_id"] = request.harness_id
    invalidate_timeline_controller(project_id)
    persist_project_results(project_id)
    response = {
        "project_id": project_id,
        "harness_id": request.harness_id,
        "status": "complete",
        "clips": ranked_clips,
        "sequence": projects[project_id]["timeline"],
        "recommendation": recommend_assembly_profile(ranked_clips),
        "timings": {
            "per_video": timings,
            "pipeline_total_sec": round(time.monotonic() - pipeline_started, 2),
        },
    }
    logger.info(
        "Analyze timings: total %.1fs, per-video %s",
        response["timings"]["pipeline_total_sec"],
        timings,
    )
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
        "source": "manual",
        "clips": resolved_clips,
        "decisions": request.decisions,
        "profile": request.profile,
        "target_duration_sec": request.target_duration_sec,
        "total_duration_sec": total_duration_sec,
    }
    invalidate_timeline_controller(project_id)
    persist_project_results(project_id)
    return {
        "project_id": project_id,
        "clips": resolved_clips,
        "total_duration_sec": total_duration_sec,
    }


@app.post("/projects/{project_id}/draft")
async def regenerate_draft(project_id: str, request: DraftRequest):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    if not project.get("clips"):
        raise HTTPException(status_code=400, detail="No analyzed clips available")
    timeline = build_draft_timeline(
        project["clips"],
        profile=request.profile,
        target_duration_sec=request.target_duration_sec,
    )
    project["timeline"] = timeline
    invalidate_timeline_controller(project_id)
    persist_project_results(project_id)
    return {"project_id": project_id, "profile": request.profile, "timeline": timeline}


def enrich_clips_with_source_metadata(project: dict) -> list:
    """Backfill source_created_at / source_duration_sec onto clips in place.

    Clips analyzed before these fields existed — or merged back from an earlier
    partial-analysis run — lack them, which makes the per-file track render for
    only some cards. The values live on the source video's metadata, which is
    always available, so we fill any gaps from there.
    """
    videos_by_id = {video["file_id"]: video for video in project.get("videos", [])}
    clips = project.get("clips", [])
    for clip in clips:
        meta = (videos_by_id.get(clip.get("file_id")) or {}).get("metadata") or {}
        if clip.get("source_duration_sec") is None:
            clip["source_duration_sec"] = meta.get("duration_sec")
        if clip.get("source_created_at") is None:
            clip["source_created_at"] = meta.get("created_at")
    return clips


@app.get("/projects/{project_id}/clips")
async def get_clips(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"clips": enrich_clips_with_source_metadata(projects[project_id])}


@app.get("/projects/{project_id}/timeline")
async def get_timeline(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "project_id": project_id,
        "timeline": projects[project_id].get("timeline"),
    }


# --- Timeline Document: operations core over HTTP + SSE --------------------


class TimelineOpRequest(BaseModel):
    operation: str
    args: dict = {}
    expected_revision: Optional[int] = None


def build_timeline_sources(project: dict) -> dict[str, SourceClip]:
    """A candidate registry for the operations core: original bounds + the full
    source-video duration (used to clamp `set_bounds`/`set_speed` extensions)."""
    videos_by_id = {video["file_id"]: video for video in project.get("videos", [])}
    sources: dict[str, SourceClip] = {}
    for clip in project.get("clips", []):
        clip_id = clip.get("clip_id")
        if not clip_id:
            continue
        video = videos_by_id.get(clip.get("file_id"))
        duration = (video or {}).get("metadata", {}).get("duration_sec") if video else None
        if duration is None:
            duration = clip.get("end_sec", 0.0)
        sources[clip_id] = SourceClip(
            clip_id=clip_id,
            start_sec=float(clip.get("start_sec", 0.0)),
            end_sec=float(clip.get("end_sec", 0.0)),
            source_duration_sec=float(duration),
        )
    return sources


def _initial_timeline_document(project: dict, sources: dict[str, SourceClip]) -> TimelineDocument:
    folder = project.get("project_folder")
    legacy = project.get("timeline")
    if folder:
        document = load_timeline_document(Path(folder), legacy=legacy, sources=sources)
        if document is not None:
            return document
    if legacy is not None:
        return migrate_legacy_timeline(legacy, sources=sources)
    return TimelineDocument()


def _make_timeline_on_change(project_id: str):
    publish = _timeline_broker.publisher(project_id)

    async def on_change(document: TimelineDocument) -> None:
        project = projects.get(project_id)
        if project is not None:
            project["timeline_document"] = document.model_dump()
            folder = project.get("project_folder")
            if folder:
                try:
                    write_timeline_document(Path(folder), document)
                except OSError as exc:
                    logger.warning("Could not persist timeline document for %s: %s", project_id, exc)
        await publish(document)

    return on_change


def invalidate_timeline_controller(project_id: str) -> None:
    """Drop the cached controller so the next access rebuilds the document from
    a freshly written legacy timeline (analyze/draft/PUT). Keeps the
    backend-authoritative document in sync with those paths until the GUI drives
    everything through the operations core."""
    _timeline_controllers.pop(project_id, None)
    project = projects.get(project_id)
    if project is not None:
        project.pop("timeline_document", None)


def get_timeline_controller(project_id: str) -> TimelineController:
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = projects[project_id]
    sources = build_timeline_sources(project)
    controller = _timeline_controllers.get(project_id)
    if controller is None:
        controller = TimelineController(
            _initial_timeline_document(project, sources),
            sources,
            on_change=_make_timeline_on_change(project_id),
        )
        _timeline_controllers[project_id] = controller
    else:
        controller.update_sources(sources)
    return controller


def _timeline_snapshot(project_id: str, document: TimelineDocument) -> dict:
    candidates = get_mcp_server()._list_candidates(project_id)
    return {
        "project_id": project_id,
        "document": document.model_dump(),
        "sequence_fingerprint": sequence_fingerprint(document.items),
        "review_context_fingerprint": review_context_fingerprint(document, candidates),
    }


def _revision_conflict_detail(
    project_id: str, conflict: TimelineRevisionConflict, controller: TimelineController
) -> dict:
    return {
        "expected_revision": conflict.expected_revision,
        "current_revision": conflict.current_revision,
        "current_snapshot": _timeline_snapshot(project_id, controller.document),
    }


@app.get("/projects/{project_id}/timeline/document")
async def get_timeline_document(project_id: str):
    controller = get_timeline_controller(project_id)
    return _timeline_snapshot(project_id, controller.document)


@app.post("/projects/{project_id}/timeline/op")
async def apply_timeline_op(project_id: str, request: TimelineOpRequest):
    controller = get_timeline_controller(project_id)
    try:
        document = await controller.apply(
            request.operation,
            expected_revision=request.expected_revision,
            **request.args,
        )
    except TimelineRevisionConflict as exc:
        raise HTTPException(
            status_code=409,
            detail=_revision_conflict_detail(project_id, exc, controller),
        ) from exc
    except TimelineOpError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except TypeError as exc:  # bad/missing args for the operation
        raise HTTPException(status_code=422, detail=f"invalid arguments: {exc}") from exc
    return _timeline_snapshot(project_id, document)


@app.post("/projects/{project_id}/timeline/undo")
async def undo_timeline_op(project_id: str):
    controller = get_timeline_controller(project_id)
    document = await controller.undo()
    return _timeline_snapshot(project_id, document)


@app.post("/projects/{project_id}/timeline/redo")
async def redo_timeline_op(project_id: str):
    controller = get_timeline_controller(project_id)
    document = await controller.redo()
    return _timeline_snapshot(project_id, document)


@app.get("/projects/{project_id}/events")
async def timeline_events(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    queue = _timeline_broker.subscribe(project_id)

    async def event_stream():
        try:
            yield ": connected\n\n"
            while True:
                payload = await queue.get()
                yield f"event: {payload.get('type', 'message')}\ndata: {json.dumps(payload)}\n\n"
        finally:
            _timeline_broker.unsubscribe(project_id, queue)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# --- Embedded MCP server (external agents drive the same operations core) ---


def _mcp_get_controller(project_id: str) -> TimelineController:
    if project_id not in projects:
        raise KeyError(project_id)
    return get_timeline_controller(project_id)


def mcp_frame_paths(project_id: str, clip_id: str) -> list:
    """Local frame JPEG paths for a candidate clip, for an agent to read
    directly (the same `@path` images `pi_cli_harness` attaches)."""
    project = projects.get(project_id) or {}
    clip = next((c for c in project.get("clips", []) if c.get("clip_id") == clip_id), None)
    if clip is None:
        return []
    file_id = clip.get("file_id")
    base = samples_dir(project_id) / str(file_id)
    if not base.exists():
        return []
    start_ms = float(clip.get("start_sec", 0.0)) * 1000
    end_ms = float(clip.get("end_sec", 0.0)) * 1000
    paths = []
    for path in sorted(base.glob(f"{file_id}_*.jpg")):
        stem = path.stem
        if "raw" in stem:
            continue
        try:
            milliseconds = int(stem.rsplit("_", 1)[1])
        except (ValueError, IndexError):
            continue
        if start_ms <= milliseconds <= end_ms:
            paths.append(str(path))
    return paths


_mcp_server: Optional[TimelineMCPServer] = None


def get_mcp_server() -> TimelineMCPServer:
    global _mcp_server
    if _mcp_server is None:
        _mcp_server = TimelineMCPServer(
            get_controller=_mcp_get_controller,
            get_project=lambda project_id: projects[project_id],
            list_frame_paths=mcp_frame_paths,
        )
    return _mcp_server


@app.post("/mcp")
async def mcp_endpoint(request: Request):
    """JSON-RPC entry point for the embedded MCP server. External agents
    (Claude Code, Cursor) connect here; see docs/MCP_SERVER.md."""
    message = await request.json()
    response = await get_mcp_server().handle_jsonrpc(message)
    if response is None:
        return Response(status_code=202)
    return response


# --- In-app review agent (propose mode) ------------------------------------


class ReviewTurnRequest(BaseModel):
    message: str = ""
    client_message_id: Optional[uuid.UUID] = None


def _review_inputs(project_id: str) -> tuple[list, list, object]:
    candidates = get_mcp_server()._list_candidates(project_id)
    candidate_frames = []
    for candidate in candidates:
        paths = mcp_frame_paths(project_id, candidate.get("clip_id"))
        if not paths:
            continue
        for path in dict.fromkeys([paths[0], paths[len(paths) // 2], paths[-1]]):
            candidate_frames.append(
                {
                    "clip_id": candidate.get("clip_id"),
                    "file_name": candidate.get("file_name"),
                    "scene_id": candidate.get("scene_id"),
                    "start_sec": candidate.get("start_sec"),
                    "end_sec": candidate.get("end_sec"),
                    "frame_path": path,
                }
            )
            if len(candidate_frames) >= 12:
                break
        if len(candidate_frames) >= 12:
            break
    agent = _review_agent
    if projects[project_id].get("harness_id") != "pi_agent" and agent is default_review_agent:
        def manual_review_agent(_context):
            return {
                "message": "Manual analysis is ready. Creative versions remain deterministic and local.",
                "operations": [],
                "versions": [],
            }

        agent = manual_review_agent
    return candidates, candidate_frames, agent


async def _run_review_turn(
    project_id: str, user_message: str, client_message_id: Optional[str] = None
) -> dict:
    controller = get_timeline_controller(project_id)
    candidates, candidate_frames, agent = _review_inputs(project_id)
    return await run_review_turn(
        project_id,
        user_message=user_message,
        controller=controller,
        candidates=candidates,
        store=_proposal_store,
        agent=agent,
        candidate_frames=candidate_frames,
        client_message_id=client_message_id,
    )


@app.post("/projects/{project_id}/review/turn")
async def review_turn(project_id: str, request: ReviewTurnRequest):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Review message must not be blank")
    lock = _review_locks.setdefault(project_id, asyncio.Lock())
    async with lock:
        try:
            return await _run_review_turn(
                project_id,
                message,
                str(request.client_message_id) if request.client_message_id else None,
            )
        except ReviewAgentError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/projects/{project_id}/review/kickoff")
async def review_kickoff(project_id: str):
    """Proactive opening turn — auto-kicked when analysis completes (C.3) or
    triggered by the GUI when the Review route mounts."""
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    lock = _review_locks.setdefault(project_id, asyncio.Lock())
    async with lock:
        session = _proposal_store.session(project_id)
        if session.messages:
            last = session.messages[-1]
            return {
                "message": last.text,
                "proposal": last.proposal.model_dump() if last.proposal else None,
                "agent_message": last.model_dump(),
                "session": session.model_dump(),
            }
        controller = get_timeline_controller(project_id)
        candidates, candidate_frames, agent = _review_inputs(project_id)
        return await run_review_turn(
            project_id,
            user_message=(
                "Analysis just finished. Give a one-line opening take and propose your "
                "strongest first edits."
            ),
            controller=controller,
            candidates=candidates,
            store=_proposal_store,
            agent=agent,
            record_user_message=False,
            candidate_frames=candidate_frames,
        )


@app.get("/projects/{project_id}/review/session")
async def get_review_session(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return _proposal_store.session(project_id).model_dump()


@app.get("/projects/{project_id}/proposals")
async def list_proposals(project_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return {
        "project_id": project_id,
        "proposals": [p.model_dump() for p in _proposal_store.list_for_project(project_id)],
    }


@app.post("/projects/{project_id}/proposals/{proposal_id}/accept")
async def accept_proposal(project_id: str, proposal_id: str):
    controller = get_timeline_controller(project_id)
    try:
        document = await _proposal_store.accept(proposal_id, controller, project_id=project_id)
    except TimelineRevisionConflict as exc:
        raise HTTPException(
            status_code=409,
            detail=_revision_conflict_detail(project_id, exc, controller),
        ) from exc
    except ReviewAgentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _timeline_snapshot(project_id, document)


@app.post("/projects/{project_id}/proposals/{proposal_id}/reject")
async def reject_proposal(project_id: str, proposal_id: str):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        proposal = _proposal_store.reject(proposal_id, project_id=project_id)
    except ReviewAgentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"project_id": project_id, "proposal": proposal.model_dump()}


@app.post("/projects/{project_id}/export")
async def export_timeline(
    project_id: str,
    format: Literal["fcpxml", "edl", "resolve_xml"],
    overwrite: bool = False,
):
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    if not projects[project_id].get("clips"):
        raise HTTPException(status_code=400, detail="No clips available to export")

    export_dir = export_dir_for(project_id, format)
    export_dir.mkdir(parents=True, exist_ok=True)
    videos_by_id = {video["file_id"]: video for video in projects[project_id]["videos"]}
    # Prefer the backend-authoritative Timeline Document so Speed/Transform flow
    # into the export; fall back to the legacy timeline for un-edited projects.
    document = get_timeline_controller(project_id).document
    if document.items:
        clips = clips_from_timeline_document(projects[project_id], document)
    else:
        clips = clips_in_timeline_order(projects[project_id])

    if format == "edl":
        file_path = export_dir / "timeline.edl"
        ensure_export_can_write(file_path, overwrite)
        file_path.write_text(
            generate_edl("AI Clip Assembler", clips, fps=round_edl_fps(choose_timeline_fps(videos_by_id))),
            encoding="utf-8",
        )
    elif format == "fcpxml":
        file_path = export_dir / "timeline.fcpxml"
        ensure_export_can_write(file_path, overwrite)
        media_base_path = export_dir if projects[project_id].get("project_folder") else None
        file_path.write_text(
            generate_fcpxml(
                "AI Clip Assembler",
                clips,
                videos_by_id,
                media_base_path=media_base_path,
            ),
            encoding="utf-8",
        )
    else:
        file_path = export_dir / "timeline.xml"
        ensure_export_can_write(file_path, overwrite)
        media_base_path = export_dir if projects[project_id].get("project_folder") else None
        file_path.write_text(
            generate_resolve_xml(
                "AI Clip Assembler",
                clips,
                videos_by_id,
                media_base_path=media_base_path,
            ),
            encoding="utf-8",
        )

    return {
        "project_id": project_id,
        "format": format,
        "status": "generated",
        "file_path": str(file_path),
        "clip_count": len(clips),
        "total_duration_sec": round(sum(clip["duration_sec"] for clip in clips), 3),
        "warnings": edl_flatten_warnings(clips) if format == "edl" else [],
    }


class SettingsUpdateRequest(BaseModel):
    pi_provider: Optional[str] = None
    pi_model: Optional[str] = None
    pi_timeout_sec: Optional[float] = None


def _settings_payload() -> dict:
    """Current settings plus the list of keys the UI may edit."""
    settings = get_settings()
    return {"settings": settings, "editable": list(EDITABLE_KEYS)}


@app.get("/settings")
async def read_settings():
    return _settings_payload()


@app.put("/settings")
async def write_settings(request: SettingsUpdateRequest):
    changes = request.model_dump(exclude_none=True)
    if not changes:
        return _settings_payload()
    try:
        update_settings(changes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _settings_payload()


# Diagnostic ping is intentionally short so the UI gets a quick verdict; a slow
# model is itself a signal worth surfacing rather than blocking on the full
# per-call timeout.
_DIAGNOSTIC_TIMEOUT_SEC = 45.0


def _ping_review_model(settings: dict) -> dict:
    """Run a trivial pi turn to confirm the review model is reachable.

    Mirrors how the review agent invokes pi (same provider/model/cwd/env) but
    with no frames and a tiny prompt, so it isolates binary/auth/model
    reachability from project-specific failures.
    """
    pi_bin = settings["pi_bin"]
    resolved = shutil.which(pi_bin)
    binary = {"configured": pi_bin, "resolved": resolved, "found": resolved is not None}
    result = {
        "binary": binary,
        "provider": settings["pi_provider"],
        "model": settings["pi_model"],
        "reachable": False,
        "elapsed_sec": None,
        "detail": "",
    }
    if resolved is None:
        result["detail"] = f"pi CLI not found on PATH ({pi_bin})"
        return result

    command = [
        pi_bin, "--provider", settings["pi_provider"], "--model", settings["pi_model"],
        "--print", "--mode", "text", "--no-session", "--no-context-files",
        "--no-skills", "--no-extensions",
        "Reply with the single word OK.",
    ]
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command, capture_output=True, stdin=subprocess.DEVNULL, text=True,
            timeout=_DIAGNOSTIC_TIMEOUT_SEC, cwd=str(REPO_ROOT), env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired:
        result["elapsed_sec"] = round(time.monotonic() - started, 1)
        result["detail"] = f"No response within {_DIAGNOSTIC_TIMEOUT_SEC:.0f}s"
        return result
    except OSError as exc:
        result["elapsed_sec"] = round(time.monotonic() - started, 1)
        result["detail"] = str(exc)
        return result

    result["elapsed_sec"] = round(time.monotonic() - started, 1)
    stdout = (completed.stdout or "").strip()
    if completed.returncode == 0 and stdout:
        result["reachable"] = True
        result["detail"] = stdout[:200]
    else:
        result["detail"] = (
            (completed.stderr or completed.stdout or "pi CLI returned no output").strip()[:500]
        )
    return result


@app.get("/diagnostics")
async def diagnostics():
    settings = get_settings()
    review_model = await asyncio.to_thread(_ping_review_model, settings)
    return {"review_model": review_model}


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


def videos_from_manifest(folder_path: Path, manifest) -> list[dict]:
    videos = []
    for source_video in manifest.source_videos:
        video_path = folder_path / source_video.filename
        try:
            metadata = probe_video(video_path)
            metadata.file_id = source_video.filename
            metadata.file_name = source_video.filename
            metadata.file_path = str(video_path)
            metadata_dump = metadata.model_dump()
        except (FFprobeUnavailableError, FFprobeError, OSError):
            # None, not {}: an empty dict is truthy in the frontend's
            # `metadata?: VideoMetadata` check and crashes the source table.
            metadata_dump = None
        videos.append(
            {
                "file_id": source_video.filename,
                "file_name": source_video.filename,
                "file_path": str(video_path),
                "status": "ready",
                "metadata": metadata_dump,
            }
        )
    return videos


def registered_video(project_id: str, file_id: str) -> dict:
    if project_id not in projects:
        raise HTTPException(status_code=404, detail="Project not found")
    for video in projects[project_id].get("videos", []):
        if video.get("file_id") == file_id:
            return video
    raise HTTPException(status_code=404, detail="Video not found")


def media_type_for_video(video_path: Path) -> str:
    suffix = video_path.suffix.lower()
    if suffix == ".mov":
        return "video/quicktime"
    if suffix == ".mkv":
        return "video/x-matroska"
    return "video/mp4"


def ranged_video_response(
    video_path: Path,
    range_header: str,
    *,
    media_type: str,
) -> Response:
    file_size = video_path.stat().st_size
    byte_range = parse_byte_range(range_header, file_size)
    if byte_range is None:
        return Response(
            status_code=416,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Range": f"bytes */{file_size}",
            },
        )

    start, end = byte_range
    length = end - start + 1

    return StreamingResponse(
        iter_file_range(video_path, start, end),
        status_code=206,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
        },
    )


def iter_file_range(video_path: Path, start: int, end: int):
    with video_path.open("rb") as video_file:
        video_file.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk_size = min(VIDEO_STREAM_CHUNK_SIZE, remaining)
            chunk = video_file.read(chunk_size)
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def parse_byte_range(range_header: str, file_size: int) -> Optional[tuple[int, int]]:
    if file_size <= 0 or not range_header.startswith("bytes="):
        return None

    range_value = range_header.removeprefix("bytes=").strip()
    if "," in range_value or "-" not in range_value:
        return None

    start_text, end_text = range_value.split("-", 1)
    try:
        if start_text == "":
            suffix_length = int(end_text)
            if suffix_length <= 0:
                return None
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
    except ValueError:
        return None

    if start < 0 or end < start or start >= file_size:
        return None
    return start, min(end, file_size - 1)


def ensure_export_can_write(file_path: Path, overwrite: bool) -> None:
    if file_path.exists() and not overwrite:
        raise HTTPException(
            status_code=409,
            detail=f"Export already exists: {file_path}",
        )


def persist_project_results(project_id: str) -> None:
    """Write clips + timeline to <project>/clipassembler/analysis/results.json
    so re-opening a folder project restores the Review Board. No-op for
    legacy upload projects, which have no folder to persist into."""
    project = projects.get(project_id)
    if not project or not project.get("project_folder"):
        return
    try:
        write_analysis_results(
            Path(project["project_folder"]),
            harness_id=project.get("harness_id") or "manual",
            clips=project.get("clips", []),
            timeline=project.get("timeline"),
        )
    except OSError as exc:
        logger.warning("Could not persist analysis results for %s: %s", project_id, exc)


def project_work_dir(project_id: str) -> Path:
    project = projects.get(project_id)
    if project and project.get("project_folder"):
        return project_state_dir(Path(project["project_folder"]))
    return project_dir(project_id)


def samples_dir(project_id: str) -> Path:
    project = projects.get(project_id)
    if project and project.get("project_folder"):
        return project_work_dir(project_id) / "samples"
    return project_work_dir(project_id) / "frames"


def analysis_dir(project_id: str) -> Path:
    project = projects.get(project_id)
    if project and project.get("project_folder"):
        return project_work_dir(project_id) / "analysis"
    return project_work_dir(project_id)


def export_dir_for(project_id: str, format: str) -> Path:
    project = projects.get(project_id)
    if project and project.get("project_folder"):
        folder_name = {
            "fcpxml": "fcp",
            "edl": "edl",
            "resolve_xml": "davinci",
        }[format]
        return Path(project["project_folder"]) / "exports" / folder_name
    return project_dir(project_id) / "exports"


def clips_from_timeline_document(project: dict, document: TimelineDocument) -> list:
    """Resolve Timeline Document items into export-ready clip dicts.

    Each item joins its source Candidate Clip's metadata (file, name, scores)
    with the item's own bounds, Speed (`suggested_speed`), and Transform — the
    fields `export_engine` reads.
    """
    clips_by_id = {clip["clip_id"]: clip for clip in project.get("clips", [])}
    resolved = []
    for item in document.items:
        base = clips_by_id.get(item.source_clip_id)
        if base is None:
            continue
        resolved.append(
            {
                **base,
                "start_sec": item.start_sec,
                "end_sec": item.end_sec,
                "duration_sec": round(item.end_sec - item.start_sec, 3),
                "suggested_speed": item.speed,
                "transform": item.transform.model_dump(),
            }
        )
    return resolved


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
        max_clip_duration_sec=float(preferences.get("max_clip_duration_sec", 10.0)),
        smoothness_threshold=float(preferences.get("smoothness_threshold", 7.0)),
        target_duration_sec=float(preferences.get("target_duration_sec", 120.0)),
        max_turn_rate_deg_per_sec=float(preferences.get("max_turn_rate_deg_per_sec", 12.0)),
        max_clips_per_scene=int(preferences.get("max_clips_per_scene", 2)),
        max_candidates_per_video=int(preferences.get("max_candidates_per_video", 12)),
    )


def sample_fps_from_request(preferences: dict) -> float:
    sample_fps = float(preferences.get("sample_fps", 1.0))
    if sample_fps <= 0:
        raise HTTPException(status_code=422, detail="sample_fps must be greater than 0")
    return sample_fps


def score_samples_rule_based(samples: list, transforms=None) -> list:
    frame_samples = [
        sample if isinstance(sample, FrameSample) else FrameSample.model_validate(sample)
        for sample in samples
    ]
    return score_samples_from_images(frame_samples, transforms=transforms)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
