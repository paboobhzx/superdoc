import io
import json

import dynamo
import limits
import output_naming
import s3
from logger import get_logger
from pypdf import PdfReader, PdfWriter

log = get_logger(__name__)


def _parse_order(page_order: str, total_pages: int) -> list[int]:
    if not page_order or not page_order.strip():
        return list(range(total_pages))
    result = []
    for raw in page_order.split(","):
        part = raw.strip()
        if not part:
            continue
        try:
            page_num = int(part)
        except ValueError as exc:
            raise ValueError(f"Invalid page number: {part}") from exc
        if page_num < 1 or page_num > total_pages:
            raise ValueError(f"Page {page_num} is outside the document range 1-{total_pages}")
        result.append(page_num - 1)
    if not result:
        raise ValueError("page_order did not include any pages")
    return result


def _process(data: bytes, body: dict) -> bytes:
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    for page_idx in _parse_order(body.get("page_order", ""), len(reader.pages)):
        writer.add_page(reader.pages[page_idx])
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
        limits.assert_pdf_page_limit(result, body.get("user_id") or "")
        out_key = s3.make_output_key(job_id, file_key, output_naming.output_filename("pdf_rearrange", body, file_key, "pdf"))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_rearrange done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_rearrange failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
