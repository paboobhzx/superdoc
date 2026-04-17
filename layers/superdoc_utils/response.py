import json
from decimal import Decimal


class _DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Content-Type": "application/json",
}


def _build(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers": _CORS,
        "body": json.dumps(body, cls=_DecimalEncoder),
    }


def ok(body: dict) -> dict:
    return _build(200, body)


def accepted(body: dict) -> dict:
    return _build(202, body)


def error(msg: str, status: int = 400) -> dict:
    return _build(status, {"error": msg})


def preflight() -> dict:
    return _build(200, {"ok": True})
