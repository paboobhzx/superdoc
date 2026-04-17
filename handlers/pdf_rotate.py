import io
import json

import dynamo
import s3
from logger import get_logger
from pypdf import PdfReader, PdfWriter

log = get_logger(__name__)


def _parse_pages(pages_str: str, total: int) -> list[int]:
    """Parse '1,3,5-7' → [0,2,4,5,6] (0-indexed). Empty = all pages."""
    if not pages_str:
        return list(range(total))
    result = []
    for part in pages_str.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            result.extend(range(int(start) - 1, int(end)))
        else:
            result.append(int(part) - 1)
    return result


def _process(data: bytes, body: dict) -> bytes:
    angle = int(body.get("angle", 90))
    pages_str = body.get("pages", "")

    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    rotate_set = set(_parse_pages(pages_str, len(reader.pages)))

    for i, page in enumerate(reader.pages):
        if i in rotate_set:
            page.rotate(angle)
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
        out_key = s3.make_output_key(job_id, file_key, "rotated.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_rotate done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_rotate failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
