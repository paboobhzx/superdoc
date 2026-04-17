import io
import json

import dynamo
import s3
from logger import get_logger
from pypdf import PdfReader, PdfWriter

log = get_logger(__name__)


def _process(data: bytes, body: dict) -> bytes:
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    writer.clone_reader_document_root(reader)

    for page in writer.pages:
        page.compress_content_streams()

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
        out_key = s3.make_output_key(job_id, file_key, "compressed.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_compress done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_compress failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
