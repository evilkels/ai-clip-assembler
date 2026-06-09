"""
AI Clip Assembler - FastAPI Backend

Provides REST endpoints for local video ingestion, smooth drone clip analysis,
timeline assembly, and editor export files.
"""

import logging
import shutil
import time
import uuid
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

# Load repo-root .env before harness imports: PI_*/OLLAMA_* are read at import time.
load_dotenv()

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
from .project_store import (
    InvalidProjectManifestError,
    NoSourceVideosFoundError,
    ProjectFolderNotWritableError,
    ProjectNotFoundError,
    ProjectStoreError,
    UnsafeProjectFolderError,
    create_or_open_project as create_or_open_folder_project,
    delete_project_files,
    project_state_dir,
    rescan_project,
)
from .quality_scoring import score_samples_from_images
from .scene_detection import SceneBoundary, assign_scene_ids, detect_scenes
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
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

projects = {}
PROJECTS_DIR = Path(".ai-clip-assembler/projects")
VIDEO_STREAM_CHUNK_SIZE = 1024 * 1024


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
    projects[project_id] = {
        "project_id": project_id,
        "project_folder": str(folder_path),
        "project": manifest.model_dump(),
        "videos": videos,
        "clips": [],
        "timeline": None,
    }
    return {
        "project_id": project_id,
        "project_folder": str(folder_path),
        "project": manifest.model_dump(),
        "videos": videos,
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
    project["clips"] = []
    project["timeline"] = None
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
            file_name=video["file_name"],
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

    projects[project_id]["analysis_progress"] = {}
    set_analysis_progress(
        project_id,
        phase="analyzing",
        harness_id=request.harness_id,
        step="starting",
        video_index=0,
        video_total=len(projects[project_id]["videos"]),
        file_name=None,
        clip_index=0,
        clip_total=0,
        message="Preparing analysis",
        error=None,
    )
    try:
        response = run_analysis_pipeline(project_id, request)
    except HTTPException as exc:
        set_analysis_progress(project_id, phase="error", error=str(exc.detail))
        raise
    except Exception as exc:
        set_analysis_progress(project_id, phase="error", error=str(exc))
        raise
    set_analysis_progress(
        project_id,
        phase="complete",
        step="complete",
        message="Analysis complete",
    )
    return response


def run_analysis_pipeline(project_id: str, request: AnalysisRequest) -> dict:
    all_clips = []
    per_video_results = []
    preferences = preferences_from_request(request.preferences)
    sample_fps = sample_fps_from_request(request.preferences)
    total_videos = len(projects[project_id]["videos"])
    for index, video in enumerate(projects[project_id]["videos"], start=1):
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
            run_vidstabdetect(
                input_path=Path(video["file_path"]),
                transforms_path=analysis_dir(project_id) / "motion" / f"{video['file_id']}.trf",
            )
            logger.info(
                "Analyze %d/%d %s: extracting frame samples",
                index, total_videos, video["file_name"],
            )
            set_analysis_progress(
                project_id,
                step="frame_extraction",
                message=f"Video {index}/{total_videos}: extracting frame samples",
            )
            samples = extract_frames(
                input_path=Path(video["file_path"]),
                frames_dir=samples_dir(project_id) / video["file_id"],
                file_id=video["file_id"],
                sample_fps=sample_fps,
                max_width=int(request.preferences.get("max_width", 960)),
            )
            logger.info(
                "Analyze %d/%d %s: detecting scenes",
                index, total_videos, video["file_name"],
            )
            set_analysis_progress(
                project_id,
                step="scene_detection",
                message=f"Video {index}/{total_videos}: detecting scene boundaries",
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
            result, used_ai = enhance_clips_with_pi_cli(
                result,
                frame_scores,
                progress_callback=lambda done, total: set_analysis_progress(
                    project_id,
                    clip_index=done,
                    clip_total=total,
                    message=f"Video {index}/{total_videos}: Pi scored {done}/{total} clip(s)",
                ),
                cache_dir=analysis_dir(project_id) / "ai-scores",
            )
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
        clips = [clip.model_dump() for clip in result.clips]
        all_clips.extend(clips)

    ranked_clips = sorted(all_clips, key=lambda clip: clip["overall_score"], reverse=True)
    logger.info("Analyze complete: %d clip(s) across %d video(s)", len(ranked_clips), total_videos)
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


def videos_from_manifest(folder_path: Path, manifest) -> list[dict]:
    return [
        {
            "file_id": source_video.filename,
            "file_name": source_video.filename,
            "file_path": str(folder_path / source_video.filename),
            "status": "ready",
            # None, not {}: an empty dict is truthy in the frontend's
            # `metadata?: VideoMetadata` check and crashes the source table.
            "metadata": None,
        }
        for source_video in manifest.source_videos
    ]


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
    file_name: str,
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
            "Content-Disposition": f'inline; filename="{file_name}"',
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
