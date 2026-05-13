import json
import os
import uuid

import dynamo
import auth_session
import circuit_breaker
import feature_flags
import limits
import operations
import rate_limit
import response
import s3
from logger import get_logger

log = get_logger(__name__)

_MAX_ITERATION_BYTES = 100 * 1024 * 1024  # 100MB
_ANON_MAX_ACTIVE_DOCS = int(os.environ.get("ANON_MAX_ACTIVE_DOCS", "4"))


def _normalize_retention_choice(value) -> str:
    choice = str(value or "default").strip().lower()
    return "extended" if choice == "extended" else "default"


def _rate_limit_enabled() -> bool:
    """Read RATE_LIMIT_ENABLED env var for the anonymous active-jobs cap.

    Terraform controls this via the `rate_limit_enabled` variable. When set
    to "false" (case-insensitive), only the anonymous concurrency cap is
    bypassed. Daily conversion quotas remain enforced."""
    raw = os.environ.get("RATE_LIMIT_ENABLED", "true").strip().lower()
    return raw not in ("false", "0", "no", "off")


def _validate_file_name(file_name: str) -> str:
    if not file_name:
        return "file"
    # Avoid creating nested keys via user-provided names.
    if "/" in file_name or "\\" in file_name:
        raise ValueError("file_name must not contain path separators")
    return os.path.basename(file_name)


def handler(event, context):
    try:
        if event.get("httpMethod") == "OPTIONS":
            return response.preflight()

        body = json.loads(event.get("body") or "{}")
        operation = body.get("operation", "")
        file_name = _validate_file_name(body.get("file_name", "file"))
        file_size_bytes = int(body.get("file_size_bytes", 0))
        session_id = (body.get("session_id") or "").strip()
        params = body.get("params") or {}
        analysis_result = body.get("analysis_result") or None
        retention_choice = _normalize_retention_choice(body.get("retention_choice"))

        user_id = auth_session.current_user_id(event)
        is_registered = bool(user_id)
        if is_registered:
            session_id = user_id

        if not operation:
            return response.error("operation is required")

        if feature_flags.get("maintenance_mode", default=False):
            return response.error("Service temporarily unavailable. Try again later.", 503)

        if not operations.is_supported(operation):
            return response.error("Unsupported operation", 400)

        if circuit_breaker.is_open(operation):
            return response.error("This operation is temporarily unavailable. Try again later.", 503)

        if operation == "video_process" and not feature_flags.get("video_processing_enabled", default=True):
            return response.error("Video processing is temporarily disabled.", 503)

        if not is_registered:
            try:
                uuid.UUID(session_id)
            except (TypeError, ValueError):
                return response.error("valid session_id is required", 400)

            if not feature_flags.get("anonymous_ops_enabled", default=True):
                return response.error("Anonymous conversions are temporarily disabled.", 503)

            if not rate_limit.check(session_id):
                return response.error("Daily conversion limit reached. Try again tomorrow.", 429)
        else:
            if not rate_limit.check_user(user_id):
                return response.error("Daily conversion limit reached. Try again tomorrow.", 429)

        if file_size_bytes <= 0:
            return response.error("file_size_bytes must be > 0")

        if file_size_bytes > _MAX_ITERATION_BYTES:
            return response.error("File too large. Max 100MB per upload.", 413)

        params_validation = operations.validate_params(operation, params)
        if not params_validation.ok:
            return response.error(params_validation.error, 400)
        params = params_validation.params or {}

        job_id = str(uuid.uuid4())
        if is_registered:
            file_key = f"users/{session_id}/uploads/{job_id}/{file_name}"
        else:
            existing = dynamo.query_by_session(session_id)
            active = [j for j in existing if j.get("status") not in ("DONE", "FAILED")]
            # Same feature flag applies to the anonymous active-jobs cap —
            # it's a per-session concurrency limit and disabling rate-limit
            # without disabling this would still produce 429s from here.
            if _rate_limit_enabled() and len(active) >= _ANON_MAX_ACTIVE_DOCS:
                return response.error("Too many active jobs. Please wait for current conversions to finish.", 429)
            file_key = f"uploads/{job_id}/{file_name}"

        ttl_seconds = limits.storage_ttl_for_retention(is_registered, retention_choice)

        job_item = dynamo.create_job(
            job_id=job_id,
            operation=operation,
            session_id=session_id,
            user_id=user_id if is_registered else None,
            file_size_bytes=file_size_bytes,
            file_name=file_name,
            file_key=file_key,
            params=params,
            ttl_seconds=ttl_seconds,
            retention_choice=retention_choice,
        )
        # Persist analysis_result alongside the job for diagnostic purposes
        if analysis_result and isinstance(analysis_result, dict):
            dynamo.update_job(job_id, analysis_result=analysis_result)

        upload = s3.presign_post_upload(file_key, max_bytes=_MAX_ITERATION_BYTES, expiry=ttl_seconds)

        log.info("Job created", extra={"job_id": job_id, "operation": operation})
        return response.ok({"job_id": job_id, "upload": upload, "file_key": file_key})

    except Exception as exc:
        log.exception("create_job error: %s", exc)
        return response.error("Internal error", 500)
