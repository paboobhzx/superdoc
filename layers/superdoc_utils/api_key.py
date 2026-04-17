import hashlib
import os
import time

import boto3
import dynamo

_cloudwatch = boto3.client("cloudwatch")
_API_KEYS_TABLE = os.environ.get("API_KEYS_TABLE", "superdoc-api-keys")
_dynamodb = boto3.resource("dynamodb")


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def validate(raw_key: str) -> bool:
    """Returns True if key is valid. Records CloudWatch metric on use."""
    try:
        table = _dynamodb.Table(_API_KEYS_TABLE)
        key_hash = _hash(raw_key)
        resp = table.get_item(Key={"key_hash": key_hash})
        item = resp.get("Item")
        if not item:
            return False

        if item.get("expires_at", 0) < int(time.time()):
            return False

        _cloudwatch.put_metric_data(
            Namespace="SuperDoc/APIKeys",
            MetricData=[
                {
                    "MetricName": "APIKeyUsage",
                    "Dimensions": [{"Name": "KeyId", "Value": item.get("key_id", "unknown")}],
                    "Value": 1,
                    "Unit": "Count",
                }
            ],
        )
        return True
    except Exception:
        return False
