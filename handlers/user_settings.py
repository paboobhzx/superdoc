"""
GET  /users/me/settings  — returns current settings or defaults
PUT  /users/me/settings  — upserts settings for authenticated user
"""
import json
import os

import auth_session
import response
from logger import get_logger

log = get_logger(__name__)

_TABLE_NAME = os.environ.get("USER_SETTINGS_TABLE", "")
_ddb = None

_DEFAULTS = {
    "theme": "azure",
    "locale": "en-US",
    "name": "",
    "country": "",
    "notifications": {
        "email_ready": True,
        "quota_alerts": True,
    },
}

_ALLOWED_FIELDS = {"theme", "locale", "notifications", "name", "country"}


def _table():
    global _ddb
    if _ddb is None:
        import boto3
        _ddb = boto3.resource("dynamodb").Table(_TABLE_NAME)
    return _ddb


def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return response.preflight()

    try:
        user = auth_session.current_user(event)
        user_id = user.get("user_id") or ""
        if not user_id:
            return response.error("Sign in required", 401)

        method = event.get("httpMethod", "GET")

        if method == "GET":
            item = _table().get_item(Key={"user_id": user_id}).get("Item")
            if item:
                item.pop("user_id", None)
            return response.ok(item or _DEFAULTS)

        if method == "PUT":
            body = json.loads(event.get("body") or "{}")
            updates = {k: body[k] for k in _ALLOWED_FIELDS if k in body}
            if not updates:
                return response.error("Nothing to update", 400)

            _table().update_item(
                Key={"user_id": user_id},
                UpdateExpression="SET " + ", ".join(f"#{k}=:{k}" for k in updates),
                ExpressionAttributeNames={f"#{k}": k for k in updates},
                ExpressionAttributeValues={f":{k}": v for k, v in updates.items()},
            )
            merged = {**_DEFAULTS, **updates}
            return response.ok(merged)

        return response.error("Method not allowed", 405)

    except Exception as exc:
        log.exception("user_settings error: %s", exc)
        return response.error("Internal error", 500)
