from __future__ import annotations

from dataclasses import dataclass

from operation_constants import (
    DOCX_IMAGE_TARGETS,
    IMAGE_TARGETS,
    MARKDOWN_TARGETS,
    OCR_DOCUMENT_TARGETS,
    PDF_IMAGE_TARGETS,
)


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
    allowed_lower = {item.lower() for item in allowed}
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


def _bool_value(value: object, *, name: str) -> tuple[bool, str, bool | None]:
    if value is None:
        return True, "", None
    if isinstance(value, bool):
        return True, "", value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1", "yes", "on"):
            return True, "", True
        if lowered in ("false", "0", "no", "off"):
            return True, "", False
    return False, f"{name} must be a boolean", None


def validate_params(operation: str, params: dict | None) -> ValidationResult:
    """Whitelist-validate params for operation. Unknown keys are dropped."""
    if params is None:
        params = {}

    if not isinstance(params, dict):
        return ValidationResult(ok=False, error="params must be an object")

    cleaned: dict = {}

    if operation in ("image_convert", "markdown_convert", "image_to_document", "html_convert"):
        if operation == "image_convert":
            allowed = IMAGE_TARGETS
        elif operation == "image_to_document":
            allowed = OCR_DOCUMENT_TARGETS
        else:
            allowed = MARKDOWN_TARGETS
        ok_flag, err_msg = _one_of(
            params.get("target_format"),
            name="target_format",
            allowed=set(allowed),
            required=True,
        )
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        cleaned["target_format"] = params.get("target_format").lower()

    if operation in ("pdf_to_image", "docx_to_image", "xlsx_to_image"):
        raw_dpi = params.get("dpi", 150)
        ok_flag, err_msg = _int_range(raw_dpi, name="dpi", lo=72, hi=300)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        cleaned["dpi"] = int(raw_dpi)
        allowed = PDF_IMAGE_TARGETS if operation in ("pdf_to_image", "xlsx_to_image") else DOCX_IMAGE_TARGETS
        raw_target = params.get("target_format", "png")
        ok_flag, err_msg = _one_of(raw_target, name="target_format", allowed=set(allowed), required=True)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        cleaned["target_format"] = raw_target.lower()

    if operation in ("xlsx_to_csv", "xlsx_to_pdf", "xlsx_to_docx", "xlsx_to_image", "xlsx_to_html"):
        ok_flag, err_msg = _limit_str(params.get("sheet"), name="sheet", max_len=64)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if params.get("sheet"):
            cleaned["sheet"] = params.get("sheet")

    _PAPER_SIZES = {"A4", "A3", "Letter", "Legal", "A5"}
    if operation in ("docx_to_pdf", "docx_to_image", "xlsx_to_pdf", "xlsx_to_image"):
        raw_paper = params.get("paper_size")
        ok_flag, err_msg = _one_of(raw_paper, name="paper_size", allowed=_PAPER_SIZES)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if raw_paper:
            cleaned["paper_size"] = raw_paper

    if operation in ("docx_to_pdf", "xlsx_to_pdf", "pdf_to_docx"):
        raw_hf = params.get("high_fidelity")
        ok_flag, err_msg, parsed_hf = _bool_value(raw_hf, name="high_fidelity")
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if parsed_hf is not None:
            cleaned["high_fidelity"] = parsed_hf

    if operation == "pdf_to_docx":
        raw_pr = params.get("page_range")
        ok_flag, err_msg = _limit_str(raw_pr, name="page_range", max_len=200)
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if raw_pr and raw_pr.strip():
            cleaned["page_range"] = raw_pr.strip()

        raw_fs = params.get("fallback_strategy")
        ok_flag, err_msg = _one_of(
            raw_fs,
            name="fallback_strategy",
            allowed={"text", "image"},
        )
        if not ok_flag:
            return ValidationResult(ok=False, error=err_msg)
        if raw_fs:
            cleaned["fallback_strategy"] = raw_fs.lower()

    return ValidationResult(ok=True, params=cleaned)
