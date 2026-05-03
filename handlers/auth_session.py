import json
import os
import secrets
import time

import boto3
import auth_session
import dynamo
import response
from logger import get_logger

log = get_logger(__name__)

_cognito = boto3.client("cognito-idp")

CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID", "")
SESSION_TTL_SECONDS = int(os.environ.get("AUTH_SESSION_TTL_SECONDS", str(7 * 24 * 3600)))
COOKIE_NAME = os.environ.get("AUTH_SESSION_COOKIE_NAME", auth_session.SESSION_COOKIE_NAME)


def _route(event: dict) -> str:
    path = event.get("path") or event.get("rawPath") or ""
    return path.rstrip("/").rsplit("/", 1)[-1]


def _cookie(value: str, *, max_age: int) -> str:
    return (
        f"{COOKIE_NAME}={value}; Path=/; Max-Age={max_age}; "
        "HttpOnly; Secure; SameSite=Lax"
    )


def _user_from_access_token(access_token: str) -> dict:
    data = _cognito.get_user(AccessToken=access_token)
    attrs = {a.get("Name"): a.get("Value") for a in data.get("UserAttributes", [])}
    return {
        "user_id": attrs.get("sub") or data.get("Username") or "",
        "email": attrs.get("email") or "",
    }


def _login(event: dict) -> dict:
    body = json.loads(event.get("body") or "{}")
    email = (body.get("email") or "").strip()
    password = body.get("password") or ""
    if not email or not password:
        return response.error("Email and password are required.", 400)
    if not CLIENT_ID:
        return response.error("Auth not configured.", 503)

    try:
        auth_result = _cognito.initiate_auth(
            ClientId=CLIENT_ID,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": email, "PASSWORD": password},
        ).get("AuthenticationResult", {})
    except _cognito.exceptions.UserNotConfirmedException:
        return response.error("User is not confirmed.", 403)
    except _cognito.exceptions.NotAuthorizedException:
        return response.error("Incorrect email or password.", 401)
    except _cognito.exceptions.UserNotFoundException:
        return response.error("Incorrect email or password.", 401)

    access_token = auth_result.get("AccessToken") or ""
    refresh_token = auth_result.get("RefreshToken") or ""
    if not access_token or not refresh_token:
        return response.error("Sign in did not return a usable session.", 502)

    user = _user_from_access_token(access_token)
    if not user.get("user_id"):
        return response.error("Sign in did not return a user id.", 502)

    raw_session_id = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + SESSION_TTL_SECONDS
    dynamo.put_auth_session(
        session_id_hash=auth_session.hash_session_id(raw_session_id),
        user_id=user["user_id"],
        email=user.get("email") or email,
        refresh_token=refresh_token,
        expires_at=expires_at,
    )

    return response.ok(
        {"user": {"id": user["user_id"], "email": user.get("email") or email}},
        headers={"Set-Cookie": _cookie(raw_session_id, max_age=SESSION_TTL_SECONDS)},
    )


def _me(event: dict) -> dict:
    user = auth_session.current_user(event)
    if not user.get("user_id"):
        return response.error("Unauthorized", 401)
    return response.ok({"user": {"id": user["user_id"], "email": user.get("email") or ""}})


def _logout(event: dict) -> dict:
    raw_session_id = auth_session.session_cookie(event)
    if raw_session_id:
        dynamo.delete_auth_session(auth_session.hash_session_id(raw_session_id))
    return response.ok({"ok": True}, headers={"Set-Cookie": _cookie("", max_age=0)})


def handler(event, context):
    try:
        method = event.get("httpMethod", "GET")
        if method == "OPTIONS":
            return response.preflight()

        route = _route(event)
        if method == "POST" and route == "login":
            return _login(event)
        if method == "GET" and route == "me":
            return _me(event)
        if method == "POST" and route == "logout":
            return _logout(event)

        return response.error("Not found", 404)
    except Exception as exc:
        log.exception("auth_session error: %s", exc)
        return response.error("Internal error", 500)
