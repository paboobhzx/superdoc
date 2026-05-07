from __future__ import annotations

import limits


def _check(tier: str, identity: str) -> bool:
    """Daily conversion quota. Fail open on unexpected backend errors."""
    if not identity:
        return True
    try:
        return limits.record_daily_conversion(tier=tier, identity=identity)
    except Exception:
        return True


def check(session_id: str) -> bool:
    return _check("anonymous", session_id)


def check_user(user_id: str) -> bool:
    return _check("registered", user_id)
