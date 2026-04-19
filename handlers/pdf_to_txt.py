# handlers/pdf_to_txt.py - Worker Lambda for pdf_to_txt operation.
#
# Reads a PDF from S3, extracts plain text per page, joins with form-feed,
# writes back as .txt. Deliberately does NOT reuse pdf_extract_text because
# that one emits JSON with page structure - here we want a user-facing plain
# text file the user can open in any editor.
#
# Pages are separated by \f (form feed, U+000C) - a long-standing convention
# for plain-text-from-PDF that text readers like less(1) honor as a page break.

import io
import json as _json

import dynamo
import s3
from logger import get_logger
from pypdf import PdfReader

log = get_logger(__name__)


def _extract_plain_text(pdf_bytes: bytes) -> bytes:
    """Extract page-by-page plain text from PDF bytes.

    Split into its own function so it can be unit-tested without the SQS
    event / DynamoDB / S3 ceremony. The I/O-free core is the interesting
    part; everything else is glue.
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    page_texts: list[str] = []
    for page in reader.pages:
        extracted = page.extract_text()
        if extracted is None:
            page_texts.append("")
        else:
            page_texts.append(extracted)
    return "\f".join(page_texts).encode("utf-8")


def handler(event, context):
    """SQS-triggered worker. Consumes one message, writes output to S3.

    Errors are re-raised after marking the job FAILED in DynamoDB so that
    SQS retries (or dead-letters) based on queue config. We do NOT swallow
    the exception - that would confuse SQS into thinking the message was
    processed successfully.
    """
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _extract_plain_text(data)
        out_key = s3.make_output_key(job_id, file_key, "output.txt")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_txt done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_to_txt failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
