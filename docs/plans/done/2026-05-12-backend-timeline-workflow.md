# Backend Timeline Workflow Implementation Plan

Status: implemented and verified

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend timeline replacement and export behavior that matches the PRD's editable timeline workflow for drone-video testing.

**Architecture:** Keep analyzed clips as the immutable suggestion catalog and store a separate ordered export timeline with trimmed timings. Export reads the edited timeline when present, while analysis still seeds the default sequence for projects that have not been manually edited.

**Tech Stack:** FastAPI, Pydantic, pytest, TestClient, EDL/FCPXML export helpers

## Completion Record

- Backend stores an editable ordered/trimmed timeline separately from analyzed clip suggestions.
- Export reads the edited timeline when present.
- Later project-folder work persists and restores the saved timeline.
- Current merged backend verification passes with 131 tests.

---

## File Map

- Modify: `backend/src/api.py` for request models, timeline endpoint, validation helpers, and export response enrichment
- Modify: `backend/src/models.py` only if dedicated timeline models are needed for clarity
- Modify: `backend/tests/test_api.py` for red-green coverage of timeline replacement and export behavior
- Create or modify docs only under `docs/superpowers/` to preserve the implementation record

### Task 1: Prepare focused failing API tests

**Files:**
- Modify: `backend/tests/test_api.py`
- Test: `backend/tests/test_api.py`

- [x] **Step 1: Write the failing tests for timeline replacement and export behavior**

```python
def test_update_timeline_replaces_order_and_trims(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["clips"] = [
        {"clip_id": "clip-1", "file_id": "file-1", "file_name": "DJI_0001.MP4", "start_sec": 0.0, "end_sec": 5.0, "duration_sec": 5.0, "overall_score": 8},
        {"clip_id": "clip-2", "file_id": "file-1", "file_name": "DJI_0001.MP4", "start_sec": 10.0, "end_sec": 14.0, "duration_sec": 4.0, "overall_score": 7},
    ]

    response = client.put(
        f"/projects/{project_id}/timeline",
        json={"clips": [
            {"clip_id": "clip-2", "start_sec": 11.0, "end_sec": 13.5, "included": True},
            {"clip_id": "clip-1", "start_sec": 1.0, "end_sec": 4.0, "included": True},
        ]},
    )

    assert response.status_code == 200
    assert [clip["clip_id"] for clip in response.json()["clips"]] == ["clip-2", "clip-1"]

def test_update_timeline_rejects_unknown_clip_id(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["clips"] = [
        {"clip_id": "clip-1", "file_id": "file-1", "file_name": "DJI_0001.MP4", "start_sec": 0.0, "end_sec": 5.0, "duration_sec": 5.0, "overall_score": 8}
    ]

    response = client.put(
        f"/projects/{project_id}/timeline",
        json={"clips": [{"clip_id": "missing", "start_sec": 0.0, "end_sec": 2.0, "included": True}]},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Unknown clip_id: missing"

def test_export_uses_updated_timeline_order_and_trimmed_timings(monkeypatch, tmp_path):
    api.projects.clear()
    monkeypatch.setattr(api, "PROJECTS_DIR", tmp_path)
    client = TestClient(api.app)
    project_id = client.post("/projects").json()["project_id"]
    api.projects[project_id]["videos"].append(
        {"file_id": "file-1", "file_name": "DJI_0001.MP4", "file_path": str(tmp_path / "DJI_0001.MP4"), "metadata": {"duration_sec": 20.0, "fps": 30, "resolution": [1920, 1080]}, "status": "ready"}
    )
    api.projects[project_id]["clips"] = [
        {"clip_id": "clip-1", "file_id": "file-1", "file_name": "DJI_0001.MP4", "start_sec": 0.0, "end_sec": 5.0, "duration_sec": 5.0, "overall_score": 8},
        {"clip_id": "clip-2", "file_id": "file-1", "file_name": "DJI_0001.MP4", "start_sec": 10.0, "end_sec": 14.0, "duration_sec": 4.0, "overall_score": 7},
    ]
    api.projects[project_id]["timeline"] = {
        "clips": [
            {"clip_id": "clip-2", "start_sec": 11.0, "end_sec": 13.5, "duration_sec": 2.5, "included": True},
            {"clip_id": "clip-1", "start_sec": 1.0, "end_sec": 4.0, "duration_sec": 3.0, "included": True},
        ],
        "total_duration_sec": 5.5,
    }

    response = client.post(f"/projects/{project_id}/export?format=edl")

    assert response.status_code == 200
    assert response.json()["clip_count"] == 2
```

