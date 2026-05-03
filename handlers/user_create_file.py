import json
import os
import uuid

import auth_session
import dynamo
import response
import s3
from logger import get_logger

log = get_logger(__name__)

_MAX_BYTES = 100 * 1024 * 1024
_USER_TTL_SECONDS = int(os.environ.get("USER_TTL_SECONDS", str(7 * 24 * 3600)))
_USER_MAX_DOCS = int(os.environ.get("USER_MAX_DOCS", "10"))


def _validate_file_name(file_name: str) -> str:
    if not file_name:
        return "file"
    if "/" in file_name or "\\" in file_name:
        raise ValueError("file_name must not contain path separators")
    return os.path.basename(file_name)


def handler(event, context):
    try:
        if event.get("httpMethod") == "OPTIONS":
            return response.preflight()

        user_id = auth_session.current_user_id(event)
        if not user_id:
            return response.error("Unauthorized", 401)

        body = json.loads(event.get("body") or "{}")
        file_name = _validate_file_name(body.get("file_name", "file"))
        file_size_bytes = int(body.get("file_size_bytes", 0))

        if file_size_bytes <= 0:
            return response.error("file_size_bytes must be > 0")
        if file_size_bytes > _MAX_BYTES:
            return response.error("File too large. Max 100MB per upload.", 413)

        existing = dynamo.query_by_session(user_id)
        if len(existing) >= _USER_MAX_DOCS:
            return response.error("Storage limit reached (10 documents). Delete older files or wait for expiry.", 403)

        job_id = str(uuid.uuid4())
        output_key = f"users/{user_id}/outputs/{job_id}/{file_name}"

        dynamo.create_job(
            job_id=job_id,
            operation="store",
            session_id=user_id,
            file_size_bytes=file_size_bytes,
            file_name=file_name,
            file_key=output_key,
            params={},
            ttl_seconds=_USER_TTL_SECONDS,
            status="UPLOADING",
            output_key=output_key,
        )

        upload = s3.presign_post_upload(output_key, max_bytes=_MAX_BYTES)
        log.info("User file upload created", extra={"job_id": job_id, "session_id": user_id})
        return response.ok({"job_id": job_id, "upload": upload, "output_key": output_key})

    except ValueError as exc:
        return response.error(str(exc), 400)
    except Exception as exc:
        log.exception("user_create_file error: %s", exc)
        return response.error("Internal error", 500)
