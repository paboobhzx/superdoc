import json

import dynamo
import limits
import s3
from logger import get_logger
from pdf_inspector import detect_watermarks, remove_detected_watermarks

log = get_logger(__name__)


def _report_bytes(report: dict) -> bytes:
    return json.dumps(report, indent=2, sort_keys=True).encode("utf-8")


def _process(data: bytes, body: dict) -> tuple[bytes, str]:
    watermark_text = body.get("watermark_text", "")
    confidence_min = float(body.get("confidence_min", 0.6))
    mode = body.get("case", "auto")
    dry_run = bool(body.get("dry_run", False))

    report = detect_watermarks(data, text=watermark_text, mode=mode)
    report["dry_run"] = dry_run
    report["confidence_min"] = confidence_min

    if report["detections"] <= 0:
        raise ValueError("no_watermark_detected")
    if float(report["confidence"]) < confidence_min:
        raise ValueError("no_watermark_detected")

    if dry_run:
        return _report_bytes(report), "watermark-report.json"
    if report.get("unsafe_xobjects") and mode in ("auto", "xobject"):
        raise ValueError("unsafe_xobject_removal")

    output, removal_report = remove_detected_watermarks(data, text=watermark_text, mode=mode)
    removal_report["dry_run"] = False
    if output == data:
        raise ValueError("no_watermark_detected")
    return output, "watermark-removed.pdf"


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result, filename = _process(data, body)
        if filename.endswith(".pdf"):
            limits.assert_pdf_page_limit(result, body.get("user_id") or "")
        out_key = s3.make_output_key(job_id, file_key, filename)
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_remove_watermark done", extra={"job_id": job_id, "dry_run": body.get("dry_run", False)})
    except Exception as exc:
        log.exception("pdf_remove_watermark failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
