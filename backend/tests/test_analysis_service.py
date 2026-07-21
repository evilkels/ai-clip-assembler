from pathlib import Path
from types import SimpleNamespace

import pytest

from src import analysis_service
from src.clip_assembly import AssemblyPreferences
from src.embeddings import FakeEmbeddingProvider
from src.frame_extraction import FFmpegError, FFmpegUnavailableError
from src.models import AssemblyResult, ClipSuggestion, FrameSample, FrameScore, TimelineSequence
from src.motion_analysis import FFmpegVidstabUnavailableError


def _source_video(tmp_path: Path, *, file_id: str = "file-1") -> dict:
    video_path = tmp_path / f"{file_id}.MP4"
    video_path.write_bytes(b"video")
    return {
        "file_id": file_id,
        "file_name": video_path.name,
        "file_path": str(video_path),
        "status": "ready",
        "metadata": {
            "duration_sec": 90.0,
            "fps": 30.0,
            "created_at": "2026-06-01T12:00:00",
        },
    }


def _request(**overrides):
    values = {
        "project_id": "project-1",
        "harness_id": "manual",
        "preferences": {},
        "file_ids": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _clip(clip_id: str, start: float, end: float, score: float) -> ClipSuggestion:
    return ClipSuggestion(
        clip_id=clip_id,
        file_id="file-1",
        file_name="file-1.MP4",
        scene_id=1,
        start_sec=start,
        end_sec=end,
        duration_sec=end - start,
        smoothness_score=score,
        sharpness_score=8.0,
        exposure_score=8.0,
        contrast_score=8.0,
        max_turn_rate_deg_per_sec=2.0,
        visual_interest_score=0.0,
        overall_score=score,
        ai_reason=f"Stable {score}/10",
    )


def _frame(timestamp: float, smoothness: float = 8.0) -> FrameScore:
    return FrameScore(
        timestamp=timestamp,
        frame_path=f"/tmp/{timestamp}.jpg",
        motion_stability=smoothness,
        smoothness_score=smoothness,
        sharpness_score=8.0,
        exposure_score=8.0,
        contrast_score=8.0,
        visual_interest_score=0.0,
        overall_score=smoothness,
        blur_score=8.0,
        brightness=0.8,
        contrast=0.8,
        scene_id=1,
        is_keyframe=True,
        turn_rate_deg_per_sec=2.0,
    )


def _run_service(project, request, tmp_path, **overrides):
    dependencies = {
        "run_vidstabdetect_fn": lambda **_kwargs: None,
        "extract_frames_fn": lambda **_kwargs: [
            FrameSample(timestamp=0.0, frame_path="/tmp/frame.jpg")
        ],
        "detect_scenes_fn": lambda _path: [],
        "assign_scene_ids_fn": lambda samples, _scenes: samples,
        "score_samples_fn": lambda _samples: [],
        "assemble_clips_fn": lambda **_kwargs: AssemblyResult(
            clips=[],
            sequence=TimelineSequence(total_duration_sec=0.0, clips=[]),
            metadata={},
        ),
    }
    dependencies.update(overrides)
    return analysis_service.run_analysis_pipeline(
        project,
        request,
        project_id=request.project_id,
        analysis_path=tmp_path / "analysis",
        samples_path=tmp_path / "samples",
        preferences=AssemblyPreferences(),
        sample_fps=1.0,
        cancellable_runner=lambda *_args, **_kwargs: None,
        check_cancelled=lambda: None,
        set_progress=lambda **_fields: None,
        **dependencies,
    )


def test_run_analysis_pipeline_returns_per_file_outputs(tmp_path):
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }

    result = _run_service(
        project,
        _request(),
        tmp_path,
        assemble_clips_fn=lambda **_kwargs: AssemblyResult(
            clips=[
                _clip("clip-a", 0.0, 22.0, 8.5),
                _clip("clip-b", 30.0, 52.0, 9.0),
                _clip("clip-c", 60.0, 82.0, 7.5),
            ],
            sequence=TimelineSequence(total_duration_sec=66.0, clips=["clip-a", "clip-b", "clip-c"]),
            metadata={
                "generation_stats": {
                    "candidates_generated": 3,
                    "candidates_kept": 3,
                    "scenes_total": 1,
                    "scenes_at_cap": 0,
                    "preferences": {"max_candidates_per_video": 30},
                }
            },
        ),
    )
    finalized = analysis_service.finalize_clip_set(
        project,
        result.per_file_results,
        preserve_manual_timeline=True,
        enrich_clips=lambda data: data["clips"],
    )

    assert len(result.per_file_results[0]["clips"]) == 3
    assert result.per_file_frames["file-1"]["source_duration_sec"] == 90.0
    assert result.timings[0]["file_name"] == "file-1.MP4"
    assert finalized["timeline"]["source"] == "draft"
    assert finalized["recommendation"]["profile"] == "long_scenic"
    assert finalized["generation_stats"]["totals"]["candidates_kept"] == 3


