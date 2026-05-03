import json
import os

import dynamo
import s3
from document_blocks import parse_html, render_to
from logger import get_logger

log = get_logger(__name__)


def _resolve_target(body: dict) -> str:
    params = body.get("params") or {}
    # Default to txt because it is the least lossy safe fallback when the
    # payload is malformed and we still want the job to complete predictably.
    return (params.get("target_format") or body.get("target_format") or "txt").lower()


def _output_filename(body: dict, file_key: str, target_format: str) -> str:
    original = body.get("file_name") or os.path.basename(file_key) or "page.html"
    stem, _ext = os.path.splitext(os.path.basename(original))
    return f"{stem or 'page'}.{target_format}"


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    target = _resolve_target(body)

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        source = data.decode("utf-8", errors="replace")
        if target == "html":
            result = source.encode("utf-8")
        else:
            blocks = parse_html(source)
            result = render_to(blocks, target)
        out_key = s3.make_output_key(job_id, file_key, _output_filename(body, file_key, target))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("html_convert done", extra={"job_id": job_id, "target_format": target})
    except Exception as exc:
        log.exception("html_convert failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
