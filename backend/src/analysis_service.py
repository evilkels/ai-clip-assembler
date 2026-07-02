import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .assembly_profiles import build_draft_timeline, recommend_assembly_profile
from .clip_assembly import AssemblyPreferences, assemble_smooth_clips
from .frame_extraction import FFmpegError, FFmpegUnavailableError, extract_frames
from .models import FrameSample
from .motion_analysis import (
    FFmpegVidstabError,
    FFmpegVidstabUnavailableError,
    parse_trf,
    run_vidstabdetect,
)
from .pi_cli_harness import enhance_clips_with_pi_cli
from .quality_scoring import score_samples_from_images
from .scene_detection import assign_scene_ids, detect_scenes

logger = logging.getLogger("uvicorn.error")


class AnalysisDependencyUnavailableError(RuntimeError):
    """A tool the early pipeline stages depend on (FFmpeg/vidstab) is unavailable."""


class AnalysisInputError(RuntimeError):
    """FFmpeg rejected the Source Video during the early pipeline stages."""


@dataclass
class AnalysisPipelineResult:
    per_file_results: list[dict]
    per_file_frames: dict
    per_video_metadata: list[dict]
    timings: list[dict]
    pipeline_total_sec: float


def selected_videos(project: dict, request: Any) -> list[dict]:
    """Source Videos to analyze: the requested subset, or all when unfiltered."""
    videos = project["videos"]
    if request.file_ids is None:
        return list(videos)
    wanted = set(request.file_ids)
    return [video for video in videos if video["file_id"] in wanted]


