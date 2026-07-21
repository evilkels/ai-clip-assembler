# Diverse Clip Generation — Implementation Plan (Plan 018)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Read the whole phase before starting
> it; honor each phase's **Guardrails** and the **STOP conditions**. Update this
> plan's row in `docs/plans/README.md` when a phase lands.
>
> **Drift check (run first):**
> `git diff --stat 7d86531..HEAD -- backend/src/clip_assembly.py backend/src/assembly_profiles.py backend/src/analysis_service.py backend/src/api.py backend/src/project_store.py backend/src/models.py frontend/src/renderer/src/routes/Import.tsx frontend/src/renderer/src/routes/Review.tsx`
> If any changed since `7d86531`, re-read the cited ranges against live code
> before editing; on a structural mismatch, treat it as a STOP condition.

**Goal:** Make clip generation produce a diverse library of distinct best
fragments — no temporal duplicates, no look-alike monotony — and drive
diversity-aware multi-format edits, with the generation controls relocated to
the Import page.

**Architecture:** Candidate generation emits one best fragment per smooth run
(deterministic de-overlap). A pluggable local image-embedding provider produces
a vector per candidate; cosine clustering assigns each candidate a `look_group`.
The Review library leads with the best fragment per look group (siblings
grouped, not deleted). Edit assembly enforces at most one clip per look group,
recommends and builds one of three length formats (Short/Medium/Long) with the
others on demand, and applies slow-mo sparingly instead of to every smooth clip.
The six generation knobs move to Import under Analyze; when cached frame scores
exist, "Analyze" re-derives instantly with no FFmpeg.

**Tech Stack:** Python 3.9, FastAPI, numpy, OpenCV, Pillow, PySceneDetect;
`onnxruntime` + a bundled CLIP image-encoder ONNX model (new, Phase B); React 19
+ TypeScript + Vite (Electron renderer), plain CSS + design tokens.

**Status:** IN PROGRESS (2026-07-21) — Phases A, B, C and E complete. Phase D
(library grouping UI) is the only phase remaining.

The Task B3 model decision is settled: **SigLIP base-patch16-224** vision tower
(Apache-2.0 for both code and weights) instead of OpenAI CLIP — MobileCLIP and
OpenAI CLIP were rejected for ambiguous/research-only redistribution terms. See
`backend/models/README.md`. **The `.onnx` file is not yet exported or bundled**,
so today `default_embedding_provider()` returns `None` and every candidate
falls into its own Look Group — the diversity features are inert in real runs
until the model ships.

## Global Constraints

- **Local-first**: no network calls; embeddings run on-device. Copied from
  `docs/PRD.md:124-127`.
- **No FFmpeg on re-derive**: any regeneration must run on cached frame scores +
  cached embeddings only (invariant from plan 012). Re-running FFmpeg is a STOP.
- **uuid5 clip identity**: `clip_id = uuid5(NAMESPACE_URL, f"{file_id}:{start:.3f}:{end:.3f}")`
  (`clip_assembly.py:121`). Keeping the top window per moment/group must not
  change surviving IDs (decision/version provenance depends on it — plan 009).
- **Graceful degradation**: if the embedding model is unavailable, clustering
  falls back to "each candidate is its own look group" (variety filtering
  becomes a no-op); analysis and generation must still succeed.
- **Schema-versioned sidecars**: bump `FRAME_SCORES_SCHEMA_VERSION` when the
  sidecar shape changes; keep read-back backward compatible
  (`project_store.py:21`).
- **Ubiquitous language**: use **Candidate Clip**, **Scene**, **Overall Score**,
  **Timeline Item** per `UBIQUITOUS_LANGUAGE.md`. New term below.
- **Verification gate (every phase)**:
  `cd backend && source .venv/bin/activate && python -m pytest -q && .venv/bin/ruff check src tests`
  and for frontend phases
  `cd frontend && npx tsc --noEmit -p tsconfig.json && npx eslint . --max-warnings=0 --ignore-pattern src/renderer/src/types/generated.ts`.

**New ubiquitous term** — **Look Group**: a set of Candidate Clips judged
visually near-identical by embedding similarity. The library surfaces the
highest-scored clip per Look Group; edits use at most one clip per Look Group.
(Add this row to `UBIQUITOUS_LANGUAGE.md` in Task B4.)

## File Structure

**Phase A — temporal de-overlap (no new deps):**
- Modify `backend/src/clip_assembly.py` — one best window per run.
- Test `backend/tests/test_clip_assembly.py`.

