"""Best-effort PDF extraction pipeline for DOCX/XLSX conversions.

This module is intentionally conservative. It does not try to classify every
possible document type. Instead, it extracts useful layers from each page:

1. native text/words from PyMuPDF;
2. native tables from pdfplumber, when available;
3. OCR words/lines from pdf_ocr_pages when native text is weak;
4. rendered page image for visual fallback;
5. simple key/value candidates for forms.

Coordinate contract:
- page coordinates are PDF points, top-left origin where possible;
- OCR words reuse pdf_ocr_pages' point coordinate contract;
- page_number is 1-based for external/reporting fields;
- page_index is 0-based internally.
"""

from __future__ import annotations

import io
import os
import re
from dataclasses import dataclass, field
from typing import Any

from logger import log_event

_ALLOWED_MODES = {"auto", "text", "tables", "visual"}
_DEFAULT_DPI = int(os.environ.get("PDF_EXTRACTION_RENDER_DPI", "160"))
_DEFAULT_OCR_DPI = int(os.environ.get("PDF_EXTRACTION_OCR_DPI", "200"))
_MIN_NATIVE_WORDS = int(os.environ.get("PDF_EXTRACTION_MIN_NATIVE_WORDS", "8"))
_MAX_OCR_PAGES = int(os.environ.get("PDF_EXTRACTION_MAX_OCR_PAGES", "50"))
_LINE_Y_TOLERANCE = float(os.environ.get("PDF_EXTRACTION_LINE_Y_TOLERANCE", "5.0"))

_KEY_VALUE_RE = re.compile(r"^\s*([^:]{2,60})\s*[:：]\s*(.{1,120})\s*$")
_SPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class ExtractedWord:
    text: str
    x0: float = 0.0
    top: float = 0.0
    x1: float = 0.0
    bottom: float = 0.0
    confidence: float | None = None
    source: str = "native"

    def to_row(self, page_number: int) -> list[Any]:
        return [
            page_number,
            self.source,
            self.text,
            round(self.x0, 2),
            round(self.top, 2),
            round(self.x1, 2),
            round(self.bottom, 2),
            self.confidence if self.confidence is not None else "",
        ]


@dataclass(frozen=True)
class ExtractedTable:
    rows: list[list[str]] = field(default_factory=list)
    source: str = "native"
    confidence: float = 0.0
    label: str = ""

    @property
    def non_empty_rows(self) -> int:
        return sum(1 for row in self.rows if any(str(cell or "").strip() for cell in row))


@dataclass(frozen=True)
class KeyValue:
    key: str
    value: str
    source: str = "heuristic"
    confidence: float = 0.4


@dataclass
class PageExtraction:
    page_index: int
    page_number: int
    width: float
    height: float
    mode_used: str = "unknown"
    native_text: str = ""
    text_lines: list[str] = field(default_factory=list)
    words: list[ExtractedWord] = field(default_factory=list)
    tables: list[ExtractedTable] = field(default_factory=list)
    key_values: list[KeyValue] = field(default_factory=list)
    rendered_png: bytes | None = None
    warnings: list[str] = field(default_factory=list)
    confidence: float = 0.0

    @property
    def has_text(self) -> bool:
        return any(line.strip() for line in self.text_lines) or bool(self.native_text.strip())

    @property
    def has_tables(self) -> bool:
        return any(table.non_empty_rows > 0 for table in self.tables)

    @property
    def word_count(self) -> int:
        return len([w for w in self.words if w.text.strip()])

    def summary_row(self) -> list[Any]:
        return [
            self.page_number,
            self.mode_used,
            self.word_count,
            len(self.text_lines),
            len(self.tables),
            round(self.confidence, 3),
            "; ".join(self.warnings),
        ]


@dataclass
class PdfExtractionResult:
    pages: list[PageExtraction] = field(default_factory=list)
    mode_requested: str = "auto"
    warnings: list[str] = field(default_factory=list)

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def has_any_text(self) -> bool:
        return any(page.has_text for page in self.pages)

    @property
    def has_any_table(self) -> bool:
        return any(page.has_tables for page in self.pages)


