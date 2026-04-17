from __future__ import annotations

from dataclasses import dataclass


OPERATION_FUNCTION_SUFFIX: dict[str, str] = {
    "pdf_compress": "pdf-compress",
    "pdf_merge": "pdf-merge",
    "pdf_split": "pdf-split",
    "pdf_to_docx": "pdf-to-docx",
    "pdf_rotate": "pdf-rotate",
    "pdf_annotate": "pdf-annotate",
    "pdf_extract_text": "pdf-extract-text",
    "image_convert": "image-convert",
    "doc_edit": "doc-edit",
    "video_process": "video-process",
}


def is_supported(operation: str) -> bool:
    return operation in OPERATION_FUNCTION_SUFFIX


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    error: str = ""
    params: dict | None = None


def _limit_str(value: object, *, name: str, max_len: int) -> tuple[bool, str]:
    if value is None:
        return True, ""
    if not isinstance(value, str):
        return False, f"{name} must be a string"
    if len(value) > max_len:
        return False, f"{name} is too long (max {max_len})"
    return True, ""


def _one_of(value: object, *, name: str, allowed: set[str]) -> tuple[bool, str]:
    if value is None:
        return True, ""
    if not isinstance(value, str):
        return False, f"{name} must be a string"
    if value.lower() not in {a.lower() for a in allowed}:
        return False, f"{name} must be one of: {', '.join(sorted(allowed))}"
    return True, ""


def validate_params(operation: str, params: dict | None) -> ValidationResult:
    if not params:
        return ValidationResult(ok=True, params={})

    if not isinstance(params, dict):
        return ValidationResult(ok=False, error="params must be an object")

    cleaned: dict = {}

    # Keep schemas minimal and permissive. Worker handlers read top-level keys.
    if operation == "pdf_annotate":
        ok, err = _limit_str(params.get("watermark_text"), name="watermark_text", max_len=120)
        if not ok:
            return ValidationResult(ok=False, error=err)
        if params.get("watermark_text") is not None:
            cleaned["watermark_text"] = params.get("watermark_text")

    if operation == "image_convert":
        ok, err = _one_of(
            params.get("target_format"),
            name="target_format",
            allowed={"png", "jpg", "jpeg", "webp", "gif"},
        )
        if not ok:
            return ValidationResult(ok=False, error=err)
        if params.get("target_format") is not None:
            cleaned["target_format"] = params.get("target_format")

    if operation == "doc_edit":
        # docx find/replace
        ok, err = _limit_str(params.get("find_text"), name="find_text", max_len=200)
        if not ok:
            return ValidationResult(ok=False, error=err)
        ok, err = _limit_str(params.get("replace_text"), name="replace_text", max_len=200)
        if not ok:
            return ValidationResult(ok=False, error=err)
        if params.get("find_text") is not None:
            cleaned["find_text"] = params.get("find_text")
        if params.get("replace_text") is not None:
            cleaned["replace_text"] = params.get("replace_text")

        # xlsx set cell
        ok, err = _limit_str(params.get("sheet"), name="sheet", max_len=64)
        if not ok:
            return ValidationResult(ok=False, error=err)
        ok, err = _limit_str(params.get("cell"), name="cell", max_len=10)
        if not ok:
            return ValidationResult(ok=False, error=err)
        ok, err = _limit_str(params.get("value"), name="value", max_len=200)
        if not ok:
            return ValidationResult(ok=False, error=err)
        if params.get("sheet") is not None:
            cleaned["sheet"] = params.get("sheet")
        if params.get("cell") is not None:
            cleaned["cell"] = params.get("cell")
        if params.get("value") is not None:
            cleaned["value"] = params.get("value")

    # Drop unknown keys to avoid smuggling unexpected payload into workers.
    return ValidationResult(ok=True, params=cleaned)