**Phase B — embeddings + look groups:**
- Create `backend/src/embeddings.py` — `EmbeddingProvider` protocol,
  `OnnxClipEmbeddingProvider`, `FakeEmbeddingProvider`, `embed_frames()`.
- Create `backend/src/clip_diversity.py` — `assign_look_groups()`.
- Modify `backend/src/models.py` — `FrameScore` unchanged; add
  `look_group: Optional[int]` to `ClipSuggestion`.
- Modify `backend/src/analysis_service.py` — compute embeddings, assign groups.
- Modify `backend/src/project_store.py` — persist embeddings + look groups.
- Modify `backend/src/api.py` — reuse cached embeddings on `rederive_clips`.
- Modify `backend/requirements.txt` — add `onnxruntime`.
- Tests `backend/tests/test_embeddings.py`, `backend/tests/test_clip_diversity.py`.

**Phase C — diversity-aware multi-format edits:**
- Modify `backend/src/assembly_profiles.py` — look-group diversity in
  `build_draft_timeline`; format registry Short/Medium/Long; sparing slow-mo.
- Modify `backend/src/api.py` — build recommended format + on-demand endpoint.
- Tests extend `backend/tests/test_assembly_profiles.py`, `backend/tests/test_api.py`.

**Phase D — library grouping UI:**
- Modify `frontend/src/renderer/src/components/SourceClipsPanel.tsx`,
  `frontend/src/renderer/src/components/ClipCard.tsx`,
  `frontend/src/renderer/src/routes/Review.tsx` (format switcher).
- Regenerate `frontend/src/renderer/src/types/generated.ts` via `npm run gen:types`.

**Phase E — controls to Import:**
- Modify `frontend/src/renderer/src/routes/Import.tsx` (host the panel),
  `frontend/src/renderer/src/components/ClipGenerationPanel.tsx` (relabel),
  `frontend/src/renderer/src/routes/Review.tsx` (remove panel + link to Import),
  relevant context/client wiring.

Phases are independently shippable and should land in order (C depends on B's
`look_group`; D depends on B/C; E is independent but sequenced last).

---

## Phase A — One best fragment per smooth run

**Why:** `candidate_windows` (`clip_assembly.py:47`) emits every (start,end)
window over a run — the O(n²) overlaps behind the two near-identical IMG_0145
clips. Emit only the single best window per run instead. Folds in plan 016
Step 2.

**Guardrails:** Deterministic; keep uuid5 identity for the surviving window.
Do not touch scoring. Fallback-scene coverage path (`clip_assembly.py:217-243`)
keeps its existing "one clip per uncovered scene" behavior.

### Task A1: Select the single best window per run

**Files:**
- Modify: `backend/src/clip_assembly.py:190-215` (`assemble_smooth_clips` run loop)
- Test: `backend/tests/test_clip_assembly.py`

**Interfaces:**
- Produces: `best_window(windows: List[CandidateWindow]) -> Optional[CandidateWindow]`
  — returns the window maximizing `weighted_overall(window.frames)`, tie-broken
  by longer duration; `None` for empty input.

- [x] **Step 1: Write the failing test**
```python
# backend/tests/test_clip_assembly.py
from src.clip_assembly import assemble_smooth_clips, AssemblyPreferences
from src.models import FrameScore

def _frames(scene_id, start, count, *, smooth=9.0, step=1.0):
    return [
        FrameScore(
            timestamp=start + i * step, scene_id=scene_id, smoothness_score=smooth,
            sharpness_score=9.0, exposure_score=8.0, contrast_score=8.0,
            visual_interest_score=6.0, turn_rate_deg_per_sec=1.0,
        )
        for i in range(count)
    ]

def test_one_best_window_per_run_no_overlaps():
    # A single smooth run 0..10s must yield exactly ONE candidate, not the
    # O(n^2) family of overlapping windows.
    frames = _frames(0, 0.0, 11)
    result = assemble_smooth_clips(
        "file-1", "DJI.MP4", frames,
        AssemblyPreferences(min_clip_duration_sec=3.0, max_clip_duration_sec=10.0),
        source_duration_sec=10.0,
    )
    assert len(result.clips) == 1
    only = result.clips[0]
    assert only.scene_id == 0
    assert (only.end_sec - only.start_sec) >= 3.0
```

