# handlers/docx_to_pdf.py - Renders readable .docx content to a clean PDF.
#
# This is not a pixel-perfect Word renderer. It extracts paragraphs and tables
# with python-docx and lays them out with ReportLab so users get a readable PDF
# from common document content in the lightweight Lambda runtime.

import io
import json as _json

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)


def _docx_to_pdf(docx_bytes: bytes) -> bytes:
    from docx import Document
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    docx = Document(io.BytesIO(docx_bytes))
    output = io.BytesIO()
    pdf = SimpleDocTemplate(
        output,
        pagesize=letter,
        leftMargin=0.72 * inch,
        rightMargin=0.72 * inch,
        topMargin=0.72 * inch,
        bottomMargin=0.72 * inch,
        title="Converted Word document",
    )
    styles = getSampleStyleSheet()
    body = styles["BodyText"]
    body.leading = 14
    story = []

    for paragraph in docx.paragraphs:
        text = paragraph.text.strip()
        if text:
            story.append(Paragraph(escape(text), body))
        story.append(Spacer(1, 0.08 * inch))

    for table in docx.tables:
        rows = []
        for row in table.rows:
            rows.append([Paragraph(escape(cell.text.strip()), body) for cell in row.cells])
        if not rows:
            continue
        story.append(Spacer(1, 0.12 * inch))
        flowable = Table(rows, repeatRows=1)
        flowable.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#8d96a3")),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef2f7")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(flowable)

    if not story:
        story.append(Paragraph("No readable document content found.", body))

    pdf.build(story)
    return output.getvalue()


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _docx_to_pdf(data)
        out_key = s3.make_output_key(job_id, file_key, "output.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("docx_to_pdf done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("docx_to_pdf failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
