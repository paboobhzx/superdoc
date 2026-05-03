from __future__ import annotations

from copy import deepcopy

from operation_constants import (
    DOCX_IMAGE_TARGETS,
    HTML_TARGETS,
    IMAGE_TARGETS,
    IMAGE_TYPES,
    MARKDOWN_TARGETS,
    OCR_DOCUMENT_TARGETS,
    PDF_IMAGE_TARGETS,
)
from operation_validation import ValidationResult, validate_params


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
    "md_edit": {
        "intent": "edit",
        "kind": "client_editor",
        "input_types": ["md", "markdown", "txt"],
        "output_type": "md",
        "targets": ["md"],
        "editor_route": "/editor/markdown",
        "requires_multiple": False,
        "params_schema": {},
        "category": "edit",
        "label": "Edit Markdown",
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
    "pdf_to_md": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "md",
        "targets": ["md"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "PDF to Markdown (.md)",
        "lambda_suffix": "pdf-to-txt",
    },
    "pdf_to_html": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "html",
        "targets": ["html"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "PDF to HTML",
        "lambda_suffix": "pdf-to-txt",
    },
    "pdf_to_image": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["pdf"],
        "output_type": "zip",
        "targets": PDF_IMAGE_TARGETS,
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "dpi": {
                "type": "integer",
                "default": 150,
                "minimum": 72,
                "maximum": 300,
            },
            "target_format": {
                "type": "string",
                "required": True,
                "enum": PDF_IMAGE_TARGETS,
                "default": "png",
            },
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
    "image_to_document": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["png", "jpg", "jpeg"],
        "output_type": "document",
        "targets": OCR_DOCUMENT_TARGETS,
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "target_format": {
                "type": "string",
                "required": True,
                "enum": OCR_DOCUMENT_TARGETS,
            }
        },
        "category": "convert",
        "label": "Image OCR",
        "lambda_suffix": "image-convert",
    },
    "markdown_convert": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["md", "markdown", "txt"],
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
    "docx_to_md": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["docx"],
        "output_type": "md",
        "targets": ["md"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "Word to Markdown (.md)",
        "lambda_suffix": "docx-to-txt",
    },
    "docx_to_html": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["docx"],
        "output_type": "html",
        "targets": ["html"],
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {},
        "category": "convert",
        "label": "Word to HTML",
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
    "docx_to_image": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["docx"],
        "output_type": "zip",
        "targets": DOCX_IMAGE_TARGETS,
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "dpi": {
                "type": "integer",
                "default": 150,
                "minimum": 72,
                "maximum": 300,
            },
            "target_format": {
                "type": "string",
                "required": True,
                "enum": DOCX_IMAGE_TARGETS,
                "default": "png",
            },
        },
        "category": "convert",
        "label": "Word to images (.zip)",
        "lambda_suffix": "docx-to-pdf",
    },
    "xlsx_to_md": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["xlsx"],
        "output_type": "md",
        "targets": ["md"],
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
        "label": "Excel to Markdown (.md)",
        "lambda_suffix": "xlsx-to-csv",
    },
    "xlsx_to_txt": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["xlsx"],
        "output_type": "txt",
        "targets": ["txt"],
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
        "label": "Excel to Text (.txt)",
        "lambda_suffix": "xlsx-to-csv",
    },
    "xlsx_to_html": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["xlsx"],
        "output_type": "html",
        "targets": ["html"],
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
        "label": "Excel to HTML",
        "lambda_suffix": "xlsx-to-csv",
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
    "xlsx_to_docx": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["xlsx"],
        "output_type": "docx",
        "targets": ["docx"],
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
        "label": "Excel to Word (.docx)",
        "lambda_suffix": "xlsx-to-pdf",
    },
    "xlsx_to_image": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["xlsx"],
        "output_type": "zip",
        "targets": PDF_IMAGE_TARGETS,
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "sheet": {
                "type": "string",
                "required": False,
                "maxLength": 64,
                "default": "",
            },
            "dpi": {
                "type": "integer",
                "default": 150,
                "minimum": 72,
                "maximum": 300,
            },
            "target_format": {
                "type": "string",
                "required": True,
                "enum": PDF_IMAGE_TARGETS,
                "default": "png",
            },
        },
        "category": "convert",
        "label": "Excel to PNG images (.zip)",
        "lambda_suffix": "xlsx-to-pdf",
    },
    "html_convert": {
        "intent": "convert",
        "kind": "backend_job",
        "input_types": ["html", "htm"],
        "output_type": "document",
        "targets": HTML_TARGETS,
        "editor_route": None,
        "requires_multiple": False,
        "params_schema": {
            "target_format": {
                "type": "string",
                "required": True,
                "enum": HTML_TARGETS,
                "default": "txt",
            }
        },
        "category": "convert",
        "label": "Convert HTML",
        "lambda_suffix": "html-convert",
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
