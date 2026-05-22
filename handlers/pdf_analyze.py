"""Synchronous PDF complexity analysis endpoint."""

import dynamo
import response
import s3
from logger import get_logger
from pdf_integrity import analyze_pdf_integrity as _analyze_pdf_integrity
from pdf_inspector import analyze_pdf as _analyze_pdf

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

        source_bytes = s3.get_bytes(file_key)
        try:
            result = _analyze_pdf(source_bytes)
        except Exception:
            result = {
                "complexity_score": 0,
                "recommendation": "text",
                "high_fidelity_viable": False,
                "regular_text_viable": True,
                "rationale_keys": [],
                "page_count": 0,
                "file_size_mb": round(len(source_bytes) / 1024 / 1024, 2),
                "signals": {},
                "estimated_seconds": {},
            }
        result["pdf_integrity"] = _analyze_pdf_integrity(source_bytes, job.get("operation"))
        dynamo.update_job(job_id, pdf_integrity=result["pdf_integrity"])

        log.info(
            "pdf_analyze done",
            extra={
                "job_id": job_id,
                "complexity_score": result["complexity_score"],
                "recommendation": result["recommendation"],
                "page_count": result["page_count"],
                "integrity_score": result["pdf_integrity"]["score"],
            },
        )
        return response.ok(result)

    except Exception as exc:
        log.exception("pdf_analyze error: %s", exc)
        return response.error("Analysis failed", 500)
