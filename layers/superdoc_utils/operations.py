from __future__ import annotations

from dataclasses import dataclass


# Structured catalog of operations offered by SuperDoc.
#
# Why this shape:
#   - The frontend's operation picker needs to know which operations accept a
#     given input type (e.g. "I just dropped a PDF - what can I do?"). A flat
#     dict of op -> lambda_suffix (the old shape) doesn't carry that info.
#   - Keeping label/category here means adding a new op is one place to edit:
#     this dict + the handler + Terraform module. No frontend change needed.
#   - output_type drives download naming on the frontend.
OPERATIONS: dict[str, dict] = {
    "pdf_compress": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "optimize",
        "label": "Compress PDF",
        "lambda_suffix": "pdf-compress",
    },
    "pdf_merge": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Merge PDFs",
        "lambda_suffix": "pdf-merge",
    },
    "pdf_split": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Split PDF",
        "lambda_suffix": "pdf-split",
    },
    "pdf_to_docx": {
        "input_types": ["pdf"],
        "output_type": "docx",
        "category": "convert",
        "label": "PDF to Word (.docx)",
        "lambda_suffix": "pdf-to-docx",
    },
    "pdf_to_txt": {
        "input_types": ["pdf"],
        "output_type": "txt",
        "category": "convert",
        "label": "PDF to Text (.txt)",
        "lambda_suffix": "pdf-to-txt",
    },
    "pdf_rotate": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Rotate PDF pages",
        "lambda_suffix": "pdf-rotate",
    },
    "pdf_annotate": {
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Add watermark to PDF",
        "lambda_suffix": "pdf-annotate",
    },
    "pdf_extract_text": {
        "input_types": ["pdf"],
        "output_type": "json",
        "category": "extract",
        "label": "Extract structured text (JSON)",
        "lambda_suffix": "pdf-extract-text",
    },
    "image_convert": {
        "input_types": ["png", "jpg", "jpeg", "webp", "gif"],
        "output_type": "image",
        "category": "convert",
        "label": "Convert image format",
        "lambda_suffix": "image-convert",
    },
    "doc_edit": {
        "input_types": ["docx", "xlsx"],
        "output_type": "same",
        "category": "edit",
        "label": "Edit document content",
        "lambda_suffix": "doc-edit",
    },
    "video_process": {
        "input_types": ["mp4", "mov", "avi", "mkv", "webm"],
        "output_type": "mp4",
        "category": "convert",
        "label": "Process video",
        "lambda_suffix": "video-process",
    },
}


# Kept alongside OPERATIONS so dispatcher code that only needs the suffix
# lookup doesn't have to reach into the full metadata dict. Consumers stay
# simple; the map is just a projection of OPERATIONS built once at import.
OPERATION_FUNCTION_SUFFIX: dict[str, str] = {}
for _op, _meta in OPERATIONS.items():
    OPERATION_FUNCTION_SUFFIX[_op] = _meta["lambda_suffix"]


def is_supported(operation: str) -> bool:
    """Return whether operation is a known operation id.

    Used by create_job to reject unknown operations. Kept as a dedicated
    function (not inline `op in OPERATIONS`) so callers don't couple to the
    dict structure - storage can change later without breaking create_job.
    """
    return operation in OPERATIONS


def list_operations(input_type: str | None = None) -> list[dict]:
    """Return the public-facing catalog, optionally filtered by input type.

    This is what the GET /operations endpoint returns. lambda_suffix is
    stripped from the response: that's an internal implementation detail
    and exposing Lambda function names would hint at our infrastructure
    to anyone scanning the API.
    """
    ext = None
    if input_type is not None:
        ext = input_type.lower().lstrip(".")

    results: list[dict] = []
    for op, meta in OPERATIONS.items():
        if ext is not None and ext not in meta["input_types"]:
            continue
        results.append({
            "operation": op,
            "label": meta["label"],
            "category": meta["category"],
            "input_types": meta["input_types"],
            "output_type": meta["output_type"],
        })
    return results


@dataclass(frozen=True)
class ValidationResult:
    """Returned by validate_params. Frozen so callers can't mutate it
    accidentally after it leaves the validation layer."""

    ok: bool
    error: str = ""
    params: dict | None = None


def _limit_str(value: object, *, name: str, max_len: int) -> tuple[bool, str]:
    """Validate that value is either None or a string up to max_len chars.

    Returns (ok, error_message). Split out of validate_params to keep the
    per-op branches readable and to allow reuse. The two-tuple return acts
    as a tiny result type - we avoid raising inside the hot validation path
    because raising is slower than returning in CPython.
    """
    if value is None:
        return True, ""
    if not isinstance(value, str):
        return False, f"{name} must be a string"
    if len(value) > max_len:
        return False, f"{name} is too long (max {max_len})"
    return True, ""


def _one_of(value: object, *, name: str, allowed: set[str]) -> tuple[bool, str]:
    """Validate that value is either None or one of allowed (case-insensitive)."""
    if value is None:
        return True, ""
    if not isinstance(value, str):
        return False, f"{name} must be a string"
    allowed_lower: set[str] = set()
    for item in allowed:
        allowed_lower.add(item.lower())
    if value.lower() not in allowed_lower:
        return False, f"{name} must be one of: {', '.join(sorted(allowed))}"
    return True, ""


def validate_params(operation: str, params: dict | None) -> ValidationResult:
    """Whitelist-validate params for operation.

    Unknown keys are silently dropped - this prevents clients from smuggling
    arbitrary payload into worker Lambdas through fields the workers don't
    expect. Security-by-default.
    """
    if not params:
        return ValidationResult(ok=True, params={})

    if not isinstance(params, dict):
        return ValidationResult(ok=False, error="params must be an object")

    cleaned: dict = {}

    if operation == "pdf_annotate":
        ok_flag, err_msg = _limit_str(params.get("watermark_text"), name="watermark_text", max_len=120)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("watermark_text") is not None:
            cleaned["watermark_text"] = params.get("watermark_text")

    if operation == "image_convert":
        ok_flag, err_msg = _one_of(
            params.get("target_format"),
            name="target_format",
            allowed={"png", "jpg", "jpeg", "webp", "gif"},
        )
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("target_format") is not None:
            cleaned["target_format"] = params.get("target_format")

    if operation == "doc_edit":
        # docx find/replace
        ok_flag, err_msg = _limit_str(params.get("find_text"), name="find_text", max_len=200)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        ok_flag, err_msg = _limit_str(params.get("replace_text"), name="replace_text", max_len=200)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("find_text") is not None:
            cleaned["find_text"] = params.get("find_text")
        if params.get("replace_text") is not None:
            cleaned["replace_text"] = params.get("replace_text")

        # xlsx set-cell
        ok_flag, err_msg = _limit_str(params.get("sheet"), name="sheet", max_len=64)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        ok_flag, err_msg = _limit_str(params.get("cell"), name="cell", max_len=10)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        ok_flag, err_msg = _limit_str(params.get("value"), name="value", max_len=200)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("sheet") is not None:
            cleaned["sheet"] = params.get("sheet")
        if params.get("cell") is not None:
            cleaned["cell"] = params.get("cell")
        if params.get("value") is not None:
            cleaned["value"] = params.get("value")

    # Unknown keys silently dropped per the docstring.
    return ValidationResult(ok=True, params=cleaned)
