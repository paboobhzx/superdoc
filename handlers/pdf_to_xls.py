import io
import json as _json
import os

import dynamo
import output_naming
import s3
from logger import get_logger

log = get_logger(__name__)


def _normalize_cell(value):
    return "" if value is None else str(value)


def _rows_from_words(words: list[dict], y_tolerance: float = 3.5) -> list[list[str]]:
    rows: list[list[str]] = []
    current_bucket: int | None = None
    current_row: list[tuple[float, str]] = []

    for word in sorted(words, key=lambda item: (float(item.get("top", 0.0)), float(item.get("x0", 0.0)))):
        bucket = int(round(float(word.get("top", 0.0)) / y_tolerance))
        if current_bucket is None:
            current_bucket = bucket
        if bucket != current_bucket and current_row:
            rows.append([text for _x, text in sorted(current_row, key=lambda item: item[0])])
            current_row = []
            current_bucket = bucket
        current_row.append((float(word.get("x0", 0.0)), _normalize_cell(word.get("text"))))

    if current_row:
        rows.append([text for _x, text in sorted(current_row, key=lambda item: item[0])])

    return rows


def _page_rows(page) -> list[list[str]]:
    tables = page.extract_tables() or []
    if tables:
        rows: list[list[str]] = []
        for index, table in enumerate(tables):
            if index > 0:
                rows.append([])
            for row in table or []:
                rows.append([_normalize_cell(cell) for cell in row or []])
        return rows

    words = page.extract_words(keep_blank_chars=True, use_text_flow=True) or []
    return _rows_from_words(words)


def _non_empty_row_count(rows: list[list[str]]) -> int:
    return sum(1 for row in rows if any(str(cell or "").strip() for cell in row))


def _page_is_scanned(pdf_bytes: bytes, page_index_0based: int) -> bool:
    """Detect if a page is a scanned image (no extractable text, has images).

    Uses pymupdf directly — does not depend on upstream analysis_result.
    """
    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc.load_page(page_index_0based)
        text = (page.get_text("text") or "").strip()
        images = page.get_images(full=False)
        has_text = len(text) > 10  # ignore trivial artifacts
        has_images = len(images) > 0
        log.info(
            "page_scan_check",
            extra={
                "page": page_index_0based,
                "text_len": len(text),
                "has_text": has_text,
                "image_count": len(images),
                "is_scanned": not has_text and has_images,
            },
        )
        return not has_text and has_images
    finally:
        doc.close()


