import os
import time
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

_dynamodb = boto3.resource("dynamodb")

JOBS_TABLE = os.environ.get("JOBS_TABLE", "superdoc-jobs")
INCIDENTS_TABLE = os.environ.get("INCIDENTS_TABLE", "superdoc-incidents")
RATE_LIMITS_TABLE = os.environ.get("RATE_LIMITS_TABLE", "superdoc-rate-limits")
AUTH_SESSIONS_TABLE = os.environ.get("AUTH_SESSIONS_TABLE", "superdoc-auth-sessions")
TTL_SECONDS = int(os.environ.get("TTL_SECONDS", "43200"))


def _jobs():
    return _dynamodb.Table(JOBS_TABLE)


def _incidents():
    return _dynamodb.Table(INCIDENTS_TABLE)


def _rate_limits():
    return _dynamodb.Table(RATE_LIMITS_TABLE)


def _auth_sessions():
    return _dynamodb.Table(AUTH_SESSIONS_TABLE)


def create_job(
    job_id: str,
    operation: str,
    session_id: str,
    file_size_bytes: int,
    file_name: str,
    file_key: str,
    params: dict | None = None,
    ttl_seconds: int = TTL_SECONDS,
    status: str = "PENDING",
    output_key: str | None = None,
) -> dict:
    now_ts = int(time.time())
    now_iso = datetime.fromtimestamp(now_ts, tz=timezone.utc).isoformat()
    ttl = int(ttl_seconds) if ttl_seconds and int(ttl_seconds) > 0 else TTL_SECONDS
    item = {
        "job_id": job_id,
        "operation": operation,
        "session_id": session_id,
        "file_size_bytes": file_size_bytes,
        "file_name": file_name,
        "file_key": file_key,
        "params": params or {},
        "status": status or "PENDING",
        "created_at": now_iso,         # String — required by user-history-index GSI
        "expires_at": now_ts + ttl,  # Number — DynamoDB TTL
    }
    if output_key:
        item["output_key"] = output_key
    _jobs().put_item(Item=item)
    return item


def get_job(job_id: str) -> dict:
    resp = _jobs().get_item(Key={"job_id": job_id})
    return resp.get("Item", {})


def update_job(job_id: str, **kwargs) -> None:
    if not kwargs:
        return
    expressions = []
    attr_names = {}
    attr_values = {}
    for i, (k, v) in enumerate(kwargs.items()):
        placeholder = f"#f{i}"
        value_key = f":v{i}"
        expressions.append(f"{placeholder} = {value_key}")
        attr_names[placeholder] = k
        attr_values[value_key] = v

    _jobs().update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET " + ", ".join(expressions),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )


def mark_done(job_id: str, output_key: str) -> None:
    completed_at = int(time.time())
    job = get_job(job_id)
    if not job:
        # TTL cleanup can race with late callbacks. Preserve the terminal state
        # even if the original row is already gone, but skip duration math.
        update_job(job_id, status="DONE", output_key=output_key, completed_at=completed_at)
        return

    started_at = job.get("started_at")
    actual_seconds = None
    if isinstance(started_at, (int, float)):
        # started_at is the best countdown anchor because it excludes upload
        # time; created_at would overstate the runtime for the user.
        actual_seconds = max(int(completed_at - started_at), 0)
    else:
        # Older jobs may not have started_at yet. Fall back to created_at so
        # the UI still gets a useful completion duration instead of nothing.
        created_at_iso = job.get("created_at")
        if isinstance(created_at_iso, str):
            try:
                created_dt = datetime.fromisoformat(created_at_iso.replace("Z", "+00:00"))
                actual_seconds = max(int(completed_at - created_dt.timestamp()), 0)
            except (ValueError, AttributeError):
                actual_seconds = None

    fields = {
        "status": "DONE",
        "output_key": output_key,
        "completed_at": completed_at,
    }
    if actual_seconds is not None:
        fields["actual_seconds"] = actual_seconds
    update_job(job_id, **fields)


def mark_failed(job_id: str, error: str) -> None:
    update_job(job_id, status="FAILED", error=error, completed_at=int(time.time()))


