import io
import json

import dynamo
import s3
from docx import Document
from logger import get_logger
from pypdf import PdfReader

log = get_logger(__name__)


def _process(data: bytes, body: dict) -> bytes:
    reader = PdfReader(io.BytesIO(data))
    doc = Document()
    doc.add_heading("Converted Document", 0)

    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if i > 0:
            doc.add_page_break()
        doc.add_paragraph(f"— Page {i + 1} —")
        if text.strip():
            doc.add_paragraph(text)
        else:
            doc.add_paragraph("[No extractable text on this page]")

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _process(data, body)
        out_key = s3.make_output_key(job_id, file_key, "converted.docx")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_docx done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_to_docx failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
