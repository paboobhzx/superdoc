# handlers/list_operations.py - GET /operations
#
# Read-only endpoint that exposes the operation catalog to the frontend.
# Deliberately minimal: no DB, no S3, no auth. The Lambda's IAM role reflects
# this via the (still over-granted) default module profile - see TODO in
# infra/main.tf.

import operations
import response
from logger import get_logger

log = get_logger(__name__)


def handler(event, context):
    """API Gateway AWS_PROXY handler for GET /operations[?input_type=<ext>].

    Catches broad Exception and returns 500 because raising would leak into
    API Gateway as the DEFAULT_5XX gateway response (the same failure we
    spent hours on in Round 1). A controlled JSON error is friendlier to
    the frontend - it can surface a toast instead of a broken screen.
    """
    if event.get("httpMethod") == "OPTIONS":
        return response.preflight()

    try:
        qs = event.get("queryStringParameters")
        input_type = None
        if qs is not None:
            raw = qs.get("input_type")
            if raw is not None:
                stripped = raw.strip()
                if stripped != "":
                    input_type = stripped

        ops = operations.list_operations(input_type=input_type)
        return response.ok({"operations": ops, "count": len(ops)})

    except Exception as exc:
        log.exception("list_operations error: %s", exc)
        return response.error("Internal error", 500)
