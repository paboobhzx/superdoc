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
import html
import json as _json
import os

import dynamo
import ocr
import s3
from logger import get_logger
from pypdf import PdfReader

log = get_logger(__name__)


def _extract_page_texts(pdf_bytes: bytes) -> list[str]:
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
    return page_texts


def _ocr_pdf_pages(pdf_bytes: bytes, missing_indexes: set[int], dpi: int = 150) -> dict[int, str]:
    if not missing_indexes:
        return {}
    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        matrix = pymupdf.Matrix(dpi / 72.0, dpi / 72.0)
        results: dict[int, str] = {}
        for page_index in missing_indexes:
            page = doc.load_page(page_index)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            lines = ocr.extract_lines(pix.tobytes("png"))
            results[page_index] = "\n".join(lines)
        return results
    finally:
        doc.close()


def _extract_plain_text(pdf_bytes: bytes, *, ocr_fallback: bool = True) -> bytes:
    page_texts = _extract_page_texts(pdf_bytes)
    if ocr_fallback:
        missing = {idx for idx, text in enumerate(page_texts) if not text.strip()}
        for idx, text in _ocr_pdf_pages(pdf_bytes, missing).items():
            page_texts[idx] = text
    return "\f".join(page_texts).encode("utf-8")


def _extract_markdown(pdf_bytes: bytes) -> bytes:
    page_texts = _extract_plain_text(pdf_bytes).decode("utf-8").split("\f")
    parts: list[str] = []
    for idx, text in enumerate(page_texts, start=1):
        if len(page_texts) > 1:
            parts.append(f"## Page {idx}")
            parts.append("")
        parts.append(text.strip())
        parts.append("")
    return "\n".join(parts).strip().encode("utf-8")


def _extract_html(pdf_bytes: bytes) -> bytes:
    page_texts = _extract_plain_text(pdf_bytes).decode("utf-8").split("\f")
    parts = ["<!doctype html>", "<html>", "<body>"]
    for idx, text in enumerate(page_texts, start=1):
        # Keep one section per page so downstream readers can preserve the
        # original pagination without trying to infer layout from plain text.
        parts.append(f'<section data-page="{idx}"><pre>')
        parts.append(html.escape(text))
        parts.append("</pre></section>")
    parts.append("</body></html>")
    return "\n".join(parts).encode("utf-8")


def _output_filename(body: dict, file_key: str, target_format: str) -> str:
    original = body.get("file_name") or os.path.basename(file_key) or "document.pdf"
    stem, _ext = os.path.splitext(os.path.basename(original))
    return f"{stem or 'document'}.{target_format}"


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
    operation = body.get("operation", "pdf_to_txt")
    params = body.get("params") or {}
    # Keep one worker for PDF text, Markdown, and HTML. The operation id
    # still selects the default branch so older payloads continue to work.
    target_format = (params.get("target_format") or body.get("target_format") or ("md" if operation == "pdf_to_md" else ("html" if operation == "pdf_to_html" else "txt"))).lower()

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        if target_format == "html":
            result = _extract_html(data)
        elif target_format == "md":
            result = _extract_markdown(data)
        elif target_format == "txt":
            result = _extract_plain_text(data)
        else:
            raise ValueError("target_format must be one of: html, md, txt")
        out_key = s3.make_output_key(job_id, file_key, _output_filename(body, file_key, target_format))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_txt done", extra={"job_id": job_id, "target_format": target_format})
    except Exception as exc:
        log.exception("pdf_to_txt failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
