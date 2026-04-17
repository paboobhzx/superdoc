import dynamo
import response
import s3
from logger import get_logger

log = get_logger(__name__)


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

        if job.get("status") == "DONE" and job.get("output_key"):
            job["download_url"] = s3.presign_download(job["output_key"])

        # Remove internal fields
        job.pop("expires_at", None)

        return response.ok(job)

    except Exception as exc:
        log.exception("get_status error: %s", exc)
        return response.error("Internal error", 500)
