import json
import os

import dynamo
import s3
from document_blocks import parse_markdown, render_to
from logger import get_logger

log = get_logger(__name__)

TARGET_FORMATS = {"pdf", "docx", "png", "jpg", "jpeg", "tiff", "md", "txt", "html"}


def _decode_text(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Input must be valid UTF-8 Markdown or plain text") from exc


def convert_markdown(data: bytes, target_format: str) -> bytes:
    target = (target_format or "").lower()
    if target not in TARGET_FORMATS:
        raise ValueError("target_format must be one of: docx, html, jpeg, jpg, md, pdf, png, tiff, txt")
    source = _decode_text(data)
    if target == "md":
        return source.encode("utf-8")
    blocks = parse_markdown(source)
    return render_to(blocks, target)


def _output_filename(body: dict, file_key: str, target_format: str) -> str:
    original = body.get("file_name") or os.path.basename(file_key) or "markdown.md"
    stem, _ext = os.path.splitext(os.path.basename(original))
    return f"{stem or 'markdown'}.{target_format}"


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    target_format = (body.get("target_format") or "").lower()

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = convert_markdown(data, target_format)
        out_key = s3.make_output_key(job_id, file_key, _output_filename(body, file_key, target_format))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("markdown_convert done", extra={"job_id": job_id, "target_format": target_format})
    except Exception as exc:
        log.exception("markdown_convert failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
