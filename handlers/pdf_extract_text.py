import io
import json as _json

import dynamo
import s3
from logger import get_logger
from pypdf import PdfReader

log = get_logger(__name__)


def _process(data: bytes, body: dict) -> bytes:
    reader = PdfReader(io.BytesIO(data))
    pages = []
    for i, page in enumerate(reader.pages):
        pages.append({"page": i + 1, "text": page.extract_text() or ""})
    return _json.dumps({"pages": pages}).encode()


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _process(data, body)
        out_key = s3.make_output_key(job_id, file_key, "text.json")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_extract_text done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_extract_text failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
