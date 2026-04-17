import io
import json
import os

import dynamo
import s3
from logger import get_logger
from PIL import Image

log = get_logger(__name__)

_FORMAT_MAP = {
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "png": "PNG",
    "webp": "WEBP",
    "gif": "GIF",
    "bmp": "BMP",
    "tiff": "TIFF",
}


def _process(data: bytes, body: dict) -> tuple[bytes, str]:
    target_format = body.get("target_format", "png").lower()
    pil_format = _FORMAT_MAP.get(target_format, "PNG")

    img = Image.open(io.BytesIO(data))
    if pil_format == "JPEG" and img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    out = io.BytesIO()
    img.save(out, format=pil_format)
    return out.getvalue(), target_format


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result, ext = _process(data, body)
        out_key = s3.make_output_key(job_id, file_key, f"converted.{ext}")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("image_convert done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("image_convert failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
