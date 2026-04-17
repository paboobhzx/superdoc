import io
import json
import zipfile

import dynamo
import s3
from logger import get_logger
from pypdf import PdfReader, PdfWriter

log = get_logger(__name__)


def _process(data: bytes, body: dict) -> bytes:
    """Merge multiple PDFs from a ZIP archive into one PDF."""
    merger = PdfWriter()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        pdf_names = sorted(n for n in zf.namelist() if n.lower().endswith(".pdf"))
        for name in pdf_names:
            reader = PdfReader(io.BytesIO(zf.read(name)))
            for page in reader.pages:
                merger.add_page(page)

    out = io.BytesIO()
    merger.write(out)
    return out.getvalue()


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _process(data, body)
        out_key = s3.make_output_key(job_id, file_key, "merged.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_merge done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_merge failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
