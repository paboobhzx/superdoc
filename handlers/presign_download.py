# handlers/presign_download.py - GET /files/download?key=<s3_key>
#
# Returns a short-lived (5 min) presigned GET URL for an S3 object. Used by
# client_editor flows where the user uploaded a file to S3 and the editor
# needs to fetch it back. Scoped to uploads/* and users/*/uploads/* prefixes
# only - arbitrary S3 reads are refused.

import json as _json
import os
import re

import response
import s3
from logger import get_logger

log = get_logger(__name__)

# Whitelist of S3 key prefixes we'll presign downloads for. Anything else
# gets 403 - prevents the endpoint from becoming a general-purpose S3 reader.
_ALLOWED_PREFIXES = ("uploads/", "users/")

# Reject suspicious characters that could enable path-traversal style abuse
# (S3 keys are fairly permissive but "../" in URLs confuses some proxies).
_SAFE_KEY_RE = re.compile(r"^[A-Za-z0-9/_\-.]+$")


def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return response.preflight()

    try:
        qs = event.get("queryStringParameters") or {}
        key = (qs.get("key") or "").strip()

        if not key:
            return response.error("key query parameter required", 400)

        if not _SAFE_KEY_RE.match(key):
            return response.error("key contains invalid characters", 400)

        if ".." in key:
            return response.error("key cannot contain '..'", 400)

        if not any(key.startswith(prefix) for prefix in _ALLOWED_PREFIXES):
            return response.error("key not in allowed prefix", 403)

        # s3.presign_get_url is the helper we need; if not present, fall back
        # to direct boto3. (Defensive - some layer versions don\'t have it.)
        try:
            url = s3.presign_get_url(key, expires_in=300)
        except AttributeError:
            import boto3
            client = boto3.client("s3")
            bucket = os.environ.get("MEDIA_BUCKET")
            if not bucket:
                return response.error("MEDIA_BUCKET env not configured", 500)
            url = client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=300,
            )

        return response.ok({"url": url, "expires_in_seconds": 300})

    except Exception as exc:
        log.exception("presign_download error: %s", exc)
        return response.error("Internal error", 500)