def test_finalize_clip_set_carries_generation_stats_for_unanalyzed_files(tmp_path):
    old_file_stats = {
        "candidates_generated": 5,
        "candidates_kept": 4,
        "scenes_total": 2,
        "scenes_at_cap": 1,
        "preferences": {},
    }
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path), _source_video(tmp_path, file_id="file-2")],
        "clips": [
            {
                "clip_id": "clip-old",
                "file_id": "file-2",
                "scene_id": 1,
                "start_sec": 0.0,
                "end_sec": 10.0,
                "duration_sec": 10.0,
                "smoothness_score": 7.0,
                "overall_score": 7.0,
            }
        ],
        "timeline": None,
        "generation_stats": {
            "per_file": {
                "file-1": {**old_file_stats, "candidates_kept": 9},
                "file-2": old_file_stats,
                "file-removed": old_file_stats,
            },
            "totals": {},
            "preferences": {},
        },
    }
    per_file_results = [
        {
            "file_id": "file-1",
            "clips": [_clip("clip-a", 0.0, 10.0, 8.0).model_dump()],
            "result": SimpleNamespace(
                metadata={
                    "generation_stats": {
                        "candidates_generated": 3,
                        "candidates_kept": 3,
                        "scenes_total": 1,
                        "scenes_at_cap": 0,
                        "preferences": {"max_candidates_per_video": 30},
                    }
                }
            ),
        }
    ]

    finalized = analysis_service.finalize_clip_set(
        project,
        per_file_results,
        preserve_manual_timeline=True,
        enrich_clips=lambda data: data["clips"],
    )

    stats = finalized["generation_stats"]
    # file-1 reflects the fresh run, file-2 is carried, file-removed is dropped.
    assert set(stats["per_file"]) == {"file-1", "file-2"}
    assert stats["per_file"]["file-1"]["candidates_kept"] == 3
    assert stats["per_file"]["file-2"] == old_file_stats
    assert stats["totals"]["candidates_kept"] == 7
    assert stats["totals"]["videos"] == 2
    assert stats["totals"]["max_candidates_per_video"] == 30


def test_run_analysis_pipeline_handles_empty_video_list(tmp_path):
    result = _run_service(
        {"project_id": "project-1", "videos": [], "clips": [], "timeline": None},
        _request(),
        tmp_path,
    )

    assert result.per_file_results == []
    assert result.per_file_frames == {}
    assert result.timings == []


def test_run_analysis_pipeline_uses_fallback_when_all_frames_are_below_threshold(tmp_path):
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }
    low_frames = [_frame(second, smoothness=4.0) for second in range(5)]

    result = _run_service(
        project,
        _request(),
        tmp_path,
        score_samples_fn=lambda _samples: low_frames,
        assemble_clips_fn=analysis_service.assemble_smooth_clips,
    )
    finalized = analysis_service.finalize_clip_set(
        project,
        result.per_file_results,
        preserve_manual_timeline=True,
        enrich_clips=lambda data: data["clips"],
    )

    assert len(result.per_file_results[0]["clips"]) == 1
    assert result.per_file_results[0]["clips"][0]["tags"] == ["drone", "fallback"]
    assert len(finalized["timeline"]["clips"]) == 1
    assert finalized["recommendation"]["profile"] == "short_social"


def test_run_analysis_pipeline_propagates_cancellation(tmp_path):
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }

    class Cancelled(Exception):
        pass

    with pytest.raises(Cancelled):
        analysis_service.run_analysis_pipeline(
            project,
            _request(),
            project_id="project-1",
            analysis_path=tmp_path / "analysis",
            samples_path=tmp_path / "samples",
            preferences=AssemblyPreferences(),
            sample_fps=1.0,
            cancellable_runner=lambda *_args, **_kwargs: None,
            check_cancelled=lambda: (_ for _ in ()).throw(Cancelled()),
            set_progress=lambda **_fields: None,
        )


def test_early_stage_ffmpeg_errors_map_to_typed_analysis_errors(tmp_path):
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }

    def raise_ffmpeg(**_kwargs):
        raise FFmpegError("bad media")

    with pytest.raises(analysis_service.AnalysisInputError):
        _run_service(project, _request(), tmp_path, extract_frames_fn=raise_ffmpeg)

    def raise_ffmpeg_unavailable(**_kwargs):
        raise FFmpegUnavailableError("ffmpeg missing")

    with pytest.raises(analysis_service.AnalysisDependencyUnavailableError):
        _run_service(project, _request(), tmp_path, extract_frames_fn=raise_ffmpeg_unavailable)


