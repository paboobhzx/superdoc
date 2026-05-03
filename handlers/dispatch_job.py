import json
import os

import boto3
import operations
from logger import get_logger

log = get_logger(__name__)

_lambda = boto3.client("lambda")

NAME_PREFIX = os.environ.get("NAME_PREFIX", "superdoc-dev")

def handler(event, context):
    for record in event.get("Records", []):
        body_str = record.get("body", "{}")
        try:
            body = json.loads(body_str)
        except json.JSONDecodeError:
            log.error("Invalid JSON in SQS message body", extra={"body": body_str})
            continue

        operation = body.get("operation", "")
        fn_suffix = operations.OPERATION_FUNCTION_SUFFIX.get(operation)

        if not fn_suffix:
            log.error("Unknown operation, skipping", extra={"operation": operation, "job_id": body.get("job_id")})
            continue

        function_name = f"{NAME_PREFIX}-{fn_suffix}"

        # Forward original SQS record so handlers can use event["Records"][0]["body"]
        # Invoke asynchronously so the dispatcher can ack the queue message
        # quickly; the worker Lambda owns the actual status transition.
        _lambda.invoke(
            FunctionName=function_name,
            InvocationType="Event",  # async — fire and forget
            Payload=json.dumps({"Records": [{"body": body_str}]}),
        )

        log.info(
            "Dispatched job",
            extra={"operation": operation, "job_id": body.get("job_id"), "function": function_name},
        )
