from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy


IMAGE_TYPES = ["png", "jpg", "jpeg", "webp", "gif"]
IMAGE_TARGETS = ["png", "jpg", "jpeg", "webp", "gif"]
MARKDOWN_TARGETS = ["pdf", "docx", "png", "jpg", "jpeg", "tiff"]


# Canonical public capability catalog for the first SuperDoc flow:
# upload -> choose Edit or Convert -> open a client editor or run a backend job.
#
# Operations intentionally not exposed here:
# - PDF merge/split/rotate/compress/annotate backend edits
# - PPT/PPTX -> PDF
# - OCR, PPT/PPTX, video processing, paid jobs
# - multi-file flows
#
# Those handlers/infrastructure can exist in the repo, but the public catalog
# should only advertise routes the current UI can execute correctly.
OPERATIONS: dict[str, dict] = {
    "pdf_edit": {
        "intent": "edit",
        "kind": "client_editor",
        "input_types": ["pdf"],
        "output_type": "pdf",
        "targets": ["pdf"],
        "editor_route": "/editor/pdf",
        "requires_multiple": False,
        "params_schema": {},
        "category": "edit",
        "label": "Edit PDF",
    },
    "doc_edit": {
        "intent": "edit",
        "kind": "client_editor",
        "input_types": ["docx"],
        "output_type": "docx",
        "targets": ["docx"],
        "editor_route": "/editor/docx",
        "requires_multiple": False,
        "params_schema": {},
        "category": "edit",
        "label": "Edit Word document",
    },
    "xlsx_edit": {
        "intent": "edit",
        "kind": "client_editor",
        "input_types": ["xlsx"],
        "output_type": "xlsx",
        "targets": ["xlsx"],
        "editor_route": "/editor/xlsx",
        "requires_multiple": False,
        "params_schema": {},
        "category": "edit",
        "label": "Edit spreadsheet",
    },
    "image_edit": {
        "intent": "edit",
        "kind": "client_editor",
        "input_types": IMAGE_TYPES,
        "output_type": "same",
        "targets": IMAGE_TYPES,
        "editor_route": "/editor/image",
        "requires_multiple": False,
        "params_schema": {},
        "category": "edit",
        "label": "Edit image",
    },
    "pdf_to_docx": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "docx",
        "targets": ["docx"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "PDF to Word (.docx)",
        "lambda_suffix": "pdf-to-docx",
    },
    "pdf_to_txt": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "txt",
        "targets": ["txt"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "PDF to Text (.txt)",
        "lambda_suffix": "pdf-to-txt",
    },
    "pdf_to_image": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "zip",
        "targets": ["png"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "dpi": {
                "type": "integer",
                "default": 150,
                "minimum": 72,
                "maximum": 300,
            }
        },
        "category": "convert",
        "label": "PDF to PNG images (.zip)",
        "lambda_suffix": "pdf-to-image",
    },
    "image_to_pdf": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": IMAGE_TYPES,
        "output_type": "pdf",
        "targets": ["pdf"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "Image to PDF",
        "lambda_suffix": "image-to-pdf",
    },
    "image_convert": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": IMAGE_TYPES,
        "output_type": "image",
        "targets": IMAGE_TARGETS,
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "target_format": {
                "type": "string",
                "required": True,
                "enum": IMAGE_TARGETS,
            }
        },
        "category": "convert",
        "label": "Convert image format",
        "lambda_suffix": "image-convert",
    },
    "markdown_convert": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["md", "txt"],
        "output_type": "document",
        "targets": MARKDOWN_TARGETS,
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "target_format": {
                "type": "string",
                "required": True,
                "enum": MARKDOWN_TARGETS,
            }
        },
        "category": "convert",
        "label": "Convert Markdown",
        "lambda_suffix": "markdown-convert",
    },
    "docx_to_txt": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["docx"],
        "output_type": "txt",
        "targets": ["txt"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "Word to Text (.txt)",
        "lambda_suffix": "docx-to-txt",
    },
    "docx_to_pdf": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["docx"],
        "output_type": "pdf",
        "targets": ["pdf"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "Word to PDF",
        "lambda_suffix": "docx-to-pdf",
    },
    "xlsx_to_csv": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["xlsx"],
        "output_type": "csv",
        "targets": ["csv"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "sheet": {
                "type": "string",
                "required": False,
                "maxLength": 64,
                "default": "",
            }
        },
        "category": "convert",
        "label": "Excel to CSV (first sheet)",
        "lambda_suffix": "xlsx-to-csv",
    },
    "xlsx_to_pdf": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["xlsx"],
        "output_type": "pdf",
        "targets": ["pdf"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "sheet": {
                "type": "string",
                "required": False,
                "maxLength": 64,
                "default": "",
            }
        },
        "category": "convert",
        "label": "Excel to PDF",
        "lambda_suffix": "xlsx-to-pdf",
    },
}


OPERATION_FUNCTION_SUFFIX: dict[str, str] = {}
for _op, _meta in OPERATIONS.items():
    if _meta["kind"] in ("backend_job", "paid_backend_job"):
        OPERATION_FUNCTION_SUFFIX[_op] = _meta["lambda_suffix"]


def is_supported(operation: str) -> bool:
    """Return whether operation is a known public operation id."""
    return operation in OPERATIONS


def list_operations(input_type: str | None = None) -> list[dict]:
    """Return the public-facing catalog, optionally filtered by input type."""
    ext = None
    if input_type is not None:
        ext = input_type.lower().lstrip(".")

    results: list[dict] = []
    for op, meta in OPERATIONS.items():
        if ext is not None and ext not in meta["input_types"]:
            continue
        results.append({
            "operation": op,
            "intent": meta["intent"],
            "kind": meta["kind"],
            "label": meta["label"],
            "category": meta["category"],
            "input_types": list(meta["input_types"]),
            "output_type": meta["output_type"],
            "targets": list(meta["targets"]),
            "editor_route": meta.get("editor_route"),
            "requires_multiple": bool(meta.get("requires_multiple", False)),
            "params_schema": deepcopy(meta.get("params_schema", {})),
        })
    return results


@dataclass(frozen=True)
class ValidationResult:
    """Returned by validate_params. Frozen so callers can't mutate it."""

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


def _one_of(value: object, *, name: str, allowed: set[str], required: bool = False) -> tuple[bool, str]:
    if value is None or value == "":
        if required:
            return False, f"{name} is required"
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
    if params is None:
        params = {}

    if not isinstance(params, dict):
        return ValidationResult(ok=False, error="params must be an object")

    cleaned: dict = {}

    if operation in ("image_convert", "markdown_convert"):
        allowed = IMAGE_TARGETS if operation == "image_convert" else MARKDOWN_TARGETS
        ok_flag, err_msg = _one_of(
            params.get("target_format"),
            name="target_format",
            allowed=set(allowed),
            required=True,
        )
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        cleaned["target_format"] = params.get("target_format").lower()

    if operation == "pdf_to_image":
        raw_dpi = params.get("dpi", 150)
        ok_flag, err_msg = _int_range(raw_dpi, name="dpi", lo=72, hi=300)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        cleaned["dpi"] = int(raw_dpi)

    if operation in ("xlsx_to_csv", "xlsx_to_pdf"):
        ok_flag, err_msg = _limit_str(params.get("sheet"), name="sheet", max_len=64)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("sheet"):
            cleaned["sheet"] = params.get("sheet")

    return ValidationResult(ok=True, params=cleaned)
