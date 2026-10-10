"""Crash-safe file writes shared by every JSON record the app persists.

``write_text_atomic`` writes a sibling temporary file, flushes it to stable
storage, atomically replaces the destination and flushes the parent directory.
A failure at any step leaves the previous file byte-identical, removes the
temporary file and raises, so a caller can never mistake a failed save for a
durable one (ADR 0003).
"""

import os
import tempfile
from pathlib import Path
from typing import Union

try:  # macOS: plain fsync does not reach the platters; F_FULLFSYNC does.
    import fcntl
except ImportError:  # pragma: no cover - non-POSIX
    fcntl = None  # type: ignore[assignment]


def fsync_fd(fd: int) -> None:
    """Flush *fd* to stable storage, using ``F_FULLFSYNC`` where available."""
    full = getattr(fcntl, "F_FULLFSYNC", None) if fcntl is not None else None
    if full is not None:
        try:
            fcntl.fcntl(fd, full)
            return
        except OSError:
            pass  # filesystem does not support it; fall back to fsync
    os.fsync(fd)


def fsync_directory(directory: Union[str, Path]) -> None:
    """Flush directory metadata so a rename or link survives power loss."""
    try:
        fd = os.open(str(directory), os.O_RDONLY)
    except OSError:
        return
    try:
        fsync_fd(fd)
    except OSError:
        pass  # some filesystems refuse directory fsync; the file itself is flushed
    finally:
        os.close(fd)


def write_bytes_atomic(path: Union[str, Path], data: bytes, mode: int = 0o644) -> None:
    target = Path(path)
    directory = target.parent
    fd, temp_name = tempfile.mkstemp(
        dir=str(directory), prefix=f".{target.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            fsync_fd(handle.fileno())
        os.chmod(temp_name, mode)
        os.replace(temp_name, target)
    except BaseException:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise
    fsync_directory(directory)


def write_text_atomic(
    path: Union[str, Path], text: str, mode: int = 0o644, encoding: str = "utf-8"
) -> None:
    write_bytes_atomic(path, text.encode(encoding), mode=mode)
