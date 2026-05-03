import auth_session
import dynamo
import response
from logger import get_logger

log = get_logger(__name__)


def handler(event, context):
    try:
        method = event.get("httpMethod", "POST")
        if method == "OPTIONS":
            return response.preflight()

        user_id = auth_session.current_user_id(event)
        if not user_id:
            return response.error("Unauthorized", 401)

        job_id = (event.get("pathParameters") or {}).get("jobId", "")
        if not job_id:
            return response.error("jobId is required", 400)

        job = dynamo.get_job(job_id)
        if not job:
            return response.error("Job not found", 404)

        if job.get("session_id") != user_id:
            return response.error("Forbidden", 403)

        if job.get("status") == "DONE":
            return response.ok({"success": True, "job_id": job_id})

        if job.get("status") not in ("UPLOADING", "PENDING"):
            return response.error(f"Job not uploadable (current: {job.get('status')})", 409)

        out_key = job.get("output_key") or job.get("file_key") or ""
        if not out_key:
            return response.error("Missing output_key", 500)

        dynamo.mark_done(job_id, out_key)
        log.info("User file completed", extra={"job_id": job_id, "session_id": user_id})
        return response.ok({"success": True, "job_id": job_id})

    except Exception as exc:
        log.exception("user_complete_file error: %s", exc)
        return response.error("Internal error", 500)
