"""Shared OCR orchestrator for scanned PDF pages.

Renders specific pages to images, runs OCR (Tesseract preferred, Textract fallback),
and returns word-level bounding boxes in PDF-point coordinates.  This module is consumed
by pdf_to_xls (needs bbox for table reconstruction) and pdf_to_docx (needs lines).

Coordinate contract: all positions are in PDF points (1 pt = 1/72 inch), measured from
the top-left corner of the page.  Callers like ``_rows_from_words`` in pdf_to_xls.py
expect dicts with keys ``text``, ``top``, ``x0`` — use ``OcrWord.to_pdfplumber_dict()``.
"""

from __future__ import annotations

import csv
import io
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field

from logger import log_event

_MAX_PAGES = 50
_DEFAULT_DPI = 200  # 200 gives better accuracy for small numbers vs 150


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class OcrWord:
    """Single recognised word with bounding box in PDF points."""

    text: str
    top: float
    x0: float
    x1: float
    bottom: float

    def to_pdfplumber_dict(self) -> dict:
        """Return a dict compatible with ``_rows_from_words`` in pdf_to_xls."""
        return {"text": self.text, "top": self.top, "x0": self.x0,
                "x1": self.x1, "bottom": self.bottom}


@dataclass(frozen=True)
class OcrPageResult:
    """OCR output for a single PDF page."""

    page_index: int
    words: list[OcrWord] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)
    source: str = "skipped"  # "tesseract" | "textract" | "skipped"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def ocr_pdf_pages(
    pdf_bytes: bytes,
    page_indices: list[int] | None = None,
    dpi: int = _DEFAULT_DPI,
) -> list[OcrPageResult]:
    """Rasterize selected pages and run OCR, returning words with bbox."""
    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if page_indices is None:
            page_indices = list(range(doc.page_count))

        if len(page_indices) > _MAX_PAGES:
            raise ValueError(
                f"Too many pages for OCR ({len(page_indices)}); max is {_MAX_PAGES}"
            )

        results: list[OcrPageResult] = []
        for idx in page_indices:
            try:
                page = doc.load_page(idx)
                page_rect = page.rect
                image_bytes = _rasterize_page(page, dpi)

                log_event("info", "ocr_page_rasterized", None,
                          page_index=idx, dpi=dpi,
                          image_bytes=len(image_bytes),
                          page_width_pts=round(page_rect.width, 1),
                          page_height_pts=round(page_rect.height, 1))

                words, source = _extract_words(
                    image_bytes, page_rect.width, page_rect.height, dpi, idx
                )
                lines = _words_to_lines(words)

                log_event("info", "ocr_page_done", None,
                          page_index=idx, source=source,
                          word_count=len(words), line_count=len(lines))

                results.append(OcrPageResult(
                    page_index=idx, words=words, lines=lines, source=source,
                ))
            except Exception as exc:
                log_event("error", "ocr_page_exception", None,
                          page_index=idx, error=str(exc))
                results.append(OcrPageResult(page_index=idx))
        return results
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Rasterize
# ---------------------------------------------------------------------------

def _rasterize_page(page, dpi: int) -> bytes:
    """Render a pymupdf page to PNG bytes at the given DPI."""
    scale = dpi / 72.0
    import pymupdf
    mat = pymupdf.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat)
    return pix.tobytes("png")


# ---------------------------------------------------------------------------
# Word extraction — Tesseract TSV preferred, Textract fallback
# ---------------------------------------------------------------------------

def _extract_words(
    image_bytes: bytes,
    page_width_pts: float,
    page_height_pts: float,
    dpi: int,
    page_index: int = -1,
) -> tuple[list[OcrWord], str]:
    """Try Tesseract TSV, fall back to Textract.  Returns (words, source).

    Falls through to Textract when Tesseract is unavailable OR returns no
    words (e.g. wrong language model -> low confidence -> all filtered out).
    """
    tesseract_path = shutil.which(os.environ.get("TESSERACT_BIN", "tesseract"))
    tesseract_lang = os.environ.get("TESSERACT_LANG", "eng")

    log_event("info", "ocr_extract_start", None,
              page_index=page_index,
              tesseract_available=tesseract_path is not None,
              tesseract_path=tesseract_path or "not_found",
              tesseract_lang=tesseract_lang,
              image_bytes=len(image_bytes),
              dpi=dpi)

    words = _extract_words_tesseract_tsv(image_bytes, dpi, page_index)
    if words:  # None (not found) or [] (no usable words) both fall through
        log_event("info", "ocr_tesseract_success", None,
                  page_index=page_index, word_count=len(words))
        return words, "tesseract"

    log_event("info", "ocr_fallback_to_textract", None,
              page_index=page_index,
              tesseract_result="none" if words is None else "empty_after_filter")

    words = _extract_words_textract(image_bytes, page_width_pts, page_height_pts, page_index)
    log_event("info", "ocr_textract_result", None,
              page_index=page_index, word_count=len(words))
    return words, "textract"