def run_analysis_pipeline(
    project: dict,
    request: Any,
    *,
    project_id: str,
    analysis_path: Path,
    samples_path: Path,
    preferences: AssemblyPreferences,
    sample_fps: float,
    cancellable_runner: Callable,
    check_cancelled: Callable[[], None],
    set_progress: Callable[..., None],
    run_vidstabdetect_fn: Callable = run_vidstabdetect,
    extract_frames_fn: Callable = extract_frames,
    detect_scenes_fn: Callable = detect_scenes,
    assign_scene_ids_fn: Callable = assign_scene_ids,
    score_samples_fn: Callable = None,
    assemble_clips_fn: Callable = assemble_smooth_clips,
    enhance_clips_fn: Callable = enhance_clips_with_pi_cli,
    parse_transforms_fn: Callable = parse_trf,
) -> AnalysisPipelineResult:
    pipeline_started = time.monotonic()
    per_video_results = []
    per_file_results = []
    timings = []
    per_file_frames = {}
    score_samples = score_samples_fn or score_samples_rule_based
    videos_to_analyze = selected_videos(project, request)
    total_videos = len(videos_to_analyze)
    for index, video in enumerate(videos_to_analyze, start=1):
        check_cancelled()
        video_started = time.monotonic()
        video_timing = {"file_name": video["file_name"]}
        set_progress(
            video_index=index,
            file_name=video["file_name"],
            clip_index=0,
            clip_total=0,
            message=f"Preparing video {index}/{total_videos}: {video['file_name']}",
        )
        # Only the FFmpeg-driven stages (motion, frames, scenes) map to typed
        # analysis errors; failures in later stages propagate untranslated.
        try:
            logger.info(
                "Analyze %d/%d %s: motion analysis (vidstabdetect)",
                index,
                total_videos,
                video["file_name"],
            )
            set_progress(
                step="motion_analysis",
                message=(
                    f"Video {index}/{total_videos}: running FFmpeg motion analysis "
                    "(this can take a while on long clips)"
                ),
            )
            phase_started = time.monotonic()
            transforms_path = analysis_path / "motion" / f"{video['file_id']}.trf"
            run_vidstabdetect_fn(
                input_path=Path(video["file_path"]),
                transforms_path=transforms_path,
                runner=cancellable_runner,
            )
            video_timing["motion_analysis_sec"] = round(time.monotonic() - phase_started, 2)
            logger.info(
                "Analyze %d/%d %s: extracting frame samples",
                index,
                total_videos,
                video["file_name"],
            )
            set_progress(
                step="frame_extraction",
                message=f"Video {index}/{total_videos}: extracting frame samples",
            )
            phase_started = time.monotonic()
            samples = extract_frames_fn(
                input_path=Path(video["file_path"]),
                frames_dir=samples_path / video["file_id"],
                file_id=video["file_id"],
                sample_fps=sample_fps,
                max_width=int(request.preferences.get("max_width", 960)),
                runner=cancellable_runner,
            )
            video_timing["frame_extraction_sec"] = round(time.monotonic() - phase_started, 2)
            logger.info(
                "Analyze %d/%d %s: detecting scenes",
                index,
                total_videos,
                video["file_name"],
            )
            set_progress(
                step="scene_detection",
                message=f"Video {index}/{total_videos}: detecting scene boundaries",
            )
            phase_started = time.monotonic()
            scenes = detect_scenes_fn(Path(video["file_path"]))
            samples = assign_scene_ids_fn(samples, scenes)
            video_timing["scene_detection_sec"] = round(time.monotonic() - phase_started, 2)
        except (FFmpegVidstabUnavailableError, FFmpegUnavailableError) as exc:
            raise AnalysisDependencyUnavailableError(str(exc)) from exc
        except (FFmpegVidstabError, FFmpegError) as exc:
            raise AnalysisInputError(str(exc)) from exc

        phase_started = time.monotonic()
        if transforms_path.exists():
            fps = float((video.get("metadata") or {}).get("fps") or 30.0)
            frame_scores = score_samples(samples, parse_transforms_fn(transforms_path, fps=fps))
        else:
            frame_scores = score_samples(samples)
        scene_bounds = {scene.scene_id: (scene.start_sec, scene.end_sec) for scene in scenes}
        source_duration_sec = float(
            (video.get("metadata") or {}).get("duration_sec") or 0.0
        ) or None
        result = assemble_clips_fn(
            file_id=video["file_id"],
            file_name=video["file_name"],
            frames=frame_scores,
            preferences=preferences,
            scene_bounds=scene_bounds,
            source_duration_sec=source_duration_sec,
        )
        per_file_frames[video["file_id"]] = {
            "frames": [frame.model_dump() for frame in frame_scores],
            "scene_bounds": {
                str(scene_id): [start, end]
                for scene_id, (start, end) in scene_bounds.items()
            },
            "source_duration_sec": source_duration_sec,
            "fps": float((video.get("metadata") or {}).get("fps") or 30.0),
        }
        video_timing["assembly_sec"] = round(time.monotonic() - phase_started, 2)
        video_timing["ai_scoring_sec"] = 0.0
        logger.info(
            "Analyze %d/%d %s: %d candidate clip(s) assembled",
            index,
            total_videos,
            video["file_name"],
            len(result.clips),
        )
        video_metadata = {}
        if request.harness_id == "pi_agent":
            logger.info(
                "Analyze %d/%d %s: scoring %d clip(s) with pi - one CLI call per clip, can take minutes",
                index,
                total_videos,
                video["file_name"],
                len(result.clips),
            )
            set_progress(
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
                check_cancelled()
                set_progress(
                    clip_index=done,
                    clip_total=total,
                    message=f"Video {_index}/{total_videos}: Pi scored {done}/{total} clip(s)",
                )

            result, used_ai = enhance_clips_fn(
                result,
                frame_scores,
                progress_callback=pi_progress,
                cache_dir=analysis_path / "ai-scores",
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
        source_meta = video.get("metadata") or {}
        source_created_at = source_meta.get("created_at")
        source_duration_sec = source_meta.get("duration_sec")
        clips = []
        for clip in result.clips:
            clip_dict = clip.model_dump()
            clip_dict["source_created_at"] = source_created_at
            clip_dict["source_duration_sec"] = source_duration_sec
            clips.append(clip_dict)
        per_file_results.append({"file_id": video["file_id"], "clips": clips, "result": result})
        video_timing["video_total_sec"] = round(time.monotonic() - video_started, 2)
        timings.append(video_timing)

    return AnalysisPipelineResult(
        per_file_results=per_file_results,
        per_file_frames=per_file_frames,
        per_video_metadata=per_video_results,
        timings=timings,
        pipeline_total_sec=round(time.monotonic() - pipeline_started, 2),
    )


def aggregate_generation_stats(per_file_results: list[dict]) -> dict:
    per_file = {}
    totals = {
        "candidates_generated": 0,
        "candidates_kept": 0,
        "scenes_total": 0,
        "scenes_at_cap": 0,
    }
    effective_preferences = None
    max_candidates_per_video = None
    for result in per_file_results:
        stats = (result.get("result").metadata or {}).get("generation_stats", {})
        file_stats = {
            "candidates_generated": int(stats.get("candidates_generated", 0)),
            "candidates_kept": int(stats.get("candidates_kept", 0)),
            "scenes_total": int(stats.get("scenes_total", 0)),
            "scenes_at_cap": int(stats.get("scenes_at_cap", 0)),
            "preferences": stats.get("preferences") or {},
        }
        per_file[result["file_id"]] = file_stats
        for key in totals:
            totals[key] += file_stats[key]
        if effective_preferences is None:
            effective_preferences = file_stats["preferences"]
            max_candidates_per_video = effective_preferences.get("max_candidates_per_video")
    return {
        "per_file": per_file,
        "totals": {
            **totals,
            "videos": len(per_file_results),
            "max_candidates_per_video": max_candidates_per_video,
        },
        "preferences": effective_preferences or {},
    }


def finalize_clip_set(
    project: dict,
    per_file_results: list[dict],
    *,
    preserve_manual_timeline: bool,
    enrich_clips: Callable[[dict], list],
) -> dict:
    analyzed_file_ids = {result["file_id"] for result in per_file_results}
    all_clips = [clip for result in per_file_results for clip in result["clips"]]
    all_clips.extend(
        clip
        for clip in project.get("clips", [])
        if clip.get("file_id") not in analyzed_file_ids
    )
    enrich_clips({"clips": all_clips, "videos": project["videos"]})
    ranked_clips = sorted(all_clips, key=lambda clip: clip["overall_score"], reverse=True)
    existing_timeline = project.get("timeline")
    existing_clips = project.get("clips", [])
    if (
        preserve_manual_timeline
        and isinstance(existing_timeline, dict)
        and existing_timeline.get("source") == "manual"
    ):
        accepted_ids = {
            entry["clip_id"]
            for entry in existing_timeline.get("clips", [])
            if isinstance(entry, dict) and entry.get("clip_id")
        }
        new_ids = {clip["clip_id"] for clip in ranked_clips}
        ranked_clips.extend(
            clip
            for clip in existing_clips
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

    recommendation = recommend_assembly_profile(ranked_clips)
    return {
        "clips": ranked_clips,
        "timeline": timeline,
        "recommendation": recommendation,
        "generation_stats": aggregate_generation_stats(per_file_results),
    }


def score_samples_rule_based(samples: list, transforms=None) -> list:
    frame_samples = [
        sample if isinstance(sample, FrameSample) else FrameSample.model_validate(sample)
        for sample in samples
    ]
    return score_samples_from_images(frame_samples, transforms=transforms)
