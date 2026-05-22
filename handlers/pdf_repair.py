"""Synchronous PDF repair endpoint."""

import dynamo
import response
import s3
from logger import get_logger
from pdf_integrity import analyze_pdf_integrity, repair_pdf_bytes

log = get_logger(__name__)


def handler(event, context):
    try:
        if event.get("httpMethod") == "OPTIONS":
            return response.preflight()

        job_id = (event.get("pathParameters") or {}).get("jobId") or ""
        if not job_id:
            return response.error("jobId is required", 400)

        qs = event.get("queryStringParameters") or {}
        session_id = qs.get("session_id") or ""

        job = dynamo.get_job(job_id)
        if not job:
            return response.error("Job not found", 404)
        if job.get("status") != "PENDING":
            return response.error("Repair is only allowed before processing starts.", 409)

        job_user_id = job.get("user_id") or ""
        if job_user_id:
            import auth_session
            user = auth_session.current_user(event)
            if (user.get("user_id") or "") != job_user_id:
                return response.error("Forbidden", 403)
        elif not session_id or job.get("session_id") != session_id:
            return response.error("Forbidden", 403)

        file_key = job.get("file_key") or ""
        if not file_key:
            return response.error("Job has no associated file", 422)

        original_pdf = s3.get_bytes(file_key)
        repaired_pdf = repair_pdf_bytes(original_pdf)
        repaired_key = s3.make_output_key(job_id, file_key, "repaired.pdf")
        s3.put_bytes(repaired_key, repaired_pdf)
        integrity = analyze_pdf_integrity(repaired_pdf, job.get("operation"))
        integrity["repaired_pdf_key"] = repaired_key

        dynamo.update_job(
            job_id,
            file_key=repaired_key,
            pdf_integrity=integrity,
            repair_result={"repaired": True, "repaired_pdf_key": repaired_key},
        )
        return response.ok({"success": True, "pdf_integrity": integrity, "repaired": True})
    except Exception as exc:
        log.exception("pdf_repair error: %s", exc)
        return response.error("Repair failed", 500)