def _extract_words_tesseract_tsv(
    image_bytes: bytes, dpi: int, page_index: int = -1,
) -> list[OcrWord] | None:
    """Run Tesseract in TSV mode, parse word-level bboxes.

    Returns None if Tesseract is unavailable or fails, triggering Textract fallback.
    """
    tesseract = shutil.which(os.environ.get("TESSERACT_BIN", "tesseract"))
    if not tesseract:
        return None

    timeout = int(os.environ.get("OCR_TESSERACT_TIMEOUT_SECONDS", "60"))
    lang = os.environ.get("TESSERACT_LANG", "eng")

    with tempfile.NamedTemporaryFile(suffix=".png") as fh:
        fh.write(image_bytes)
        fh.flush()
        try:
            completed = subprocess.run(
                [tesseract, fh.name, "stdout", "-l", lang, "tsv"],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            log_event("warning", "ocr_tesseract_timeout", None,
                      page_index=page_index, timeout=timeout)
            return None

    if completed.returncode != 0:
        log_event("warning", "ocr_tesseract_nonzero_exit", None,
                  page_index=page_index, returncode=completed.returncode,
                  stderr=completed.stderr.decode("utf-8", errors="replace")[:500])
        return None

    scale = 72.0 / dpi
    words: list[OcrWord] = []
    tsv_rows_total = 0
    tsv_rows_above_conf = 0

    reader = csv.DictReader(
        io.StringIO(completed.stdout.decode("utf-8", errors="replace")),
        delimiter="\t",
    )
    for row in reader:
        text = (row.get("text") or "").strip()
        if not text:
            continue
        tsv_rows_total += 1
        try:
            conf = int(float(row.get("conf", "-1")))
        except (ValueError, TypeError):
            conf = -1
        if conf < 30:
            continue
        tsv_rows_above_conf += 1

        left = int(row.get("left", 0))
        top = int(row.get("top", 0))
        width = int(row.get("width", 0))
        height = int(row.get("height", 0))

        words.append(OcrWord(
            text=text,
            x0=left * scale,
            top=top * scale,
            x1=(left + width) * scale,
            bottom=(top + height) * scale,
        ))

    log_event("info", "ocr_tesseract_tsv_parsed", None,
              page_index=page_index,
              tsv_rows_total=tsv_rows_total,
              tsv_rows_above_confidence=tsv_rows_above_conf,
              words_returned=len(words))

    return words


def _extract_words_textract(
    image_bytes: bytes,
    page_width_pts: float,
    page_height_pts: float,
    page_index: int = -1,
) -> list[OcrWord]:
    """Use AWS Textract detect_document_text for word-level bboxes.

    Textract returns normalised [0,1] coordinates; we scale to PDF points.
    """
    import boto3

    client = boto3.client("textract")
    resp = client.detect_document_text(Document={"Bytes": image_bytes})

    blocks_total = len(resp.get("Blocks", []))
    words: list[OcrWord] = []
    for block in resp.get("Blocks", []):
        if block.get("BlockType") != "WORD":
            continue
        text = (block.get("Text") or "").strip()
        if not text:
            continue
        box = (block.get("Geometry") or {}).get("BoundingBox") or {}
        left = float(box.get("Left", 0))
        top = float(box.get("Top", 0))
        w = float(box.get("Width", 0))
        h = float(box.get("Height", 0))

        words.append(OcrWord(
            text=text,
            x0=left * page_width_pts,
            top=top * page_height_pts,
            x1=(left + w) * page_width_pts,
            bottom=(top + h) * page_height_pts,
        ))

    log_event("info", "ocr_textract_parsed", None,
              page_index=page_index,
              blocks_total=blocks_total,
              words_returned=len(words))

    return words


# ---------------------------------------------------------------------------
# Group words into reading-order lines
# ---------------------------------------------------------------------------

def _words_to_lines(words: list[OcrWord], y_tolerance: float = 5.0) -> list[str]:
    """Group words into lines by Y proximity, return text in reading order."""
    if not words:
        return []

    buckets: dict[int, list[OcrWord]] = {}
    for w in words:
        bucket = int(round(w.top / y_tolerance))
        buckets.setdefault(bucket, []).append(w)

    lines: list[str] = []
    for key in sorted(buckets):
        row_words = sorted(buckets[key], key=lambda w: w.x0)
        line = " ".join(w.text for w in row_words)
        if line.strip():
            lines.append(line)

    return lines
