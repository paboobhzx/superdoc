# handlers/image_to_pdf.py - Packages a single image as a PDF.
#
# Multi-image support is future scope (would require params.file_keys list
# and coordination with create_job). Single-image is the common case and
# uses Pillow\'s built-in PDF save.

import io
import json as _json

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)


def _image_to_pdf(image_bytes: bytes) -> bytes:
    """Convert image bytes to a single-page PDF.

    Pillow\'s PDF save handles format normalization automatically - it\'ll
    convert RGBA/CMYK/P-mode images to RGB as needed. If the image is
    corrupt, Pillow raises and we let the exception propagate.
    """
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))
    # PDF requires RGB. Force conversion even if already RGB to avoid
    # surprises with indexed palettes or alpha channels.
    if img.mode != "RGB":
        img = img.convert("RGB")

    buffer = io.BytesIO()
    img.save(buffer, format="PDF", resolution=150.0)
    return buffer.getvalue()


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _image_to_pdf(data)
        out_key = s3.make_output_key(job_id, file_key, "output.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("image_to_pdf done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("image_to_pdf failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
