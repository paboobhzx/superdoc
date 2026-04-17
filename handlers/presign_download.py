import dynamo
import response
import s3
from logger import get_logger

log = get_logger(__name__)


def handler(event, context):
    try:
        job_id = (event.get("pathParameters") or {}).get("jobId", "")
        if not job_id:
            return response.error("jobId is required")

        job = dynamo.get_job(job_id)
        if not job:
            return response.error("Job not found", 404)

        if job.get("status") != "DONE":
            return response.error("Job output not ready", 409)

        output_key = job.get("output_key")
        if not output_key:
            return response.error("Output key not found", 404)

        download_url = s3.presign_download(output_key)
        return response.ok({"download_url": download_url, "job_id": job_id})

    except Exception as exc:
        log.exception("presign_download error: %s", exc)
        return response.error("Internal error", 500)
