import json
import os
import time
from decimal import Decimal

import boto3
import dynamo
import estimator
import limits
import operations
import response
import s3
from logger import get_logger, log_event

log = get_logger(__name__)

_sqs = boto3.client("sqs")
SQS_QUEUE_URL = os.environ.get("SQS_QUEUE_URL", "")
_OCR_CAPABLE_OPERATIONS = {"pdf_to_docx", "pdf_to_xls", "pdf_to_txt"}


def _json_safe(value):
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    return value


def handler(event, context):
    try:
        if event.get("httpMethod") == "OPTIONS":
            return response.preflight()

        job_id = (event.get("pathParameters") or {}).get("jobId", "")
        if not job_id:
            return response.error("jobId is required")

        job = dynamo.get_job(job_id)
        if not job:
            return response.error("Job not found", 404)

        if job.get("status") != "PENDING":
            return response.error(f"Job is not in PENDING state (current: {job.get('status')})", 409)

        file_key = job.get("file_key") or f"uploads/{job_id}/{job.get('file_name', 'file')}"
        params = _json_safe(job.get("params") or {})
        user_id = job.get("user_id") or ""

        # Allow the caller to supply final params at trigger time (used by the
        # pre-analysis upload flow where the job is created with defaults and
        # the user's actual choices arrive with the trigger call).
        body_json = {}
        if event.get("body"):
            try:
                body_json = json.loads(event["body"])
            except Exception:
                pass
        params_override = body_json.get("params") or {}
        if params_override and isinstance(params_override, dict):
            params = {**params, **params_override}
            dynamo.update_job(job_id, params=params)

        analysis_result = body_json.get("analysis_result")
        analysis_source = "body" if analysis_result else "none"
        if analysis_result and isinstance(analysis_result, dict):
            dynamo.update_job(job_id, analysis_result=analysis_result)
            if isinstance(analysis_result.get("pdf_integrity"), dict):
                dynamo.update_job(job_id, pdf_integrity=analysis_result["pdf_integrity"])

        needs_ocr = bool((analysis_result or {}).get("needs_ocr"))
        if not needs_ocr and job.get("operation") in _OCR_CAPABLE_OPERATIONS:
            needs_ocr = bool((job.get("analysis_result") or {}).get("needs_ocr"))

        # Backfill from Dynamo so SQS payload always carries analysis_result
        if not analysis_result:
            stored = job.get("analysis_result")
            if isinstance(stored, dict):
                analysis_result = stored
                analysis_source = "dynamo_backfill"

        log_event("info", "dispatch_analysis_resolved", None,
                  job_id=job_id,
                  analysis_source=analysis_source,
                  needs_ocr=needs_ocr,
                  has_ocr_indices=bool((analysis_result or {}).get("ocr_page_indices")),
                  operation=job.get("operation"))

        job_meta = operations.OPERATIONS.get(job.get("operation"), {})
        input_types = {str(item).lower().lstrip(".") for item in job_meta.get("input_types", [])}
        if "pdf" in input_types:
            try:
                source_bytes = s3.get_bytes(file_key)
                page_count = limits.count_pdf_pages(source_bytes)
            except Exception as exc:
                dynamo.mark_failed(job_id, f"Invalid PDF upload: {exc}")
                return response.error("Uploaded PDF could not be read.", 400)

            page_limit = limits.page_limit_for_user(user_id)
            if page_count > page_limit:
                dynamo.mark_failed(job_id, f"PDF has {page_count} pages; max {page_limit}")
                return response.error(f"PDF page limit exceeded. Max {page_limit} pages.", 413)

        if needs_ocr:
            tier = limits.tier_for_user_id(user_id)
            identity = user_id
            if not identity:
                identity = session_id = (event.get("queryStringParameters") or {}).get("session_id", "")
            if not identity:
                identity = job.get("session_id") or ""
            allowed = limits.record_daily_ocr(tier=tier, identity=identity)
            if not allowed:
                used = limits.ocr_used_today(tier=tier, identity=identity)
                limit = limits.daily_ocr_limit(tier)
                return response.error(
                    f"OCR daily limit reached ({used}/{limit}).",
                    429,
                )

        dynamo.update_job(job_id, status="QUEUED")

        payload = {
            "job_id": job_id,
            "operation": job["operation"],
            "file_key": file_key,
            "file_size_bytes": int(job.get("file_size_bytes", 0)),
            "file_name": job.get("file_name", "file"),
            "session_id": job.get("session_id", ""),
            "user_id": user_id,
            "params": params if isinstance(params, dict) else {},
        }
        if analysis_result and isinstance(analysis_result, dict):
            payload["analysis_result"] = analysis_result
        if isinstance(params, dict):
            payload.update(params)

        _sqs.send_message(QueueUrl=SQS_QUEUE_URL, MessageBody=json.dumps(payload))

        estimated = estimator.estimate_seconds(job["operation"], job.get("file_size_bytes", 0))

        # Persist the estimate and enqueue timestamp so GET /jobs/{id} can
        # drive the polling countdown. We use started_at instead of created_at
        # because the user sees this page after upload completes, so upload
        # latency should not stretch the remaining-time estimate.
        dynamo.update_job(
            job_id,
            estimated_seconds=estimated,
            started_at=int(time.time()),
        )

        log.info("Job queued", extra={"job_id": job_id, "operation": job["operation"]})
        return response.accepted({"success": True, "estimated_seconds": estimated})

    except Exception as exc:
        log.exception("process_job error: %s", exc)
        return response.error("Internal error", 500)
