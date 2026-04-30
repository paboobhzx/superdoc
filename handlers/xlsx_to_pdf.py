# handlers/xlsx_to_pdf.py - Renders one .xlsx sheet to a readable PDF table.
#
# Default is the first sheet. Optional `sheet` param selects a visible sheet by
# name. This favors clean workbook content over pixel-perfect Excel rendering.

import io
import json as _json

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)


def _clean_cell(value) -> str:
    if value is None:
        return ""
    return str(value)


def _xlsx_to_pdf(xlsx_bytes: bytes, sheet_name: str | None) -> bytes:
    from openpyxl import load_workbook
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import landscape, letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    wb = load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    try:
        if sheet_name:
            if sheet_name not in wb.sheetnames:
                raise ValueError(f"sheet not found: {sheet_name}")
            ws = wb[sheet_name]
        else:
            ws = wb.worksheets[0]

        rows = []
        for idx, row in enumerate(ws.iter_rows(values_only=True)):
            if idx >= 200:
                break
            values = [_clean_cell(cell) for cell in row]
            if any(values):
                rows.append(values)

        output = io.BytesIO()
        pdf = SimpleDocTemplate(
            output,
            pagesize=landscape(letter),
            leftMargin=0.45 * inch,
            rightMargin=0.45 * inch,
            topMargin=0.45 * inch,
            bottomMargin=0.45 * inch,
            title=f"Converted spreadsheet - {ws.title}",
        )
        styles = getSampleStyleSheet()
        body = styles["BodyText"]
        body.fontSize = 7
        body.leading = 9

        story = [Paragraph(escape(ws.title), styles["Heading2"]), Spacer(1, 0.12 * inch)]
        if not rows:
            story.append(Paragraph("No readable sheet content found.", styles["BodyText"]))
        else:
            max_cols = min(max(len(row) for row in rows), 12)
            normalized = []
            for row in rows:
                cells = row[:max_cols] + [""] * max(0, max_cols - len(row))
                normalized.append([Paragraph(escape(cell), body) for cell in cells])

            table = Table(normalized, repeatRows=1)
            table.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#8d96a3")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2f7")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]))
            story.append(table)

        pdf.build(story)
        return output.getvalue()
    finally:
        wb.close()


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    params = body.get("params") or {}
    sheet_name = params.get("sheet") or body.get("sheet")

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _xlsx_to_pdf(data, sheet_name=sheet_name)
        out_key = s3.make_output_key(job_id, file_key, "output.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("xlsx_to_pdf done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("xlsx_to_pdf failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
