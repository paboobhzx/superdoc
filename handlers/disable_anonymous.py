import json
import time
import uuid

import dynamo
import feature_flags
import response
from logger import get_logger

log = get_logger(__name__)


def handler(event, context):
    try:
        for record in event.get("Records", []):
            msg = json.loads(record.get("Sns", {}).get("Message", "{}"))
            reason = msg.get("reason", "Auto-disabled due to cost threshold")
            log.warning("Disabling anonymous access: %s", reason)

            feature_flags.disable("anonymous_enabled")

            incident = {
                "incident_id": str(uuid.uuid4()),
                "created_at": int(time.time()),
                "title": "Anonymous access disabled",
                "description": reason,
                "severity": "high",
                "status": "open",
            }
            dynamo.put_incident(incident)
            log.info("Incident recorded: %s", incident["incident_id"])

    except Exception as exc:
        log.exception("disable_anonymous error: %s", exc)
        raise
