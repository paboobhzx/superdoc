import json
import os

import boto3
import response
from logger import get_logger

log = get_logger(__name__)

_ssm = boto3.client("ssm")
_NAME_PREFIX = os.environ.get("NAME_PREFIX", "superdoc")
_ADMIN_GROUP = "superdoc-admins"


def _is_admin(event: dict) -> bool:
    claims = (
        (event.get("requestContext") or {})
        .get("authorizer", {})
        .get("claims", {})
    )
    groups = claims.get("cognito:groups", "")
    return _ADMIN_GROUP in groups


def _list_flags() -> list:
    path = f"/{_NAME_PREFIX}/flags/"
    resp = _ssm.get_parameters_by_path(Path=path, Recursive=False)
    flags = []
    for p in resp.get("Parameters", []):
        name = p["Name"].split("/")[-1]
        flags.append({"flag": name, "value": p["Value"], "modified_at": str(p.get("LastModifiedDate", ""))})
    return flags


def handler(event, context):
    try:
        if not _is_admin(event):
            return response.error("Forbidden", 403)

        method = event.get("httpMethod", "GET")

        if method == "GET":
            flags = _list_flags()
            return response.ok({"flags": flags})

        if method == "POST":
            body = json.loads(event.get("body") or "{}")
            flag = body.get("flag", "")
            value = body.get("value", "")
            if not flag or value == "":
                return response.error("flag and value are required")

            _ssm.put_parameter(
                Name=f"/{_NAME_PREFIX}/flags/{flag}",
                Value=str(value).lower(),
                Type="String",
                Overwrite=True,
            )
            return response.ok({"flag": flag, "value": str(value).lower()})

        return response.error("Method not allowed", 405)

    except Exception as exc:
        log.exception("admin_flags error: %s", exc)
        return response.error("Internal error", 500)