def query_by_session(session_id: str) -> list:
    resp = _jobs().query(
        IndexName="session-index",
        KeyConditionExpression=Key("session_id").eq(session_id),
    )
    return resp.get("Items", [])


def scan_expired(now: int) -> list:
    resp = _jobs().scan(
        FilterExpression="expires_at < :now AND #s <> :done",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":now": now, ":done": "DONE"},
    )
    return resp.get("Items", [])


def delete_job(job_id: str) -> None:
    _jobs().delete_item(Key={"job_id": job_id})


def put_incident(incident: dict) -> None:
    _incidents().put_item(Item=incident)


def list_incidents() -> list:
    resp = _incidents().scan()
    return resp.get("Items", [])


def rate_limit_increment(pk: str, sk: str, ttl: int) -> int:
    table = _rate_limits()
    resp = table.update_item(
        Key={"pk": pk, "sk": sk},
        UpdateExpression="ADD #c :one SET expires_at = if_not_exists(expires_at, :ttl)",
        ExpressionAttributeNames={"#c": "count"},
        ExpressionAttributeValues={":one": 1, ":ttl": ttl},
        ReturnValues="UPDATED_NEW",
    )
    return int(resp["Attributes"]["count"])


def put_auth_session(
    session_id_hash: str,
    user_id: str,
    email: str,
    refresh_token: str,
    expires_at: int,
) -> None:
    _auth_sessions().put_item(
        Item={
            "session_id_hash": session_id_hash,
            "user_id": user_id,
            "email": email or "",
            "refresh_token": refresh_token,
            "created_at": int(time.time()),
            "expires_at": int(expires_at),
        }
    )


def get_auth_session(session_id_hash: str) -> dict:
    resp = _auth_sessions().get_item(Key={"session_id_hash": session_id_hash})
    return resp.get("Item", {})


def delete_auth_session(session_id_hash: str) -> None:
    _auth_sessions().delete_item(Key={"session_id_hash": session_id_hash})

# ── Payments table helpers (added in round 3a-2) ────────────────────────────
# The payments table is used for Stripe-backed conversions. Schema:
#   payment_id (pk, S)   uuid of the pending/paid payment
#   status     (S)       "PENDING" | "PAID" | "CONSUMED"
#   job_id     (S)       uuid of the eventual job (created on payment)
#   operation  (S)       operation id (e.g. "docx_to_pdf")
#   session_id (S)       caller's session id or user sub
#   file_name  (S)
#   file_size_bytes (N)
#   created_at (N)
#   ttl        (N)       24h from creation (auto-cleanup for abandoned checkouts)

def put_payment(*, table, payment_id, status, job_id, operation, file_name,
                file_size_bytes, session_id, ttl):
    """Create a pending payment record. Called when a Checkout Session starts."""
    import time
    _client().put_item(
        TableName=table,
        Item={
            "payment_id":       {"S": payment_id},
            "status":           {"S": status},
            "job_id":           {"S": job_id},
            "operation":        {"S": operation},
            "file_name":        {"S": file_name},
            "file_size_bytes":  {"N": str(int(file_size_bytes))},
            "session_id":       {"S": session_id},
            "created_at":       {"N": str(int(time.time()))},
            "ttl":              {"N": str(int(ttl))},
        },
    )


def get_payment(table, payment_id):
    """Return the payment record as a plain dict, or None if missing."""
    resp = _client().get_item(
        TableName=table,
        Key={"payment_id": {"S": payment_id}},
    )
    item = resp.get("Item")
    if item is None:
        return None
    result = {}
    for key, av in item.items():
        if "S" in av:
            result[key] = av["S"]
        elif "N" in av:
            result[key] = int(av["N"])
    return result


def update_payment_status(table, payment_id, new_status):
    """Flip status (PENDING -> PAID, PAID -> CONSUMED). Idempotent."""
    _client().update_item(
        TableName=table,
        Key={"payment_id": {"S": payment_id}},
        UpdateExpression="SET #s = :s",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": {"S": new_status}},
    )
