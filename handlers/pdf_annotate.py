import io
import json

import dynamo
import s3
from logger import get_logger
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

log = get_logger(__name__)


def _make_watermark(text: str, page_width: float, page_height: float) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_width, page_height))
    c.setFont("Helvetica", 40)
    c.setFillColor(Color(0.5, 0.5, 0.5, alpha=0.3))
    c.saveState()
    c.translate(page_width / 2, page_height / 2)
    c.rotate(45)
    c.drawCentredString(0, 0, text)
    c.restoreState()
    c.save()
    return buf.getvalue()


def _process(data: bytes, body: dict) -> bytes:
    watermark_text = body.get("watermark_text", "DRAFT")
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()

    for page in reader.pages:
        w = float(page.mediabox.width)
        h = float(page.mediabox.height)
        wm_bytes = _make_watermark(watermark_text, w, h)
        wm_reader = PdfReader(io.BytesIO(wm_bytes))
        page.merge_page(wm_reader.pages[0])
        writer.add_page(page)

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _process(data, body)
        out_key = s3.make_output_key(job_id, file_key, "annotated.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_annotate done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_annotate failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
