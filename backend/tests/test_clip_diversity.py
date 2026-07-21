from src.clip_diversity import assign_look_groups


def _candidate(clip_id, score, embedding):
    return {"clip_id": clip_id, "overall_score": score, "embedding": embedding}


def test_near_identical_vectors_share_a_group():
    clips = [
        _candidate("a", 9.0, [1.0, 0.0, 0.0]),
        _candidate("b", 8.0, [0.99, 0.14, 0.0]),
        _candidate("c", 7.0, [0.0, 1.0, 0.0]),
    ]
    grouped = {
        clip["clip_id"]: clip["look_group"]
        for clip in assign_look_groups(clips, threshold=0.92)
    }
    assert grouped["a"] == grouped["b"]
    assert grouped["c"] != grouped["a"]


def test_missing_embedding_gets_unique_group():
    clips = [
        {"clip_id": "a", "overall_score": 9.0},
        {"clip_id": "b", "overall_score": 8.0},
    ]
    grouped = assign_look_groups(clips)
    assert grouped[0]["look_group"] != grouped[1]["look_group"]
