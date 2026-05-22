import io
import json

import dynamo
import output_naming
import s3
from logger import get_logger
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

log = get_logger(__name__)


def _make_watermark(text: str, page_width: float, page_height: float, mode: str, opacity: float) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_width, page_height))
    c.setFillColor(Color(0.5, 0.5, 0.5, alpha=opacity))
    if mode == "header":
        c.setFont("Helvetica", 14)
        c.drawCentredString(page_width / 2, page_height - 28, text)
    elif mode == "footer":
        c.setFont("Helvetica", 14)
        c.drawCentredString(page_width / 2, 22, text)
    elif mode == "corner":
        c.setFont("Helvetica", 16)
        c.drawRightString(page_width - 24, 24, text)
    else:
        c.setFont("Helvetica", 40)
        c.saveState()
        c.translate(page_width / 2, page_height / 2)
        c.rotate(45)
        c.drawCentredString(0, 0, text)
        c.restoreState()
    c.save()
    return buf.getvalue()


def _fit_size(img_width: float, img_height: float, max_width: float, max_height: float) -> tuple[float, float]:
    if img_width <= 0 or img_height <= 0:
        return max_width, max_height
    scale = min(max_width / img_width, max_height / img_height)
    return img_width * scale, img_height * scale


def _draw_image_watermark(c, image_reader, page_width: float, page_height: float, mode: str, opacity: float) -> None:
    img_width, img_height = image_reader.getSize()
    c.saveState()
    if hasattr(c, "setFillAlpha"):
        c.setFillAlpha(opacity)
    if mode == "header":
        width, height = _fit_size(img_width, img_height, page_width * 0.35, page_height * 0.12)
        x = (page_width - width) / 2
        y = page_height - height - 18
    elif mode == "footer":
        width, height = _fit_size(img_width, img_height, page_width * 0.35, page_height * 0.12)
        x = (page_width - width) / 2
        y = 18
    elif mode == "corner":
        width, height = _fit_size(img_width, img_height, page_width * 0.25, page_height * 0.18)
        x = page_width - width - 24
        y = 24
    else:
        width, height = _fit_size(img_width, img_height, page_width * 0.60, page_height * 0.60)
        c.translate(page_width / 2, page_height / 2)
        c.rotate(45)
        x = -width / 2
        y = -height / 2
    c.drawImage(image_reader, x, y, width=width, height=height, mask="auto", preserveAspectRatio=True)
    c.restoreState()


def _make_image_watermark(image_bytes: bytes, page_width: float, page_height: float, mode: str, opacity: float) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_width, page_height))
    image_reader = ImageReader(io.BytesIO(image_bytes))
    _draw_image_watermark(c, image_reader, page_width, page_height, mode, opacity)
    c.save()
    return buf.getvalue()


def _process(data: bytes, body: dict, watermark_image_bytes: bytes | None = None) -> bytes:
    watermark_text = body.get("watermark_text", "DRAFT")
    watermark_type = body.get("watermark_type", "text")
    stamp_mode = body.get("stamp_mode", "watermark")
    opacity = float(body.get("opacity", 0.3))
    if watermark_type == "image" and not watermark_image_bytes:
        raise ValueError("watermark_image is required")
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()

    for page in reader.pages:
        w = float(page.mediabox.width)
        h = float(page.mediabox.height)
        if watermark_type == "image":
            wm_bytes = _make_image_watermark(watermark_image_bytes or b"", w, h, stamp_mode, opacity)
        else:
            wm_bytes = _make_watermark(watermark_text, w, h, stamp_mode, opacity)
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
        watermark_image = None
        if body.get("watermark_type") == "image":
            watermark_image_key = body.get("watermark_image_key")
            if not watermark_image_key:
                raise ValueError("watermark_image_key is required")
            watermark_image = s3.get_bytes(watermark_image_key)
        result = _process(data, body, watermark_image)
        out_key = s3.make_output_key(job_id, file_key, output_naming.output_filename("pdf_annotate", body, file_key, "pdf"))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_annotate done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_annotate failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
