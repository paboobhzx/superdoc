"""Fast pdf-to-docx handler using pypdf + python-docx.

Extracts plain text from each PDF page and writes it as paragraphs in a docx.
Layout, images, tables, and fonts are not preserved — use the high-fidelity
(LibreOffice) path for documents where formatting matters.
"""
import io
import json as _json
import os

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)


def _pdf_to_docx(pdf_bytes: bytes) -> bytes:
    from docx import Document
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    doc = Document()
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            doc.add_paragraph(text)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def _output_filename(body: dict, file_key: str) -> str:
    original = body.get("file_name") or os.path.basename(file_key) or "document.pdf"
    stem, _ext = os.path.splitext(os.path.basename(original))
    return f"{stem or 'document'}.docx"


def handler(event, context):
    if event.get("_warmup"):
        log.info("warmup ping received")
        return
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _pdf_to_docx(data)
        out_key = s3.make_output_key(job_id, file_key, _output_filename(body, file_key))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_docx_fast done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_to_docx_fast failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
