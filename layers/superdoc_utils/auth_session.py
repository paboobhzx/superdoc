import hashlib
import os
import time

import dynamo

SESSION_COOKIE_NAME = os.environ.get("AUTH_SESSION_COOKIE_NAME", "superdoc_session")


def hash_session_id(session_id: str) -> str:
    return hashlib.sha256(session_id.encode("utf-8")).hexdigest()


def _claims(event: dict) -> dict:
    return (
        (event.get("requestContext") or {})
        .get("authorizer", {})
        .get("claims", {})
    ) or {}


def _cookie_header(event: dict) -> str:
    headers = event.get("headers") or {}
    for key, value in headers.items():
        if key.lower() == "cookie":
            return value or ""
    cookies = event.get("cookies") or []
    return "; ".join(cookies)


def session_cookie(event: dict) -> str:
    cookie_header = _cookie_header(event)
    for part in cookie_header.split(";"):
        name, sep, value = part.strip().partition("=")
        if sep and name == SESSION_COOKIE_NAME:
            return value
    return ""


def current_user(event: dict) -> dict:
    claims = _claims(event)
    if claims.get("sub"):
        return {
            "user_id": claims.get("sub") or "",
            "email": claims.get("email") or "",
            "source": "cognito",
        }

    raw_session_id = session_cookie(event)
    if not raw_session_id:
        return {}

    session = dynamo.get_auth_session(hash_session_id(raw_session_id))
    if not session:
        return {}

    expires_at = int(session.get("expires_at") or 0)
    if expires_at <= int(time.time()):
        try:
            dynamo.delete_auth_session(hash_session_id(raw_session_id))
        except Exception:
            pass
        return {}

    return {
        "user_id": session.get("user_id") or "",
        "email": session.get("email") or "",
        "source": "session",
        "session_id_hash": hash_session_id(raw_session_id),
    }


def current_user_id(event: dict) -> str:
    return current_user(event).get("user_id") or ""
