import dynamo
import response
import s3
from logger import get_logger

log = get_logger(__name__)

def _claims(event: dict) -> dict:
    return (
        (event.get("requestContext") or {})
        .get("authorizer", {})
        .get("claims", {})
    ) or {}


def _current_user_id(event: dict) -> str:
    return _claims(event).get("sub") or ""


def handler(event, context):
    try:
        method = event.get("httpMethod", "GET")
        if method == "OPTIONS":
            return response.preflight()

        user_id = _current_user_id(event)
        session_id = user_id or (event.get("queryStringParameters") or {}).get("session_id", "")

        if not session_id:
            return response.error("session_id required", 400)

        if method == "DELETE":
            job_id = (event.get("pathParameters") or {}).get("jobId", "")
            if not job_id:
                return response.error("jobId required", 400)

            job = dynamo.get_job(job_id)
            if not job:
                return response.error("Job not found", 404)

            if user_id and job.get("session_id") != user_id:
                return response.error("Forbidden", 403)

            s3.delete_key(job.get("file_key", ""))
            s3.delete_key(job.get("output_key", ""))
            dynamo.delete_job(job_id)
            return response.ok({"deleted": True, "job_id": job_id})

        jobs = dynamo.query_by_session(session_id)

        for job in jobs:
            if job.get("status") == "DONE" and job.get("output_key"):
                job["download_url"] = s3.presign_download(job["output_key"])
            job.pop("expires_at", None)

        return response.ok({"jobs": jobs})

    except Exception as exc:
        log.exception("user_files error: %s", exc)
        return response.error("Internal error", 500)