def normalize_extraction_mode(value: str | None) -> str:
    mode = str(value or "auto").strip().lower()
    return mode if mode in _ALLOWED_MODES else "auto"


def extract_pdf(
    pdf_bytes: bytes,
    *,
    extraction_mode: str = "auto",
    ocr_language: str | None = None,
    include_images: bool = True,
    job: dict | None = None,
) -> PdfExtractionResult:
    """Extract best-effort content from a PDF.

    This function must not raise for ordinary extraction failures on one page.
    It should record warnings and keep processing remaining pages. It may raise
    for invalid PDFs, encrypted PDFs that cannot be opened, or global runtime
    problems.
    """
    import pymupdf

    mode = normalize_extraction_mode(extraction_mode)
    result = PdfExtractionResult(mode_requested=mode)
    plumber_tables = _extract_pdfplumber_tables(pdf_bytes)

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        ocr_budget = _MAX_OCR_PAGES
        for page_index in range(doc.page_count):
            page = doc.load_page(page_index)
            page_result = PageExtraction(
                page_index=page_index,
                page_number=page_index + 1,
                width=float(page.rect.width),
                height=float(page.rect.height),
            )
            try:
                native_text = page.get_text("text") or ""
                native_words = _native_words_from_pymupdf(page)
                native_lines = _lines_from_text(native_text)
                native_tables = plumber_tables.get(page_index, [])

                page_result.native_text = native_text
                page_result.words = native_words
                page_result.text_lines = native_lines
                page_result.tables.extend(native_tables)

                needs_ocr = _should_ocr_page(
                    mode=mode,
                    native_text=native_text,
                    native_words=native_words,
                    native_tables=native_tables,
                )

                if needs_ocr and ocr_budget > 0:
                    ocr_budget -= 1
                    _merge_ocr_into_page(pdf_bytes, page_result, ocr_language=ocr_language)
                elif needs_ocr and ocr_budget <= 0:
                    page_result.warnings.append("OCR skipped because OCR page cap was reached")

                if mode in ("auto", "tables") and not page_result.has_tables and page_result.words:
                    guessed = _table_from_words(page_result.words)
                    if guessed.non_empty_rows >= 2:
                        page_result.tables.append(guessed)

                page_result.key_values = _extract_key_values(page_result.text_lines)

                if include_images and _should_render_image(mode, page_result):
                    page_result.rendered_png = _render_page_png(page, dpi=_DEFAULT_DPI)

                page_result.mode_used = _decide_mode_used(page_result)
                page_result.confidence = _estimate_page_confidence(page_result)

                if not page_result.has_text and not page_result.has_tables:
                    page_result.warnings.append("No reliable text or table content extracted")
                    if include_images and page_result.rendered_png is None:
                        page_result.rendered_png = _render_page_png(page, dpi=_DEFAULT_DPI)

                log_event(
                    "info",
                    "pdf_extraction_page_done",
                    job,
                    page_index=page_index,
                    mode_requested=mode,
                    mode_used=page_result.mode_used,
                    word_count=page_result.word_count,
                    table_count=len(page_result.tables),
                    confidence=page_result.confidence,
                    warning_count=len(page_result.warnings),
                )

            except Exception as exc:
                page_result.mode_used = "image_fallback"
                page_result.warnings.append(f"page extraction failed: {exc}")
                try:
                    if include_images:
                        page_result.rendered_png = _render_page_png(page, dpi=_DEFAULT_DPI)
                except Exception as image_exc:
                    page_result.warnings.append(f"page image fallback failed: {image_exc}")
                log_event("error", "pdf_extraction_page_failed", job, page_index=page_index, error=str(exc))

            result.pages.append(page_result)
    finally:
        doc.close()

    if not result.pages:
        result.warnings.append("PDF has no pages")
    if not result.has_any_text and not result.has_any_table:
        result.warnings.append("No extractable text or tables found in document")
    return result