def _build_workbook(pdf_bytes: bytes, *, ocr_page_indices: list[int] | None = None, job_id: str = "unknown") -> tuple[bytes, list[str]]:
    import pdfplumber
    from openpyxl import Workbook

    workbook = Workbook()
    consolidated = workbook.active
    consolidated.title = "Consolidated"
    consolidated_row = 1
    last_header: list[str] | None = None
    warnings: list[str] = []
    ocr_set = set(ocr_page_indices or [])

    log.info(
        "build_workbook_start",
        extra={"job_id": job_id, "ocr_page_indices": list(ocr_set), "ocr_set_size": len(ocr_set)},
    )

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages = list(pdf.pages)
        log.info("pdfplumber_pages", extra={"job_id": job_id, "page_count": len(pages)})
        if not pages:
            workbook.create_sheet("Page 1")
        for page_index, page in enumerate(pages, start=1):
            page_0 = page_index - 1
            sheet = workbook.create_sheet()
            sheet.title = f"Page {page_index}"
            try:
                rows = _page_rows(page)
            except Exception as exc:
                warnings.append(f"Page {page_index} could not be extracted: {exc}")
                log.warning("page_extract_error", extra={"job_id": job_id, "page": page_index, "error": str(exc)})
                rows = []

            non_empty = _non_empty_row_count(rows)
            log.info(
                "page_extract_result",
                extra={
                    "job_id": job_id,
                    "page": page_index,
                    "total_rows": len(rows),
                    "non_empty_rows": non_empty,
                    "in_ocr_set": page_0 in ocr_set,
                },
            )

            # OCR fallback: trigger when pdfplumber returned nothing usable.
            # Two paths to trigger:
            #   1. Page is in ocr_page_indices (from upstream analysis)
            #   2. Page has no text but has images (inline detection)
            needs_ocr = False
            if non_empty == 0:
                if page_0 in ocr_set:
                    needs_ocr = True
                    log.info("ocr_trigger_upstream", extra={"job_id": job_id, "page": page_index})
                else:
                    # Inline detection: check if this is a scanned page
                    is_scanned = _page_is_scanned(pdf_bytes, page_0)
                    if is_scanned:
                        needs_ocr = True
                        log.info("ocr_trigger_inline_detection", extra={"job_id": job_id, "page": page_index})

            if needs_ocr:
                try:
                    from pdf_ocr_pages import ocr_pdf_pages
                    log.info("ocr_starting", extra={"job_id": job_id, "page": page_index})
                    ocr_results = ocr_pdf_pages(pdf_bytes, page_indices=[page_0])
                    ocr_result = ocr_results[0] if ocr_results else None
                    log.info(
                        "ocr_result",
                        extra={
                            "job_id": job_id,
                            "page": page_index,
                            "source": ocr_result.source if ocr_result else "none",
                            "word_count": len(ocr_result.words) if ocr_result else 0,
                            "line_count": len(ocr_result.lines) if ocr_result else 0,
                            "first_words": [w.text for w in (ocr_result.words if ocr_result else [])[:5]],
                        },
                    )
                    if ocr_result and ocr_result.words:
                        ocr_words = [w.to_pdfplumber_dict() for w in ocr_result.words]
                        rows = _rows_from_words(ocr_words)
                        non_empty = _non_empty_row_count(rows)
                        sheet.title = f"Page {page_index} (OCR)"
                        warnings.append(f"Page {page_index} extracted via OCR ({ocr_result.source}, {len(ocr_result.words)} words).")
                        log.info(
                            "ocr_rows_built",
                            extra={"job_id": job_id, "page": page_index, "rows": len(rows), "non_empty": non_empty},
                        )
                    else:
                        log.warning("ocr_no_words", extra={"job_id": job_id, "page": page_index})
                        warnings.append(f"Page {page_index} OCR returned no words.")
                except Exception as ocr_exc:
                    log.exception("ocr_failed", extra={"job_id": job_id, "page": page_index})
                    warnings.append(f"Page {page_index} OCR failed: {ocr_exc}")

            for row_index, row in enumerate(rows, start=1):
                for col_index, value in enumerate(row, start=1):
                    sheet.cell(row=row_index, column=col_index, value=value)

            if not rows:
                continue
            first_row = rows[0] if rows else []
            has_text_header = any(str(cell or "").strip() for cell in first_row)
            if has_text_header:
                last_header = [str(cell or "") for cell in first_row]
            elif last_header:
                rows = [last_header] + rows
            elif _non_empty_row_count(rows) <= 1:
                warnings.append(f"Page {page_index} has insufficient data for consolidated rows.")
                continue

            for row in rows:
                for col_index, value in enumerate(row, start=1):
                    consolidated.cell(row=consolidated_row, column=col_index, value=value)
                consolidated_row += 1

    log.info("build_workbook_done", extra={"job_id": job_id, "consolidated_rows": consolidated_row - 1, "warnings": warnings})
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue(), warnings


def _output_filename(body: dict, file_key: str) -> str:
    return output_naming.output_filename("pdf_to_xls", body, file_key, "xlsx")


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    analysis_result = body.get("analysis_result") or {}
    ocr_page_indices = analysis_result.get("ocr_page_indices") or []

    log.info(
        "pdf_to_xls_handler_start",
        extra={
            "job_id": job_id,
            "file_key": file_key,
            "has_analysis_result": bool(analysis_result),
            "needs_ocr": analysis_result.get("needs_ocr"),
            "ocr_page_indices": ocr_page_indices,
            "recommendation": analysis_result.get("recommendation"),
            "body_keys": list(body.keys()),
        },
    )

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        log.info("pdf_bytes_loaded", extra={"job_id": job_id, "size_bytes": len(data)})
        result, warnings = _build_workbook(data, ocr_page_indices=ocr_page_indices, job_id=job_id)
        out_key = s3.make_output_key(job_id, file_key, _output_filename(body, file_key))
        s3.put_bytes(out_key, result)
        log.info("xlsx_written", extra={"job_id": job_id, "output_size": len(result), "warnings": warnings})
        if warnings:
            dynamo.update_job(job_id, job_warnings=warnings)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_xls_done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_to_xls failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
