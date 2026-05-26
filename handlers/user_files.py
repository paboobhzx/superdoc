import auth_session
import dynamo
import response
import s3
import uuid
from logger import get_logger

log = get_logger(__name__)

def _valid_anon_session(session_id: str) -> bool:
    try:
        uuid.UUID(session_id)
        return True
    except (TypeError, ValueError):
        return False


def handler(event, context):
    try:
        method = event.get("httpMethod", "GET")
        if method == "OPTIONS":
            return response.preflight()

        user_id = auth_session.current_user_id(event)
        session_id = user_id or (event.get("queryStringParameters") or {}).get("session_id", "")

        if method == "DELETE":
            # DELETE requires a valid identity for ownership verification.
            if not session_id:
                return response.error("session_id required", 400)
            if not user_id and not _valid_anon_session(session_id):
                return response.error("valid session_id required", 400)
        else:
            # GET: if we can't identify the session, return an empty list.
            # Safe (no data leakage) and avoids spurious 400 toasts during
            # the migration window after VITE_API_URL was changed to /api.
            if not session_id or (not user_id and not _valid_anon_session(session_id)):
                return response.ok({"jobs": []})

        if method == "DELETE":
            job_id = (event.get("pathParameters") or {}).get("jobId", "")
            if not job_id:
                return response.error("jobId required", 400)

            job = dynamo.get_job(job_id)
            if not job:
                return response.error("Job not found", 404)

            if job.get("session_id") != session_id:
                return response.error("Forbidden", 403)

            s3.delete_key(job.get("file_key", ""))
            s3.delete_key(job.get("output_key", ""))
            for value in (job.get("output_keys") or {}).values():
                s3.delete_key(value)
            dynamo.delete_job(job_id)
            return response.ok({"deleted": True, "job_id": job_id})

        if user_id:
            jobs = dynamo.query_jobs_by_user(user_id)
        else:
            jobs = dynamo.query_by_session(session_id)

        for job in jobs:
            if job.get("status") == "DONE" and job.get("output_key"):
                job["download_url"] = s3.presign_download(job["output_key"])

        return response.ok({"jobs": jobs})

    except Exception as exc:
        log.exception("user_files error: %s", exc)
        return response.error("Internal error", 500)