def _lines_from_text(text: str) -> list[str]:
    return [_SPACE_RE.sub(" ", line).strip() for line in (text or "").splitlines() if line.strip()]


def _native_words_from_pymupdf(page) -> list[ExtractedWord]:
    words: list[ExtractedWord] = []
    try:
        for item in page.get_text("words") or []:
            if len(item) < 5:
                continue
            x0, y0, x1, y1, text = item[:5]
            text = str(text or "").strip()
            if text:
                words.append(ExtractedWord(text=text, x0=float(x0), top=float(y0), x1=float(x1), bottom=float(y1), source="native"))
    except Exception:
        return []
    return words


def _extract_pdfplumber_tables(pdf_bytes: bytes) -> dict[int, list[ExtractedTable]]:
    tables_by_page: dict[int, list[ExtractedTable]] = {}
    try:
        import pdfplumber
    except Exception:
        return tables_by_page

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for idx, page in enumerate(pdf.pages):
                page_tables: list[ExtractedTable] = []
                try:
                    for table in page.extract_tables() or []:
                        rows = [[str(cell or "").strip() for cell in row] for row in (table or [])]
                        if any(any(cell for cell in row) for row in rows):
                            page_tables.append(ExtractedTable(rows=rows, source="pdfplumber", confidence=0.75, label=f"page-{idx + 1}-table"))
                except Exception:
                    continue
                if page_tables:
                    tables_by_page[idx] = page_tables
    except Exception:
        return tables_by_page
    return tables_by_page


def _should_ocr_page(*, mode: str, native_text: str, native_words: list[ExtractedWord], native_tables: list[ExtractedTable]) -> bool:
    if mode == "visual":
        # Still OCR if native text is weak; visual mode changes output preference,
        # not extraction capability.
        return len(native_words) < _MIN_NATIVE_WORDS and len((native_text or "").strip()) < 40
    if mode == "tables" and native_tables:
        return False
    if len(native_words) >= _MIN_NATIVE_WORDS:
        return False
    if len((native_text or "").strip()) >= 40:
        return False
    return True


def _merge_ocr_into_page(pdf_bytes: bytes, page_result: PageExtraction, *, ocr_language: str | None = None) -> None:
    # pdf_ocr_pages currently reads language from environment. If per-job language
    # is required, the caller can temporarily set TESSERACT_LANG before invoking.
    from pdf_ocr_pages import ocr_pdf_pages

    previous_lang = os.environ.get("TESSERACT_LANG")
    if ocr_language:
        os.environ["TESSERACT_LANG"] = ocr_language
    try:
        ocr_results = ocr_pdf_pages(pdf_bytes, page_indices=[page_result.page_index], dpi=_DEFAULT_OCR_DPI)
    finally:
        if ocr_language:
            if previous_lang is None:
                os.environ.pop("TESSERACT_LANG", None)
            else:
                os.environ["TESSERACT_LANG"] = previous_lang

    ocr = ocr_results[0] if ocr_results else None
    if not ocr or not ocr.words:
        page_result.warnings.append("OCR returned no words")
        return

    page_result.words = [
        ExtractedWord(
            text=w.text,
            x0=float(w.x0),
            top=float(w.top),
            x1=float(w.x1),
            bottom=float(w.bottom),
            confidence=None,
            source=ocr.source or "ocr",
        )
        for w in ocr.words
        if str(w.text or "").strip()
    ]
    page_result.text_lines = list(ocr.lines or []) or _words_to_lines(page_result.words)


def _words_to_lines(words: list[ExtractedWord], y_tolerance: float = _LINE_Y_TOLERANCE) -> list[str]:
    if not words:
        return []
    ordered = sorted(words, key=lambda w: (w.top, w.x0))
    line_groups: list[list[ExtractedWord]] = []
    for word in ordered:
        if not line_groups:
            line_groups.append([word])
            continue
        avg_top = sum(w.top for w in line_groups[-1]) / len(line_groups[-1])
        if abs(word.top - avg_top) <= y_tolerance:
            line_groups[-1].append(word)
        else:
            line_groups.append([word])
    lines = []
    for group in line_groups:
        lines.append(" ".join(w.text for w in sorted(group, key=lambda w: w.x0)).strip())
    return [line for line in lines if line]


