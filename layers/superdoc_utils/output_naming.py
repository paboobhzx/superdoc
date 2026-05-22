from __future__ import annotations

import os
import re

import operations


_SAFE_CHARS = re.compile(r"[^A-Za-z0-9._ -]+")
_PARENS = re.compile(r"\s*\([^)]*\)")
_SPACE = re.compile(r"\s+")


def operation_label(operation: str | None) -> str:
    meta = operations.OPERATIONS.get(operation or "", {})
    label = str(meta.get("label") or operation or "Output").replace("_", " ").strip()
    return _SPACE.sub(" ", label).title() if label == (operation or "") else label


def sanitize_filename_part(value: str, fallback: str) -> str:
    cleaned = _SAFE_CHARS.sub("", str(value or ""))
    cleaned = _SPACE.sub(" ", cleaned).strip(" ._-")
    return cleaned or fallback


def original_stem(body: dict | None, file_key: str | None, fallback: str = "document") -> str:
    body = body or {}
    original = body.get("file_name") or os.path.basename(file_key or "") or fallback
    stem, _ext = os.path.splitext(os.path.basename(original))
    return sanitize_filename_part(stem, fallback)


def output_filename(operation: str, body: dict | None, file_key: str | None, extension: str) -> str:
    ext = str(extension or "").lstrip(".") or "out"
    label = sanitize_filename_part(_PARENS.sub("", operation_label(operation)), "Output")
    stem = original_stem(body, file_key)
    return f"{label} - {stem}.{ext}"
