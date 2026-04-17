import json
import time
import uuid

import dynamo
import response
from logger import get_logger

log = get_logger(__name__)

_ADMIN_GROUP = "superdoc-admins"


def _is_admin(event: dict) -> bool:
    claims = (
        (event.get("requestContext") or {})
        .get("authorizer", {})
        .get("claims", {})
    )
    groups = claims.get("cognito:groups", "")
    return _ADMIN_GROUP in groups


def handler(event, context):
    try:
        if not _is_admin(event):
            return response.error("Forbidden", 403)

        method = event.get("httpMethod", "GET")

        if method == "GET":
            incidents = dynamo.list_incidents()
            return response.ok({"incidents": incidents})

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            incident = {
                "incident_id": str(uuid.uuid4()),
                "created_at": int(time.time()),
                "title": body.get("title", "Untitled"),
                "description": body.get("description", ""),
                "severity": body.get("severity", "low"),
                "status": body.get("status", "open"),
            }
            dynamo.put_incident(incident)
            return response.ok(incident)

        return response.error("Method not allowed", 405)

    except Exception as exc:
        log.exception("admin_incidents error: %s", exc)
        return response.error("Internal error", 500)
