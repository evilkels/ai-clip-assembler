"""Validation of the client-supplied upload metadata (architecture §4.3, §5.2).

Everything a phone sends about a file is untrusted. It is validated once at
creation, then frozen. No client field ever names a directory, a final path or
an internal ID.
"""

import base64
import binascii
import re
import unicodedata
from dataclasses import dataclass
from typing import Dict, Optional

ALLOWED_EXTENSIONS = (".mp4", ".mov")
RESERVED_NAMES = frozenset({"clipassembler", "exports", ".ds_store"})
MAX_FILENAME_BYTES = 200
MAX_METADATA_BYTES = 4096
MAX_METADATA_PAIRS = 12

_SEPARATORS = "/\\:\x00"
_KEY = re.compile(r"^[A-Za-z0-9_.-]{1,40}$")


class UploadRejected(Exception):
    """A request that must be refused; ``status`` and ``code`` drive the reply."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class UploadMetadata:
    filename: str  # sanitized, ready to use as a top-level Project filename
    original_filename: str  # what the phone called it, for provenance only
    filetype: Optional[str]
    client_last_modified: Optional[int]


def parse_metadata_header(raw: Optional[str]) -> Dict[str, str]:
    """``Upload-Metadata`` -> ``{key: decoded value}``, bounded and validated."""
    if not raw:
        raise UploadRejected(400, "metadata_required", "Upload-Metadata is required")
    if len(raw.encode("utf-8")) > MAX_METADATA_BYTES:
        raise UploadRejected(400, "metadata_too_large", "Upload-Metadata is too large")
    pairs = [part.strip() for part in raw.split(",") if part.strip()]
    if len(pairs) > MAX_METADATA_PAIRS:
        raise UploadRejected(400, "metadata_too_large", "Too many metadata fields")
    result: Dict[str, str] = {}
    for pair in pairs:
        key, _, value = pair.partition(" ")
        if not _KEY.match(key) or key in result:
            raise UploadRejected(400, "metadata_invalid", "Malformed Upload-Metadata")
        try:
            decoded = base64.b64decode(value.strip(), validate=True) if value.strip() else b""
            result[key] = decoded.decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as exc:
            raise UploadRejected(400, "metadata_invalid", "Malformed Upload-Metadata") from exc
    return result


def sanitize_filename(name: str) -> str:
    """A safe top-level ``.mp4``/``.mov`` name, or ``UploadRejected``."""
    text = unicodedata.normalize("NFC", name)
    text = "".join(
        ch
        for ch in text
        if ch not in _SEPARATORS and unicodedata.category(ch) not in ("Cc", "Cf", "Zl", "Zp")
    )
    text = text.strip().strip(".").strip()
    if not text or text in (".", ".."):
        raise UploadRejected(400, "bad_filename", "That file name can't be used")
    dot = text.rfind(".")
    stem, extension = (text[:dot], text[dot:]) if dot > 0 else (text, "")
    if extension.lower() not in ALLOWED_EXTENSIONS:
        raise UploadRejected(415, "unsupported_type", "Only .mp4 and .mov can be sent.")
    stem = stem.strip().strip(".").strip()
    if not stem:
        raise UploadRejected(400, "bad_filename", "That file name can't be used")
    budget = MAX_FILENAME_BYTES - len(extension.encode("utf-8"))
    while len(stem.encode("utf-8")) > budget:
        stem = stem[:-1]
    stem = stem.rstrip(" .") or "video"
    candidate = stem + extension
    if candidate.casefold() in RESERVED_NAMES or stem.casefold() in RESERVED_NAMES:
        raise UploadRejected(400, "bad_filename", "That file name can't be used")
    return candidate


def validate_metadata(raw: Optional[str]) -> UploadMetadata:
    fields = parse_metadata_header(raw)
    original = fields.get("filename")
    if not original:
        raise UploadRejected(400, "filename_required", "A file name is required")
    filename = sanitize_filename(original)
    filetype = fields.get("filetype") or None
    if filetype is not None and not (
        len(filetype) <= 100 and re.match(r"^video/[A-Za-z0-9.+-]+$", filetype)
    ):
        raise UploadRejected(415, "unsupported_type", "Only .mp4 and .mov can be sent.")
    modified: Optional[int] = None
    if fields.get("lastModified"):
        try:
            modified = int(fields["lastModified"])
        except ValueError as exc:
            raise UploadRejected(400, "metadata_invalid", "Malformed lastModified") from exc
        if not 0 <= modified <= 32_503_680_000_000:  # year 3000, in ms
            raise UploadRejected(400, "metadata_invalid", "lastModified is out of range")
    return UploadMetadata(
        filename=filename,
        original_filename=unicodedata.normalize("NFC", original)[:255],
        filetype=filetype,
        client_last_modified=modified,
    )
