# handlers/docx_to_txt.py - Extracts plain text from a .docx file.
#
# python-docx reads the XML inside the docx archive and returns paragraphs
# in order. We join with \n and write as UTF-8. Complex content (tables,
# headers/footers) is NOT captured - those are separate APIs in python-docx
# and a future iteration can add them if users ask.

import io
import json as _json

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)


def _extract_docx_text(docx_bytes: bytes) -> bytes:
    """Read a .docx from bytes and return the paragraph text as UTF-8 bytes."""
    # Import inside function to defer the (non-trivial) python-docx import
    # cost until this handler is actually called.
    from docx import Document

    doc = Document(io.BytesIO(docx_bytes))
    lines: list[str] = []
    for paragraph in doc.paragraphs:
        # python-docx exposes the paragraph text directly; empty paragraphs
        # become empty strings, which we keep - they preserve visual spacing.
        lines.append(paragraph.text)

    joined = "\n".join(lines)
    return joined.encode("utf-8")


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _extract_docx_text(data)
        out_key = s3.make_output_key(job_id, file_key, "output.txt")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("docx_to_txt done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("docx_to_txt failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
