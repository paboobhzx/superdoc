import json
import os
import uuid

import dynamo
import circuit_breaker
import feature_flags
import operations
import rate_limit
import response
import s3
from logger import get_logger

log = get_logger(__name__)

_MAX_ITERATION_BYTES = 100 * 1024 * 1024  # 100MB
_USER_TTL_SECONDS = int(os.environ.get("USER_TTL_SECONDS", str(7 * 24 * 3600)))
_USER_MAX_DOCS = int(os.environ.get("USER_MAX_DOCS", "10"))
_ANON_MAX_ACTIVE_DOCS = int(os.environ.get("ANON_MAX_ACTIVE_DOCS", "4"))


def _rate_limit_enabled() -> bool:
    """Read RATE_LIMIT_ENABLED env var. Default true — fail closed.

    Terraform controls this via the `rate_limit_enabled` variable. When set
    to "false" (case-insensitive), all rate-limit and active-jobs checks are
    bypassed. Used to open the service up during early launch before auth
    and payments are wired."""
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

        claims = (
            (event.get("requestContext") or {})
            .get("authorizer", {})
            .get("claims", {})
        )
        body = json.loads(event.get("body") or "{}")
        operation = body.get("operation", "")
        file_name = _validate_file_name(body.get("file_name", "file"))
        file_size_bytes = int(body.get("file_size_bytes", 0))
        session_id = body.get("session_id", "anon")
        params = body.get("params") or {}

        user_id = claims.get("sub") or ""
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
            if not feature_flags.get("anonymous_ops_enabled", default=True):
                return response.error("Anonymous conversions are temporarily disabled.", 503)

            # Rate limit feature-flagged via env var so ops can toggle it
            # without a code change. Default on — disable only when launch
            # traffic is known and abuse mitigations are elsewhere.
            if _rate_limit_enabled() and not rate_limit.check(session_id):
                return response.error("Rate limit exceeded. Try again later.", 429)
        else:
            if _rate_limit_enabled() and not rate_limit.check_user(user_id):
                return response.error("Rate limit exceeded. Try again later.", 429)

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
            existing = dynamo.query_by_session(session_id)
            if len(existing) >= _USER_MAX_DOCS:
                return response.error("Storage limit reached (10 documents). Delete older files or wait for expiry.", 403)
            file_key = f"users/{session_id}/uploads/{job_id}/{file_name}"
            ttl_seconds = _USER_TTL_SECONDS
        else:
            existing = dynamo.query_by_session(session_id)
            active = [j for j in existing if j.get("status") not in ("DONE", "FAILED")]
            # Same feature flag applies to the anonymous active-jobs cap —
            # it's a per-session concurrency limit and disabling rate-limit
            # without disabling this would still produce 429s from here.
            if _rate_limit_enabled() and len(active) >= _ANON_MAX_ACTIVE_DOCS:
                return response.error("Too many active jobs. Please wait for current conversions to finish.", 429)
            file_key = f"uploads/{job_id}/{file_name}"
            ttl_seconds = int(os.environ.get("TTL_SECONDS", "43200"))

        dynamo.create_job(
            job_id=job_id,
            operation=operation,
            session_id=session_id,
            file_size_bytes=file_size_bytes,
            file_name=file_name,
            file_key=file_key,
            params=params,
            ttl_seconds=ttl_seconds,
        )

        upload = s3.presign_post_upload(file_key, max_bytes=_MAX_ITERATION_BYTES)

        log.info("Job created", extra={"job_id": job_id, "operation": operation})
        return response.ok({"job_id": job_id, "upload": upload, "file_key": file_key})

    except Exception as exc:
        log.exception("create_job error: %s", exc)
        return response.error("Internal error", 500)
