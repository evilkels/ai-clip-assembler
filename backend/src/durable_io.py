"""Crash-safe file writes shared by every JSON record the app persists.

``write_text_atomic`` writes a sibling temporary file, flushes it to stable
storage, atomically replaces the destination and flushes the parent directory.
Failures before replacement preserve the previous file and remove the temporary
file. A parent-directory flush failure after replacement propagates while the
new file remains published, so callers cannot mistake it for a durable save
(ADR 0003).
"""

import errno
import os
import tempfile
from pathlib import Path
from typing import Union

try:  # macOS: plain fsync does not reach the platters; F_FULLFSYNC does.
    import fcntl
except ImportError:  # pragma: no cover - non-POSIX
    fcntl = None  # type: ignore[assignment]

_UNSUPPORTED_FLUSH_ERRORS = {errno.EINVAL, errno.ENOTSUP, errno.EOPNOTSUPP}


def fsync_fd(fd: int) -> None:
    """Flush *fd* to stable storage, using ``F_FULLFSYNC`` where available."""
    full = getattr(fcntl, "F_FULLFSYNC", None) if fcntl is not None else None
    if full is not None:
        try:
            fcntl.fcntl(fd, full)
            return
        except OSError as exc:
            if exc.errno not in _UNSUPPORTED_FLUSH_ERRORS:
                raise
    os.fsync(fd)


def fsync_directory(directory: Union[str, Path]) -> None:
    """Flush directory metadata so a rename or link survives power loss."""
    fd = os.open(str(directory), os.O_RDONLY)
    try:
        fsync_fd(fd)
    except OSError as exc:
        if exc.errno not in _UNSUPPORTED_FLUSH_ERRORS:
            raise
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
    # Once replaced, a directory flush failure is reported but cannot roll the
    # publication back to the previous contents.
    fsync_directory(directory)


def write_text_atomic(
    path: Union[str, Path], text: str, mode: int = 0o644, encoding: str = "utf-8"
) -> None:
    write_bytes_atomic(path, text.encode(encoding), mode=mode)