- [x] **Step 2: Run it, verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_clip_assembly.py::test_one_best_window_per_run_no_overlaps -v`
Expected: FAIL — currently multiple overlapping clips are returned.

- [x] **Step 3: Add `best_window` and use it in the run loop**
```python
# clip_assembly.py — add near candidate_windows
def best_window(windows: List[CandidateWindow]) -> Optional[CandidateWindow]:
    """The single strongest window for a run: highest weighted overall score,
    ties broken by the longer (more usable) span."""
    if not windows:
        return None
    return max(
        windows,
        key=lambda w: (weighted_overall(w.frames), w.end_sec - w.start_sec),
    )
```
Then in `assemble_smooth_clips` replace the per-window append loop
(`clip_assembly.py:209-215`):
```python
        windows = candidate_windows(
            run,
            preferences.min_clip_duration_sec,
            preferences.max_clip_duration_sec,
            scene_end_sec=scene_end if scene_end != float("inf") else None,
        )
        chosen = best_window(windows)
        if chosen is not None:
            clips.append(make_clip(file_id, file_name, chosen))
```

- [x] **Step 4: Run the test, verify it passes**

Run: `python -m pytest tests/test_clip_assembly.py -v`
Expected: PASS. (Update any pre-existing `test_clip_assembly.py` assertions that
counted overlapping windows — they should now expect one-per-run.)

- [x] **Step 5: Run the full backend gate**

Run: `python -m pytest -q && .venv/bin/ruff check src tests`
Expected: green. `_bounded_scene_pool` still enforces `max_clips_per_scene`
across runs within a scene; `generation_stats.candidates_generated` will drop
sharply (one per run) — update `test_api.py` generation-stats expectations if
they hard-code the old large count.

- [x] **Step 6: Commit**
```bash
git add backend/src/clip_assembly.py backend/tests/test_clip_assembly.py backend/tests/test_api.py
git commit -m "feat(assembly): emit one best fragment per smooth run"
```

---

## Phase B — Embeddings & Look Groups

**Why:** Detect look-alikes across files/scenes so the library and edits avoid
visual monotony. Isolate the model behind `EmbeddingProvider` so clustering is
unit-testable with synthetic vectors and the feature degrades when the model is
absent.

**Guardrails:** No network. Compute embeddings only from frame JPEGs already
sampled during analysis. Persist vectors in the frame-scores sidecar (bump
schema). Clustering runs on cached vectors during `rederive_clips` (no FFmpeg,
no re-embedding needed unless clips changed).

### Task B1: EmbeddingProvider interface + deterministic fake

**Files:**
- Create: `backend/src/embeddings.py`
- Test: `backend/tests/test_embeddings.py`

**Interfaces:**
- Produces:
  - `class EmbeddingProvider(Protocol): def embed_images(self, paths: list[str]) -> list[list[float]]`
  - `class FakeEmbeddingProvider` — deterministic vector from file bytes hash
    (for tests; no model).
  - `def embed_candidate(provider: EmbeddingProvider, frame_paths: list[str]) -> Optional[list[float]]`
    — mean of per-frame L2-normalized vectors, re-normalized; `None` if no paths.

- [x] **Step 1: Write the failing test**
```python
# backend/tests/test_embeddings.py
import math
from src.embeddings import FakeEmbeddingProvider, embed_candidate

def test_embed_candidate_is_unit_norm_and_deterministic(tmp_path):
    p = tmp_path / "f.jpg"; p.write_bytes(b"abc")
    provider = FakeEmbeddingProvider(dim=8)
    v1 = embed_candidate(provider, [str(p)])
    v2 = embed_candidate(provider, [str(p)])
    assert v1 == v2                      # deterministic
    assert abs(math.sqrt(sum(x * x for x in v1)) - 1.0) < 1e-6  # unit norm

def test_embed_candidate_none_without_frames():
    assert embed_candidate(FakeEmbeddingProvider(dim=8), []) is None
```

- [x] **Step 2: Run, verify fail** — `python -m pytest tests/test_embeddings.py -v` → FAIL (module missing).

- [x] **Step 3: Implement `embeddings.py`**
```python
import hashlib
from typing import List, Optional, Protocol, runtime_checkable

import numpy as np


@runtime_checkable
class EmbeddingProvider(Protocol):
    def embed_images(self, paths: List[str]) -> List[List[float]]: ...


