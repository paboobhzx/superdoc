import json
import os
from decimal import Decimal


class _DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


_CORS = {
    "Access-Control-Allow-Origin": os.environ.get("CORS_ALLOW_ORIGIN", "https://superdoc.pablobhz.cloud"),
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Content-Type": "application/json",
}


def _build(status_code: int, body: dict, headers: dict | None = None) -> dict:
    return {
        "statusCode": status_code,
        "headers": {**_CORS, **(headers or {})},
        "body": json.dumps(body, cls=_DecimalEncoder),
    }


def ok(body: dict, headers: dict | None = None) -> dict:
    return _build(200, body, headers=headers)


def accepted(body: dict) -> dict:
    return _build(202, body)


def error(msg: str, status: int = 400) -> dict:
    return _build(status, {"error": msg})


def preflight() -> dict:
    return _build(200, {"ok": True})
