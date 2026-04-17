import os
import time
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

_dynamodb = boto3.resource("dynamodb")

JOBS_TABLE = os.environ.get("JOBS_TABLE", "superdoc-jobs")
INCIDENTS_TABLE = os.environ.get("INCIDENTS_TABLE", "superdoc-incidents")
RATE_LIMITS_TABLE = os.environ.get("RATE_LIMITS_TABLE", "superdoc-rate-limits")
TTL_SECONDS = int(os.environ.get("TTL_SECONDS", "43200"))


def _jobs():
    return _dynamodb.Table(JOBS_TABLE)


def _incidents():
    return _dynamodb.Table(INCIDENTS_TABLE)


def _rate_limits():
    return _dynamodb.Table(RATE_LIMITS_TABLE)


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
    update_job(job_id, status="DONE", output_key=output_key, completed_at=int(time.time()))


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
