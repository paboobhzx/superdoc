from __future__ import annotations

from dataclasses import dataclass


# Structured catalog of operations offered by SuperDoc.
#
# The `kind` field drives routing on the frontend:
#   - "backend_job":      create job, dispatch to worker Lambda, poll status.
#                         The vast majority of ops.
#   - "client_editor":    don't process; upload file, redirect to a WYSIWYG
#                         editor page. Used for doc_edit today. The editor
#                         loads the file from S3 via the key query param.
#   - "paid_backend_job": same as backend_job but gated behind Stripe checkout
#                         before dispatch. Currently no ops use this - the
#                         Stripe infrastructure ships dormant in script 3a-2.
OPERATIONS: dict[str, dict] = {
    "pdf_compress": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "optimize",
        "label": "Compress PDF",
        "lambda_suffix": "pdf-compress",
    },
    "pdf_merge": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Merge PDFs",
        "lambda_suffix": "pdf-merge",
    },
    "pdf_split": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Split PDF",
        "lambda_suffix": "pdf-split",
    },
    "pdf_to_docx": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "docx",
        "category": "convert",
        "label": "PDF to Word (.docx)",
        "lambda_suffix": "pdf-to-docx",
    },
    "pdf_to_txt": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "txt",
        "category": "convert",
        "label": "PDF to Text (.txt)",
        "lambda_suffix": "pdf-to-txt",
    },
    "pdf_to_image": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "zip",
        "category": "convert",
        "label": "PDF to Images (PNG per page)",
        "lambda_suffix": "pdf-to-image",
    },
    "pdf_rotate": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Rotate PDF pages",
        "lambda_suffix": "pdf-rotate",
    },
    "pdf_annotate": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "pdf",
        "category": "edit",
        "label": "Add watermark to PDF",
        "lambda_suffix": "pdf-annotate",
    },
    "pdf_extract_text": {
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "json",
        "category": "extract",
        "label": "Extract structured text (JSON)",
        "lambda_suffix": "pdf-extract-text",
    },
    "image_convert": {
        "kind": "backend_job",
        "input_types": ["png", "jpg", "jpeg", "webp", "gif"],
        "output_type": "image",
        "category": "convert",
        "label": "Convert image format",
        "lambda_suffix": "image-convert",
    },
    "image_to_pdf": {
        "kind": "backend_job",
        "input_types": ["png", "jpg", "jpeg", "webp", "gif"],
        "output_type": "pdf",
        "category": "convert",
        "label": "Image to PDF",
        "lambda_suffix": "image-to-pdf",
    },
    "doc_edit": {
        # doc_edit is a WYSIWYG editor hosted on the frontend. The picker
        # needs to send the user to /editor/docx (or /editor/xlsx) instead
        # of the processing pipeline. The DOCX flavor uses TipTap to
        # preserve formatting; XLSX still uses a simple cell editor.
        "kind": "client_editor",
        "input_types": ["docx", "xlsx"],
        "output_type": "same",
        "category": "edit",
        "label": "Edit document",
        "lambda_suffix": "doc-edit",
    },
    "docx_to_txt": {
        "kind": "backend_job",
        "input_types": ["docx"],
        "output_type": "txt",
        "category": "convert",
        "label": "Word to Text (.txt)",
        "lambda_suffix": "docx-to-txt",
    },
    "xlsx_to_csv": {
        "kind": "backend_job",
        "input_types": ["xlsx"],
        "output_type": "csv",
        "category": "convert",
        "label": "Excel to CSV (first sheet)",
        "lambda_suffix": "xlsx-to-csv",
    },
    "video_process": {
        "kind": "backend_job",
        "input_types": ["mp4", "mov", "avi", "mkv", "webm"],
        "output_type": "mp4",
        "category": "convert",
        "label": "Process video",
        "lambda_suffix": "video-process",
    },
}


# Kept alongside OPERATIONS so dispatcher code that only needs the suffix
# lookup doesn't have to reach into the full metadata dict.
OPERATION_FUNCTION_SUFFIX: dict[str, str] = {}
for _op, _meta in OPERATIONS.items():
    OPERATION_FUNCTION_SUFFIX[_op] = _meta["lambda_suffix"]


def is_supported(operation: str) -> bool:
    """Return whether operation is a known operation id."""
    return operation in OPERATIONS


def list_operations(input_type: str | None = None) -> list[dict]:
    """Return the public-facing catalog, optionally filtered by input type.

    Strips `lambda_suffix` from the response; that's an internal detail the
    frontend shouldn't need. `kind` is exposed because the frontend picker
    uses it to route (editor vs backend vs paid).
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
            "kind": meta["kind"],
            "label": meta["label"],
            "category": meta["category"],
            "input_types": meta["input_types"],
            "output_type": meta["output_type"],
        })
    return results


@dataclass(frozen=True)
class ValidationResult:
    """Returned by validate_params. Frozen so callers can't mutate it."""

    ok: bool
    error: str = ""
    params: dict | None = None


def _limit_str(value: object, *, name: str, max_len: int) -> tuple[bool, str]:
    """Validate that value is either None or a string up to max_len chars."""
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


def _int_range(value: object, *, name: str, lo: int, hi: int) -> tuple[bool, str]:
    """Validate that value is either None or an int in [lo, hi]."""
    if value is None:
        return True, ""
    try:
        coerced = int(value)
    except (TypeError, ValueError):
        return False, f"{name} must be an integer"
    if coerced < lo or coerced > hi:
        return False, f"{name} must be between {lo} and {hi}"
    return True, ""


def validate_params(operation: str, params: dict | None) -> ValidationResult:
    """Whitelist-validate params for operation. Unknown keys are dropped."""
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

    if operation == "pdf_to_image":
        # DPI between 72 (web) and 300 (print). Default handled in worker.
        ok_flag, err_msg = _int_range(params.get("dpi"), name="dpi", lo=72, hi=300)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("dpi") is not None:
            cleaned["dpi"] = int(params.get("dpi"))

    if operation == "xlsx_to_csv":
        # Optional sheet name; defaults to the first sheet.
        ok_flag, err_msg = _limit_str(params.get("sheet"), name="sheet", max_len=64)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("sheet") is not None:
            cleaned["sheet"] = params.get("sheet")

    if operation == "doc_edit":
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

    return ValidationResult(ok=True, params=cleaned)
