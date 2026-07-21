import math
from typing import List, Optional


def _cosine(left: List[float], right: List[float]) -> float:
    if len(left) != len(right):
        return 0.0

    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0

    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)


def _usable_embedding(embedding: object) -> Optional[List[float]]:
    if not embedding or not isinstance(embedding, list):
        return None

    try:
        vector = [float(value) for value in embedding]
    except (TypeError, ValueError):
        return None

    if not all(math.isfinite(value) for value in vector):
        return None
    if not any(value != 0.0 for value in vector):
        return None
    return vector


def assign_look_groups(candidates: List[dict], *, threshold: float = 0.92) -> List[dict]:
    """Assign greedy cosine-similarity look groups to Candidate Clips."""
    ordered = sorted(
        candidates,
        key=lambda candidate: float(candidate.get("overall_score", 0.0)),
        reverse=True,
    )
    representatives = []
    next_group = 0

    for candidate in ordered:
        embedding = _usable_embedding(candidate.get("embedding"))
        if embedding is None:
            candidate["look_group"] = next_group
            next_group += 1
            continue

        group_id = None
        for existing_group, representative in representatives:
            if _cosine(embedding, representative) >= threshold:
                group_id = existing_group
                break

        if group_id is None:
            group_id = next_group
            representatives.append((group_id, embedding))
            next_group += 1
        candidate["look_group"] = group_id

    return ordered