def _table_from_words(words: list[ExtractedWord]) -> ExtractedTable:
    """Simple semi-generic table reconstruction from word coordinates.

    This is not document-specific. It groups by Y into rows and uses large X gaps
    as column boundaries. It is intentionally conservative: the result is useful
    for spreadsheet inspection but not advertised as perfect layout recovery.
    """
    lines: list[list[ExtractedWord]] = []
    for word in sorted(words, key=lambda w: (w.top, w.x0)):
        if not lines:
            lines.append([word])
            continue
        avg_top = sum(w.top for w in lines[-1]) / len(lines[-1])
        if abs(word.top - avg_top) <= _LINE_Y_TOLERANCE:
            lines[-1].append(word)
        else:
            lines.append([word])

    rows: list[list[str]] = []
    for line in lines:
        ordered = sorted(line, key=lambda w: w.x0)
        if not ordered:
            continue
        cells: list[str] = []
        current: list[str] = [ordered[0].text]
        prev = ordered[0]
        median_height = _median([max(1.0, w.bottom - w.top) for w in ordered]) or 8.0
        gap_threshold = max(18.0, median_height * 2.7)
        for word in ordered[1:]:
            gap = word.x0 - prev.x1
            if gap > gap_threshold:
                cells.append(" ".join(current).strip())
                current = [word.text]
            else:
                current.append(word.text)
            prev = word
        cells.append(" ".join(current).strip())
        if any(cells):
            rows.append(cells)

    if len(rows) < 2:
        return ExtractedTable(rows=[], source="word-grid", confidence=0.0, label="guessed-table")

    max_cols = max(len(row) for row in rows)
    if max_cols < 2:
        return ExtractedTable(rows=[], source="word-grid", confidence=0.0, label="guessed-table")

    normalized = [row + [""] * (max_cols - len(row)) for row in rows]
    confidence = min(0.65, 0.25 + (max_cols * 0.08))
    return ExtractedTable(rows=normalized, source="word-grid", confidence=confidence, label="guessed-table")


def _extract_key_values(lines: list[str]) -> list[KeyValue]:
    pairs: list[KeyValue] = []
    for line in lines:
        match = _KEY_VALUE_RE.match(line)
        if match:
            key = _SPACE_RE.sub(" ", match.group(1)).strip(" .")
            value = _SPACE_RE.sub(" ", match.group(2)).strip()
            if key and value:
                pairs.append(KeyValue(key=key, value=value))
    return pairs


def _should_render_image(mode: str, page_result: PageExtraction) -> bool:
    if mode == "visual":
        return True
    if not page_result.has_text and not page_result.has_tables:
        return True
    if page_result.confidence and page_result.confidence < 0.25:
        return True
    return False


def _render_page_png(page, *, dpi: int = _DEFAULT_DPI) -> bytes:
    import pymupdf

    matrix = pymupdf.Matrix(dpi / 72.0, dpi / 72.0)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    return pix.tobytes("png")


def _decide_mode_used(page: PageExtraction) -> str:
    if page.has_tables:
        return "table"
    if any(w.source != "native" for w in page.words):
        return "ocr_text"
    if page.has_text:
        return "native_text"
    if page.rendered_png:
        return "image_fallback"
    return "empty"


def _estimate_page_confidence(page: PageExtraction) -> float:
    score = 0.0
    if page.has_text:
        score += 0.35
    if page.word_count >= _MIN_NATIVE_WORDS:
        score += 0.20
    if page.has_tables:
        score += 0.30
    if page.key_values:
        score += 0.10
    if page.rendered_png:
        score += 0.05
    if page.warnings:
        score -= min(0.25, len(page.warnings) * 0.05)
    return max(0.0, min(1.0, score))


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    values = sorted(values)
    mid = len(values) // 2
    if len(values) % 2:
        return values[mid]
    return (values[mid - 1] + values[mid]) / 2.0