def test_vidstab_unavailable_skips_motion_analysis_and_records_notice(tmp_path):
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }
    scored_samples = []
    stale_transform = tmp_path / "analysis" / "motion" / "file-1.trf"
    stale_transform.parent.mkdir(parents=True)
    stale_transform.write_text("stale", encoding="utf-8")

    def score_without_transforms(samples):
        scored_samples.extend(samples)
        return [_frame(0.0, smoothness=8.0)]

    def raise_vidstab_unavailable(**_kwargs):
        raise FFmpegVidstabUnavailableError("ffmpeg lacks vidstabdetect")

    result = _run_service(
        project,
        _request(),
        tmp_path,
        run_vidstabdetect_fn=raise_vidstab_unavailable,
        parse_transforms_fn=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("stale transform used")
        ),
        score_samples_fn=score_without_transforms,
        assemble_clips_fn=lambda **_kwargs: AssemblyResult(
            clips=[_clip("clip-a", 0.0, 10.0, 8.0)],
            sequence=TimelineSequence(total_duration_sec=10.0, clips=["clip-a"]),
            metadata={},
        ),
    )

    assert scored_samples
    assert not stale_transform.exists()
    assert result.notices == [
        {
            "code": "motion_analysis_unavailable",
            "level": "warning",
            "message": "Motion-stability analysis was skipped because ffmpeg lacks vidstabdetect.",
        }
    ]
    assert result.timings[0]["motion_analysis_skipped"] is True


def test_late_stage_ffmpeg_errors_propagate_untranslated(tmp_path):
    # Pi enhancement also shells out to ffmpeg; its failures must not be
    # relabeled as early-stage analysis errors (pre-extraction behavior).
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }

    def raise_ffmpeg(*_args, **_kwargs):
        raise FFmpegError("late-stage failure")

    with pytest.raises(FFmpegError):
        _run_service(
            project,
            _request(harness_id="pi_agent"),
            tmp_path,
            assemble_clips_fn=lambda **_kwargs: AssemblyResult(
                clips=[_clip("clip-a", 0.0, 22.0, 8.5)],
                sequence=TimelineSequence(total_duration_sec=22.0, clips=["clip-a"]),
                metadata={},
            ),
            enhance_clips_fn=raise_ffmpeg,
        )


def test_finalize_clip_set_recommendation_boundaries():
    def finalize(clips):
        return analysis_service.finalize_clip_set(
            {"videos": [], "clips": [], "timeline": None},
            [{"file_id": "file-1", "clips": clips, "result": SimpleNamespace(metadata={})}],
            preserve_manual_timeline=True,
            enrich_clips=lambda data: data["clips"],
        )

    short = finalize([_clip("short", 0.0, 7.0, 8.0).model_dump()])
    cinematic = finalize([_clip("cinematic", 0.0, 8.0, 8.0).model_dump()])
    long = finalize(
        [
            _clip("long-a", 0.0, 20.0, 8.0).model_dump(),
            _clip("long-b", 20.0, 40.0, 8.0).model_dump(),
            _clip("long-c", 40.0, 60.0, 8.0).model_dump(),
        ]
    )

    assert short["recommendation"]["profile"] == "short_social"
    assert cinematic["recommendation"]["profile"] == "cinematic_highlight"
    assert long["recommendation"]["profile"] == "long_scenic"
    assert short["recommendation"]["format"] == "short"
    assert cinematic["recommendation"]["format"] == "medium"
    assert long["recommendation"]["format"] == "long"


def _frame_at(timestamp: float, frame_path: str, *, smoothness: float = 8.0) -> FrameScore:
    return FrameScore(
        timestamp=timestamp,
        frame_path=frame_path,
        motion_stability=smoothness,
        smoothness_score=smoothness,
        sharpness_score=8.0,
        exposure_score=8.0,
        contrast_score=8.0,
        visual_interest_score=0.0,
        overall_score=smoothness,
        blur_score=8.0,
        brightness=0.8,
        contrast=0.8,
        scene_id=1,
        is_keyframe=True,
        turn_rate_deg_per_sec=2.0,
    )


