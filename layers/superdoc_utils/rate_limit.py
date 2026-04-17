import time

import dynamo

_ANON_HOURLY_LIMIT = 3
_ANON_DAILY_LIMIT = 10
_USER_HOURLY_LIMIT = 60
_USER_DAILY_LIMIT = 250


def check(session_id: str) -> bool:
    """Returns True if allowed. Always fail open on errors."""
    try:
        now = int(time.time())
        hour_bucket = now // 3600
        day_bucket = now // 86400

        hour_ttl = (hour_bucket + 1) * 3600 + 300
        day_ttl = (day_bucket + 1) * 86400 + 300

        hour_count = dynamo.rate_limit_increment(
            pk=f"anon#{session_id}",
            sk=f"hour#{hour_bucket}",
            ttl=hour_ttl,
        )
        if hour_count > _ANON_HOURLY_LIMIT:
            return False

        day_count = dynamo.rate_limit_increment(
            pk=f"anon#{session_id}",
            sk=f"day#{day_bucket}",
            ttl=day_ttl,
        )
        if day_count > _ANON_DAILY_LIMIT:
            return False

        return True
    except Exception:
        return True


def check_user(user_id: str) -> bool:
    """Registered-user rate limit (higher than anonymous). Always fail open on errors."""
    if not user_id:
        return True
    try:
        now = int(time.time())
        hour_bucket = now // 3600
        day_bucket = now // 86400

        hour_ttl = (hour_bucket + 1) * 3600 + 300
        day_ttl = (day_bucket + 1) * 86400 + 300

        hour_count = dynamo.rate_limit_increment(
            pk=f"user#{user_id}",
            sk=f"hour#{hour_bucket}",
            ttl=hour_ttl,
        )
        if hour_count > _USER_HOURLY_LIMIT:
            return False

        day_count = dynamo.rate_limit_increment(
            pk=f"user#{user_id}",
            sk=f"day#{day_bucket}",
            ttl=day_ttl,
        )
        if day_count > _USER_DAILY_LIMIT:
            return False

        return True
    except Exception:
        return True
