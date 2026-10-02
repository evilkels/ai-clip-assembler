"""One-shot subprocess entry point for isolated timeline script execution.

Protocol on stdout: one JSON object per line, flushed. ``{"log": line}`` the
moment the script logs, then ``{"result": {...}}`` last. Nothing else may reach
stdout, so stray prints go to stderr.
"""

from __future__ import annotations

import json
import sys

from .models import TimelineDocument
from .timeline_ops import SourceClip
from .timeline_script import ScriptLimits, run_script_in_process


def main() -> None:
    out, sys.stdout = sys.stdout, sys.stderr

    def emit(message: dict) -> None:
        out.write(json.dumps(message) + "\n")
        out.flush()

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
        on_log=lambda line: emit({"log": line}),
    )
    emit(
        {
            "result": {
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
            }
        }
    )


if __name__ == "__main__":
    main()
