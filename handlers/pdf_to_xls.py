import io
import json as _json
import os

import dynamo
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


def _build_workbook(pdf_bytes: bytes) -> bytes:
    import pdfplumber
    from openpyxl import Workbook

    workbook = Workbook()

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages = list(pdf.pages)
        if not pages:
            sheet = workbook.active
            sheet.title = "Page 1"
        for page_index, page in enumerate(pages, start=1):
            sheet = workbook.active if page_index == 1 else workbook.create_sheet()
            sheet.title = f"Page {page_index}"
            rows = _page_rows(page)
            for row_index, row in enumerate(rows, start=1):
                for col_index, value in enumerate(row, start=1):
                    sheet.cell(row=row_index, column=col_index, value=value)

    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def _output_filename(body: dict, file_key: str) -> str:
    original = body.get("file_name") or os.path.basename(file_key) or "document.pdf"
    stem, _ext = os.path.splitext(os.path.basename(original))
    return f"{stem or 'document'}.xlsx"


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _build_workbook(data)
        out_key = s3.make_output_key(job_id, file_key, _output_filename(body, file_key))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_xls done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_to_xls failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