class FakeEmbeddingProvider:
    """Deterministic, model-free embeddings for tests: hash of file bytes → vector."""

    def __init__(self, dim: int = 32) -> None:
        self._dim = dim

    def embed_images(self, paths: List[str]) -> List[List[float]]:
        out = []
        for path in paths:
            with open(path, "rb") as handle:
                digest = hashlib.sha256(handle.read()).digest()
            raw = np.frombuffer((digest * ((self._dim // len(digest)) + 1)), dtype=np.uint8)
            vec = raw[: self._dim].astype(np.float64)
            norm = np.linalg.norm(vec) or 1.0
            out.append((vec / norm).tolist())
        return out


def embed_candidate(
    provider: EmbeddingProvider, frame_paths: List[str]
) -> Optional[List[float]]:
    if not frame_paths:
        return None
    vectors = np.array(provider.embed_images(frame_paths), dtype=np.float64)
    if vectors.size == 0:
        return None
    mean = vectors.mean(axis=0)
    norm = np.linalg.norm(mean) or 1.0
    return (mean / norm).tolist()
```

- [x] **Step 4: Run, verify pass** — `python -m pytest tests/test_embeddings.py -v` → PASS.
- [x] **Step 5: Commit** — `git add backend/src/embeddings.py backend/tests/test_embeddings.py && git commit -m "feat(embeddings): provider interface + deterministic fake"`

### Task B2: Look-group clustering

**Files:**
- Create: `backend/src/clip_diversity.py`
- Test: `backend/tests/test_clip_diversity.py`

**Interfaces:**
- Consumes: candidate dicts each optionally carrying `"embedding": list[float]`.
- Produces: `assign_look_groups(candidates: list[dict], *, threshold: float = 0.92) -> list[dict]`
  — returns the same dicts with an added integer `"look_group"`; greedy
  single-link by cosine similarity ≥ threshold against existing group medoids;
  candidates without an embedding each get a unique group (degradation path).
  Group ids are assigned in descending `overall_score` order so group 0 is the
  strongest, making downstream ordering stable/deterministic.

- [x] **Step 1: Write the failing test**
```python
# backend/tests/test_clip_diversity.py
from src.clip_diversity import assign_look_groups

def _c(cid, score, emb):
    return {"clip_id": cid, "overall_score": score, "embedding": emb}

def test_near_identical_vectors_share_a_group():
    clips = [
        _c("a", 9.0, [1.0, 0.0, 0.0]),
        _c("b", 8.0, [0.99, 0.14, 0.0]),   # ~same direction as a
        _c("c", 7.0, [0.0, 1.0, 0.0]),     # orthogonal → different look
    ]
    grouped = {x["clip_id"]: x["look_group"] for x in assign_look_groups(clips, threshold=0.92)}
    assert grouped["a"] == grouped["b"]
    assert grouped["c"] != grouped["a"]

def test_missing_embedding_gets_unique_group():
    clips = [{"clip_id": "a", "overall_score": 9.0}, {"clip_id": "b", "overall_score": 8.0}]
    grouped = assign_look_groups(clips)
    assert grouped[0]["look_group"] != grouped[1]["look_group"]
```

- [x] **Step 2: Run, verify fail** — `python -m pytest tests/test_clip_diversity.py -v` → FAIL.

- [x] **Step 3: Implement `clip_diversity.py`**
```python
from typing import List

import numpy as np


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def assign_look_groups(candidates: List[dict], *, threshold: float = 0.92) -> List[dict]:
    """Greedy single-link clustering by cosine similarity. Strongest clip first,
    so group 0 is the highest-scored look. Candidates lacking an embedding each
    form their own group (degradation path)."""
    ordered = sorted(candidates, key=lambda c: float(c.get("overall_score", 0.0)), reverse=True)
    group_reps: List[np.ndarray] = []  # one representative vector per group
    next_group = 0
    for clip in ordered:
        emb = clip.get("embedding")
        if not emb:
            clip["look_group"] = next_group
            next_group += 1
            continue
        vec = np.array(emb, dtype=np.float64)
        assigned = None
        for group_id, rep in enumerate(group_reps):
            if _cosine(vec, rep) >= threshold:
                assigned = group_id
                break
        if assigned is None:
            assigned = len(group_reps)
            group_reps.append(vec)
        clip["look_group"] = assigned
    return ordered
```

- [x] **Step 4: Run, verify pass** — PASS.
- [x] **Step 5: Commit** — `git add backend/src/clip_diversity.py backend/tests/test_clip_diversity.py && git commit -m "feat(diversity): cosine look-group clustering"`

### Task B3: ONNX CLIP provider (real embeddings, skip-if-absent)

**Files:**
- Modify: `backend/src/embeddings.py` (add `OnnxClipEmbeddingProvider`,
  `default_embedding_provider()`)
- Modify: `backend/requirements.txt` (add `onnxruntime==1.19.2`)
- Test: `backend/tests/test_embeddings.py` (smoke test, skipped if model/runtime absent)

**Interfaces:**
- Produces: `default_embedding_provider() -> Optional[EmbeddingProvider]` —
  returns an `OnnxClipEmbeddingProvider` if `onnxruntime` and the bundled model
  file resolve; else `None` (callers treat `None` as "no embeddings → unique
  groups").
- Model: CLIP image encoder exported to ONNX (ViT-B/32 or MobileCLIP-S0),
  resolved from `backend/models/clip_image_encoder.onnx` or an env override
  `CLIP_ONNX_PATH`. Preprocess: resize 224², center-crop, CLIP mean/std
  normalize (Pillow + numpy). **Decision to confirm with maintainer**: exact
  model + its license for redistribution in the DMG (note in
  `docs/plans/README.md` findings + `LICENSE`/NOTICE if bundled).

- [x] **Step 1: Write the smoke test (auto-skip)**
```python
import pytest
from src.embeddings import default_embedding_provider, embed_candidate

def test_onnx_provider_smoke(tmp_path):
    provider = default_embedding_provider()
    if provider is None:
        pytest.skip("CLIP ONNX model/runtime not available")
    from PIL import Image
    p = tmp_path / "img.jpg"; Image.new("RGB", (64, 64), (120, 200, 90)).save(p)
    vec = embed_candidate(provider, [str(p)])
    assert vec is not None and len(vec) > 0
```

- [x] **Step 2: Run, verify skip/behavior** — `python -m pytest tests/test_embeddings.py::test_onnx_provider_smoke -v` → SKIP until model present (mirrors existing OpenCV-skipped tests).

- [x] **Step 3: Implement provider** (CLIP ViT-B/32 preprocessing; adjust
  `mean`/`std`/size if the chosen model differs)
```python
import os
from typing import List, Optional

import numpy as np

_CLIP_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_CLIP_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


class OnnxClipEmbeddingProvider:
    def __init__(self, model_path: str) -> None:
        import onnxruntime  # local import so the module loads without the dep

        self._session = onnxruntime.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
        self._input = self._session.get_inputs()[0].name

    def _preprocess(self, path: str) -> np.ndarray:
        from PIL import Image

        image = Image.open(path).convert("RGB")
        # Resize shortest side to 224 then center-crop 224x224 (CLIP default).
        w, h = image.size
        scale = 224 / min(w, h)
        image = image.resize((round(w * scale), round(h * scale)), Image.BICUBIC)
        w, h = image.size
        left, top = (w - 224) // 2, (h - 224) // 2
        image = image.crop((left, top, left + 224, top + 224))
        arr = (np.asarray(image, dtype=np.float32) / 255.0 - _CLIP_MEAN) / _CLIP_STD
        return np.transpose(arr, (2, 0, 1))  # HWC -> CHW

    def embed_images(self, paths: List[str]) -> List[List[float]]:
        if not paths:
            return []
        batch = np.stack([self._preprocess(p) for p in paths]).astype(np.float32)
        out = self._session.run(None, {self._input: batch})[0]
        return [row.astype(np.float64).tolist() for row in out]


def default_embedding_provider() -> Optional[EmbeddingProvider]:
    """Real provider if onnxruntime + the model file resolve, else None so
    callers degrade to unique look groups."""
    model_path = os.environ.get("CLIP_ONNX_PATH") or os.path.join(
        os.path.dirname(__file__), "..", "models", "clip_image_encoder.onnx"
    )
    if not os.path.exists(model_path):
        return None
    try:
        return OnnxClipEmbeddingProvider(model_path)
    except Exception:
        return None
```

- [x] **Step 4: Run gate** — `python -m pytest -q` (smoke skips), ruff clean.
- [x] **Step 5: Commit** — `git commit -am "feat(embeddings): local ONNX CLIP provider with skip-if-absent"`

### Task B4: Persist embeddings + attach look_group during analysis

**Files:**
- Modify: `backend/src/models.py` (`ClipSuggestion`: add `look_group: Optional[int] = None`)
- Modify: `backend/src/project_store.py` (`FRAME_SCORES_SCHEMA_VERSION` → 2; store
  `embeddings: {clip_id: [floats]}` per file; backward-compatible read)
- Modify: `backend/src/analysis_service.py:190-290` (after `assemble_smooth_clips`,
  gather each clip's frame paths, `embed_candidate`, collect all candidates,
  `assign_look_groups`, set `clip.look_group`, stash embeddings for the sidecar)
- Modify: `backend/src/api.py:702-740` (`rederive_clips`: read cached embeddings,
  re-run `assign_look_groups`, set `look_group` on re-derived clips — no
  re-embedding, no FFmpeg)
- Modify: `UBIQUITOUS_LANGUAGE.md` (add the **Look Group** row)
- Test: `backend/tests/test_analysis_service.py` (or `test_api.py`)

**Interfaces:**
- Consumes: `embed_candidate`, `assign_look_groups`, `default_embedding_provider`,
  `mcp_frame_paths`-equivalent frame listing available in the pipeline
  (`frames_dir=samples_path / file_id`, `analysis_service.py:171`).
- Produces: every clip dict/`ClipSuggestion` carries `look_group`;
  `frame_scores.json` carries `embeddings` per file.

- [x] **Step 1: Failing test** — analyze a seeded project with the
  `FakeEmbeddingProvider` injected; assert every clip has an integer
  `look_group`, and two clips fed identical frame bytes share a group.
- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** — thread an optional `embedding_provider` param
  through `run_analysis_pipeline`/`analysis_service` (default
  `default_embedding_provider()`); compute per-candidate embeddings from frame
  paths; `assign_look_groups`; persist; bump sidecar schema with a v1→v2
  read shim (v1 sidecars → clips get unique groups on reopen).
- [x] **Step 4: Run, verify pass; full gate.**
- [x] **Step 5: Commit** — `git commit -am "feat(analysis): persist embeddings and assign look groups"`

**STOP** if attaching embeddings would require re-running any FFmpeg step, or if
`rederive_clips` re-embeds (it must reuse cached vectors).

---

## Phase C — Diversity-aware multi-format edits

**Why:** Even with a diverse library, edit assembly must not stack look-alikes,
must offer Short/Medium/Long, and must stop the blanket 0.5× slow-mo.

**Guardrails:** Build only the recommended format on analyze; others on demand.
Keep `build_draft_timeline`'s existing per-file overlap + sliver-floor guards
(shipped in commit `cc974f5`).

### Task C1: One clip per look group in `build_draft_timeline`

**Files:**
- Modify: `backend/src/assembly_profiles.py:94-147`
- Test: `backend/tests/test_assembly_profiles.py`

**Interfaces:**
- Consumes: clip dicts with `look_group` (Phase B). Absent `look_group` → treat
  each clip as its own group (no diversity constraint).
- Produces: `build_draft_timeline` selects at most one clip per `look_group`.

- [x] **Step 1: Failing test**
```python
def test_draft_uses_one_clip_per_look_group():
    clips = [
        clip("a", 0, 30, score=9.5), clip("b", 40, 70, score=9.0),   # same look
        clip("c", 80, 110, score=8.0),                                # different look
    ]
    clips[0]["look_group"] = 0; clips[1]["look_group"] = 0; clips[2]["look_group"] = 1
    draft = build_draft_timeline(clips, profile="cinematic_highlight", target_duration_sec=300)
    kept = [e["clip_id"] for e in draft["clips"]]
    assert "a" in kept and "c" in kept and "b" not in kept  # b is a look-dupe of a
```
- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** — add a `claimed_look_groups: set` in
  `build_draft_timeline`; skip a clip whose `look_group` is already claimed (only
  when `look_group is not None`); claim on selection.
- [x] **Step 4: Run, verify pass; full gate** (existing tests must stay green —
  they use clips without `look_group`, so no diversity constraint applies).
- [x] **Step 5: Commit** — `git commit -am "feat(assembly): one clip per look group in drafts"`

### Task C2: Short/Medium/Long format registry + sparing slow-mo

**Files:**
- Modify: `backend/src/assembly_profiles.py` (map the three length **formats** to
  existing profiles: Short→`short_social`, Medium→`cinematic_highlight`,
  Long→`long_scenic`; change slow-mo policy)
- Test: `backend/tests/test_assembly_profiles.py`

**Interfaces:**
- Produces: `FORMATS: dict[str, dict]` with `{label, profile, target_duration_sec}`
  for `"short"|"medium"|"long"`; `recommend_format(clips) -> str` (wraps
  `recommend_assembly_profile`); slow-mo capped.

- [x] **Step 1: Failing tests**
```python
def test_slowmo_is_sparing_not_blanket():
    # Six very-smooth low-turn clips → at most a couple end up slowed, not all.
    clips = [clip(f"s{i}", i*40, i*40+30, score=9.5-i/10, smoothness=9.6, max_turn=1.0)
             for i in range(6)]
    for i, c in enumerate(clips):
        c["look_group"] = i
    draft = build_draft_timeline(clips, profile="long_scenic", target_duration_sec=480)
    slowed = [e for e in draft["clips"] if e["suggested_speed"] != 1.0]
    assert len(slowed) <= 2

def test_short_format_never_slowmos():
    clips = [clip("x", 0, 30, score=9, smoothness=9.9, max_turn=0.2)]
    clips[0]["look_group"] = 0
    draft = build_draft_timeline(clips, profile="short_social", target_duration_sec=30)
    assert draft["clips"][0]["suggested_speed"] == 1.0
```
- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** — change slow-mo so `slowmo_smooth` applies to at most
  N clips per edit (e.g. the 2 smoothest, low-turn), not every qualifying clip;
  `short_social` stays `speed_policy: "none"`. Add the `FORMATS` map +
  `recommend_format`.
- [x] **Step 4: Run, verify pass; full gate.** Update
  `test_cinematic_applies_slowmo_to_very_smooth_clips_only` if the cap changes its
  expectation.
- [x] **Step 5: Commit** — `git commit -am "feat(assembly): length formats + sparing slow-mo"`

### Task C3: Build recommended format on analyze; on-demand endpoint

**Files:**
- Modify: `backend/src/analysis_service.py:372-380` (build recommended **format**),
  `backend/src/api.py:684-699` (`regenerate_draft` accepts a `format` key mapping
  through `FORMATS`)
- Test: `backend/tests/test_api.py`

**Interfaces:**
- Produces: analyze response `recommendation` includes `format` ∈
  `short|medium|long`; `POST /projects/{id}/draft` accepts `{"format": "..."}`
  (existing `profile`/`target_duration_sec` still honored for back-compat).

- [x] **Step 1: Failing test** — analyze a seeded project; assert
  `recommendation["format"]` present; `POST /draft {"format":"short"}` returns a
  timeline whose total ≤ the short target.
- [x] **Step 2–4:** implement, run, gate.
- [x] **Step 5: Commit** — `git commit -am "feat(api): recommend a format and build others on demand"`

---

## Phase D — Library grouping UI (best-of-look + format switcher)

**Why:** Show the diverse library and let the user switch formats.

**Files:**
- Modify: `frontend/src/renderer/src/components/SourceClipsPanel.tsx` — group
  cards by `look_group`; lead with the best per group; collapse siblings under a
  "N similar" affordance.
- Modify: `frontend/src/renderer/src/components/ClipCard.tsx` — show a "similar
  looks" badge/expander from `look_group` membership.
- Modify: `frontend/src/renderer/src/routes/Review.tsx` — a Short/Medium/Long
  switcher on "Suggested cuts" calling the on-demand draft endpoint.
- Regenerate types: `cd frontend && npm run gen:types` (adds `look_group`).

**Interfaces:**
- Consumes: `ClipCandidate.look_group` (from regenerated `generated.ts`);
  `format` on the draft/recommendation payloads.

- [x] **Step 1:** `npm run gen:types`; verify `look_group` in `generated.ts`.
- [x] **Step 2 (deliberately skipped, maintainer decision 2026-07-21):** this
  step originally called for an RTL `SourceClipsPanel` test. This repo has no
  component-test framework — only Playwright e2e (`frontend/e2e/`) and
  `node --test` for the Electron main process, neither of which can render a
  React component in isolation. Adding vitest/jest/@testing-library/jsdom
  solely for one test was judged out of scope for this phase; the maintainer
  ruled to skip the automated component test and implement against the
  tsc/eslint gate instead, compensating with careful manual reasoning through
  both the grouped and all-unique states (see Step 3 below for what was
  verified).
- [x] **Step 3:** implemented grouping + format switcher.
  - `SourceClipsPanel.tsx` groups the (already score-sorted) clip list by
    `look_group` via `groupByLook`; the first clip seen per group is the lead
    (highest-scored), the rest become `siblings` and only render when the
    lead's "N similar looks" badge is expanded (`ClipCard.tsx`). Clips with no
    `look_group`, or the sole member of one, render as a plain single-card
    "group" with `similarLookCount=0`, so no badge, wrapper, or chrome is added
    — the grid stays a flat list of `ClipCard`s exactly as before, since group
    members are pushed as siblings into the same flat array rather than a
    nested wrapper. Verified by inspecting `groupByLook` against both an
    all-null-`look_group` clip array (today's real degraded case, since the
    ONNX model isn't bundled) and a synthetic array with two clips sharing a
    `look_group`.
  - `Review.tsx` adds a Short/Medium/Long `<fieldset>` switcher on "Suggested
    cuts" that calls `regenerateDraft({ format })`, which now accepts either
    `{ format }` or `{ profile, targetDurationSec }` and posts `{ format }` to
    `POST /projects/{id}/draft`; the backend's returned timeline is picked up
    through the existing `refreshTimelineDocument`/timeline-snapshot
    reconciliation path (no parallel rendering path added).
  - `format` was added by hand to `AssemblyRecommendation`/`DraftResult` in
    `types/clip.ts` since it is a plain dict key in the backend
    (`analysis_service.py`/`api.py`), not a pydantic field, so `gen:types`
    cannot produce it.
- [x] **Step 4:** `npx tsc --noEmit -p tsconfig.json && npx eslint . --max-warnings=0 --ignore-pattern src/renderer/src/types/generated.ts` — both clean.
- [x] **Step 5: Commit** — landed as `feat(review): group clips by look and add a format switcher`.

---

## Phase E — Relocate clip-generation controls to Import

**Why:** Users set generation intent where they understand it (before Analyze).
The knobs run on cached frame scores, so post-analysis changes re-derive
instantly (no FFmpeg).

**Files:**
- Modify: `frontend/src/renderer/src/components/ClipGenerationPanel.tsx` — plainer
  labels + help text; reused on Import.
- Modify: `frontend/src/renderer/src/routes/Import.tsx` — render the panel under
  the Analyze button; Analyze passes the current preferences.
- Modify: `frontend/src/renderer/src/routes/Review.tsx` — remove the panel; add a
  small "Adjust clip settings" link back to Import.
- Modify: analysis/regenerate wiring so "Analyze" re-derives from cached frame
  scores when present (reuse `rederive_clips`) instead of a full re-analyze.
- Test: frontend typecheck + eslint; extend an Import test if one exists.

**Interfaces:**
- Consumes: existing `rederiveClips`/`analyzeProject` client fns.
- Produces: Import owns generation preferences; Review no longer hosts them.

- [x] **Step 1:** move panel usage to `Import.tsx`; relabel fields (e.g. "Shortest
  clip (s)", "Longest clip (s)", "How steady (0–10)", "Max camera turn (°/s)",
  "Max clips per scene", "Max clips per video") with one-line help each.
- [x] **Step 2:** wire Analyze to re-derive from cache when `frame_scores` exist;
  full analyze only when absent/footage changed.
- [x] **Step 3:** remove the panel from `Review.tsx`; add the link.
- [x] **Step 4:** `npx tsc --noEmit` + eslint clean; focused Playwright smoke green.
- [x] **Step 5: Commit** — landed as scoped commits `2f48e2f` and `b0c46dc`.

---

## STOP conditions (whole plan)

- Any regeneration re-runs FFmpeg (must use cached frame scores + embeddings).
- Surviving `clip_id`s change for a moment/look whose top window is unchanged.
- Embedding model unavailable but analysis/generation fails instead of degrading
  to unique look groups.
- Drift check shows a cited range moved and you cannot confidently re-map it.

## Self-review notes (author)

- Spec coverage: temporal de-overlap → Phase A; CLIP embeddings + clustering →
  Phase B; library best-of-look grouping → Phase D; diversity-aware multi-format
  edits + sparing slow-mo → Phase C; controls to Import → Phase E. All four
  user-approved decisions covered.
- Open decision flagged for maintainer: exact ONNX CLIP model + redistribution
  license (Task B3).
- Relationship to earlier plans: this supersedes **plan 016 Step 2** (source
  de-overlap) and extends **plan 017** (Review clarity); note both when updating
  `README.md`.