- [x] **Step 2: Run the targeted tests to verify they fail for the expected missing behavior**

Run: `PYTHONPATH=. .venv/bin/python -m pytest backend/tests/test_api.py -k "timeline or export"`
Expected: FAIL because `PUT /projects/{project_id}/timeline` does not exist yet and export still uses original clip data only.

### Task 2: Add timeline request handling and validation

**Files:**
- Modify: `backend/src/api.py`
- Test: `backend/tests/test_api.py`

- [x] **Step 1: Add Pydantic models and helpers for full timeline replacement**

```python
class TimelineClipUpdate(BaseModel):
    clip_id: str
    start_sec: float
    end_sec: float
    included: bool = True


class TimelineUpdateRequest(BaseModel):
    clips: list[TimelineClipUpdate]
```

- [x] **Step 2: Implement `PUT /projects/{project_id}/timeline` with project and clip validation**

```python
@app.put("/projects/{project_id}/timeline")
async def update_timeline(project_id: str, request: TimelineUpdateRequest):
    ...
```

- [x] **Step 3: Re-run the targeted tests and make the new endpoint pass**

Run: `PYTHONPATH=. .venv/bin/python -m pytest backend/tests/test_api.py -k "update_timeline"`
Expected: PASS

### Task 3: Make export use edited timeline state and return richer metadata

**Files:**
- Modify: `backend/src/api.py`
- Test: `backend/tests/test_api.py`

- [x] **Step 1: Update timeline-order helpers so export uses edited trims and order**

```python
def clips_in_timeline_order(project: dict) -> list[dict]:
    ...
```

- [x] **Step 2: Extend export response summary fields**

```python
return {
    "project_id": project_id,
    "format": format,
    "status": "generated",
    "file_path": str(file_path),
    "clip_count": len(clips),
    "total_duration_sec": round(sum(...), 3),
}
```

- [x] **Step 3: Re-run the export-focused tests and make them pass**

Run: `PYTHONPATH=. .venv/bin/python -m pytest backend/tests/test_api.py -k "export"`
Expected: PASS

### Task 4: Run full verification

**Files:**
- Test: `backend/tests/test_api.py`

- [x] **Step 1: Run backend tests**

Run: `cd backend && PYTHONPATH=. .venv/bin/python -m pytest`
Expected: PASS

- [x] **Step 2: Run frontend typecheck**

Run: `cd frontend && npm run typecheck`
Expected: PASS

- [x] **Step 3: Run frontend build**

Run: `cd frontend && npm run build`
Expected: PASS

### Task 5: Final review and PR

**Files:**
- Modify: none required unless review finds issues

- [x] **Step 1: Review the diff and verify it stays backend-focused**

Run: `git diff -- backend/src/api.py backend/tests/test_api.py docs/superpowers`
Expected: only backend API/tests and workflow docs changed

- [x] **Step 2: Commit and open a PR against `main`**

Run:

```bash
git add backend/src/api.py backend/tests/test_api.py docs/superpowers
git commit -m "feat: support editable backend timeline exports"
gh pr create --base main --title "feat: support editable backend timeline exports" --body "..."
```

Expected: PR references issues `#10` and `#19`, explains that `#10` remains open, and avoids closing `#19` without full acceptance validation.
