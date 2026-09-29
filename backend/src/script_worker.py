"""One-shot subprocess entry point for isolated timeline script execution."""

from __future__ import annotations

import json
import sys

from .models import TimelineDocument
from .timeline_ops import SourceClip
from .timeline_script import ScriptLimits, run_script_in_process


def main() -> None:
    request = json.load(sys.stdin)
    document = TimelineDocument.model_validate(request["document"])
    sources = {
        clip_id: SourceClip.model_validate(source)
        for clip_id, source in request["sources"].items()
    }
    result = run_script_in_process(
        request["source"],
        document=document,
        sources=sources,
        library=request["library"],
        id_seed=request["id_seed"],
        limits=ScriptLimits(**request["limits"]),
    )
    json.dump(
        {
            "operations": result.operations,
            "document": result.document.model_dump(mode="json"),
            "log": result.log,
            "error": (
                {
                    "kind": result.error.kind,
                    "message": result.error.message,
                    "line": result.error.line,
                }
                if result.error
                else None
            ),
        },
        sys.stdout,
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
