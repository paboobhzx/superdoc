# handlers/xlsx_to_csv.py - Converts a sheet of an .xlsx to CSV.
#
# Default is the first sheet. Optional `sheet` param names a specific sheet
# by its visible name (openpyxl rejects invalid names with KeyError).
# Output CSV uses \r\n line endings per RFC 4180.

import csv
import io
import json as _json

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)


def _xlsx_to_csv(xlsx_bytes: bytes, sheet_name: str | None) -> bytes:
    """Return CSV text (UTF-8 bytes) extracted from one sheet of the workbook.

    read_only=True streams rows rather than loading the entire workbook into
    memory - important for larger spreadsheets running under Lambda\'s memory
    ceiling. data_only=True evaluates formulas to their cached values rather
    than returning formula strings.
    """
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    try:
        if sheet_name is None:
            ws = wb.worksheets[0]
        else:
            if sheet_name not in wb.sheetnames:
                raise ValueError(f"sheet not found: {sheet_name}")
            ws = wb[sheet_name]

        buffer = io.StringIO()
        writer = csv.writer(buffer, dialect="excel")
        for row in ws.iter_rows(values_only=True):
            # Normalize None cells to empty strings so the CSV is compact
            # and parseable by common readers.
            normalized: list[str] = []
            for cell in row:
                if cell is None:
                    normalized.append("")
                else:
                    normalized.append(str(cell))
            writer.writerow(normalized)

        return buffer.getvalue().encode("utf-8")
    finally:
        wb.close()


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    params = body.get("params") or {}
    sheet_name = params.get("sheet")
    if sheet_name is None:
        sheet_name = body.get("sheet")

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _xlsx_to_csv(data, sheet_name=sheet_name)
        out_key = s3.make_output_key(job_id, file_key, "output.csv")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("xlsx_to_csv done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("xlsx_to_csv failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
