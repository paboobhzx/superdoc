import json
import os

import boto3
import dynamo
import estimator
import response
from logger import get_logger

log = get_logger(__name__)

_sqs = boto3.client("sqs")
SQS_QUEUE_URL = os.environ.get("SQS_QUEUE_URL", "")


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
        params = job.get("params") or {}

        dynamo.update_job(job_id, status="QUEUED")

        payload = {
            "job_id": job_id,
            "operation": job["operation"],
            "file_key": file_key,
            "file_size_bytes": int(job.get("file_size_bytes", 0)),
            "file_name": job.get("file_name", "file"),
        }
        if isinstance(params, dict):
            payload.update(params)

        _sqs.send_message(QueueUrl=SQS_QUEUE_URL, MessageBody=json.dumps(payload))

        estimated = estimator.estimate_seconds(job["operation"], job.get("file_size_bytes", 0))

        log.info("Job queued", extra={"job_id": job_id, "operation": job["operation"]})
        return response.accepted({"success": True, "estimated_seconds": estimated})

    except Exception as exc:
        log.exception("process_job error: %s", exc)
        return response.error("Internal error", 500)