def test_run_analysis_pipeline_computes_embeddings_and_assigns_look_groups(tmp_path):
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }
    frame_a = tmp_path / "frame_a.jpg"
    frame_a.write_bytes(b"identical-frame-bytes")
    frame_b = tmp_path / "frame_b.jpg"
    frame_b.write_bytes(b"identical-frame-bytes")
    frame_c = tmp_path / "frame_c.jpg"
    frame_c.write_bytes(b"a-visually-distinct-frame")
    frames = [
        _frame_at(0.0, str(frame_a)),
        _frame_at(30.0, str(frame_b)),
        _frame_at(60.0, str(frame_c)),
    ]

    result = _run_service(
        project,
        _request(),
        tmp_path,
        score_samples_fn=lambda _samples: frames,
        assemble_clips_fn=lambda **_kwargs: AssemblyResult(
            clips=[
                _clip("clip-a", 0.0, 5.0, 9.0),
                _clip("clip-b", 30.0, 35.0, 8.0),
                _clip("clip-c", 60.0, 65.0, 7.0),
            ],
            sequence=TimelineSequence(total_duration_sec=65.0, clips=["clip-a", "clip-b", "clip-c"]),
            metadata={},
        ),
        embedding_provider_fn=lambda: FakeEmbeddingProvider(dim=8),
    )

    assert result.per_file_frames["file-1"]["embeddings"].keys() == {
        "clip-a",
        "clip-b",
        "clip-c",
    }

    project["frame_scores"] = {"per_file": result.per_file_frames}
    finalized = analysis_service.finalize_clip_set(
        project,
        result.per_file_results,
        preserve_manual_timeline=True,
        enrich_clips=lambda data: data["clips"],
    )

    clips_by_id = {clip["clip_id"]: clip for clip in finalized["clips"]}
    assert all(isinstance(clip["look_group"], int) for clip in clips_by_id.values())
    assert "embedding" not in clips_by_id["clip-a"]
    # clip-a and clip-b were sampled from byte-identical frames -> same look.
    assert clips_by_id["clip-a"]["look_group"] == clips_by_id["clip-b"]["look_group"]
    # clip-c's frame is visually distinct -> a different look group.
    assert clips_by_id["clip-c"]["look_group"] != clips_by_id["clip-a"]["look_group"]


def test_run_analysis_pipeline_degrades_to_unique_look_groups_without_a_provider(tmp_path):
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }
    frame_a = tmp_path / "frame_a.jpg"
    frame_a.write_bytes(b"identical-frame-bytes")
    frame_b = tmp_path / "frame_b.jpg"
    frame_b.write_bytes(b"identical-frame-bytes")
    frames = [_frame_at(0.0, str(frame_a)), _frame_at(30.0, str(frame_b))]

    result = _run_service(
        project,
        _request(),
        tmp_path,
        score_samples_fn=lambda _samples: frames,
        assemble_clips_fn=lambda **_kwargs: AssemblyResult(
            clips=[_clip("clip-a", 0.0, 5.0, 9.0), _clip("clip-b", 30.0, 35.0, 8.0)],
            sequence=TimelineSequence(total_duration_sec=35.0, clips=["clip-a", "clip-b"]),
            metadata={},
        ),
        embedding_provider_fn=lambda: None,
    )

    assert result.per_file_frames["file-1"]["embeddings"] == {}

    project["frame_scores"] = {"per_file": result.per_file_frames}
    finalized = analysis_service.finalize_clip_set(
        project,
        result.per_file_results,
        preserve_manual_timeline=True,
        enrich_clips=lambda data: data["clips"],
    )

    clips_by_id = {clip["clip_id"]: clip for clip in finalized["clips"]}
    assert clips_by_id["clip-a"]["look_group"] != clips_by_id["clip-b"]["look_group"]


def test_run_analysis_pipeline_survives_embedding_provider_errors(tmp_path):
    project = {
        "project_id": "project-1",
        "videos": [_source_video(tmp_path)],
        "clips": [],
        "timeline": None,
    }
    frame_a = tmp_path / "frame_a.jpg"
    frame_a.write_bytes(b"frame-bytes")
    frames = [_frame_at(0.0, str(frame_a))]

    class ExplodingProvider:
        def embed_images(self, paths):
            raise RuntimeError("session crashed")

    result = _run_service(
        project,
        _request(),
        tmp_path,
        score_samples_fn=lambda _samples: frames,
        assemble_clips_fn=lambda **_kwargs: AssemblyResult(
            clips=[_clip("clip-a", 0.0, 5.0, 9.0)],
            sequence=TimelineSequence(total_duration_sec=5.0, clips=["clip-a"]),
            metadata={},
        ),
        embedding_provider_fn=lambda: ExplodingProvider(),
    )

    assert result.per_file_frames["file-1"]["embeddings"] == {}
    assert len(result.per_file_results[0]["clips"]) == 1
