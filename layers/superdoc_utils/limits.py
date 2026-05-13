from __future__ import annotations

import io
import os
import time
from datetime import datetime, timezone

import dynamo

_ANON_DAILY_CONVERSION_LIMIT = int(os.environ.get("ANON_DAILY_CONVERSION_LIMIT", "3"))
_USER_DAILY_CONVERSION_LIMIT = int(os.environ.get("USER_DAILY_CONVERSION_LIMIT", "10"))
_ANON_PDF_PAGE_LIMIT = int(os.environ.get("ANON_PDF_PAGE_LIMIT", "100"))
_USER_PDF_PAGE_LIMIT = int(os.environ.get("USER_PDF_PAGE_LIMIT", "300"))
_DEFAULT_TTL_SECONDS = int(os.environ.get("DEFAULT_TTL_SECONDS", "900"))
_ANON_STORAGE_TTL_SECONDS = int(os.environ.get("TTL_SECONDS", "43200"))
_USER_STORAGE_TTL_SECONDS = int(os.environ.get("USER_TTL_SECONDS", "64800"))
_REGISTERED_FREE_MULTIMEDIA_DAILY_LIMIT = int(os.environ.get("REGISTERED_FREE_MULTIMEDIA_DAILY_LIMIT", "1"))


def tier_for_user_id(user_id: str | None) -> str:
    return "registered" if user_id else "anonymous"


def daily_conversion_limit(tier: str) -> int:
    return _USER_DAILY_CONVERSION_LIMIT if tier == "registered" else _ANON_DAILY_CONVERSION_LIMIT


def page_limit(tier: str) -> int:
    return _USER_PDF_PAGE_LIMIT if tier == "registered" else _ANON_PDF_PAGE_LIMIT


def storage_ttl_seconds(tier: str) -> int:
    return _USER_STORAGE_TTL_SECONDS if tier == "registered" else _ANON_STORAGE_TTL_SECONDS


def quota_day_bucket(now: int | None = None) -> str:
    ts = int(now if now is not None else time.time())
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def quota_key(*, tier: str, identity: str, now: int | None = None) -> str:
    return f"quota#{tier}#{identity}#{quota_day_bucket(now)}"


def quota_ttl_seconds(now: int | None = None) -> int:
    ts = int(now if now is not None else time.time())
    current = datetime.fromtimestamp(ts, tz=timezone.utc)
    next_day = datetime(current.year, current.month, current.day, tzinfo=timezone.utc).timestamp() + 86400
    return int(next_day) + 300


def record_daily_conversion(*, tier: str, identity: str, now: int | None = None) -> bool:
    if not identity:
        return True
    key = quota_key(tier=tier, identity=identity, now=now)
    count = dynamo.rate_limit_increment(key, quota_ttl_seconds(now))
    return count <= daily_conversion_limit(tier)


def multimedia_quota_key(*, user_id: str, now: int | None = None) -> str:
    return f"quota#multimedia#registered#{user_id}#{quota_day_bucket(now)}"


def multimedia_free_remaining(user_id: str, now: int | None = None) -> int:
    if not user_id:
        return 0
    used = dynamo.rate_limit_count(multimedia_quota_key(user_id=user_id, now=now))
    return max(_REGISTERED_FREE_MULTIMEDIA_DAILY_LIMIT - used, 0)


def page_limit_for_user(user_id: str | None) -> int:
    return page_limit(tier_for_user_id(user_id))


def storage_ttl_for_user(user_id: str | None) -> int:
    return storage_ttl_seconds(tier_for_user_id(user_id))


def storage_ttl_for_retention(is_registered: bool, retention_choice: str | None) -> int:
    choice = str(retention_choice or "default").strip().lower()
    if choice == "extended":
        return _USER_STORAGE_TTL_SECONDS if is_registered else _ANON_STORAGE_TTL_SECONDS
    return _DEFAULT_TTL_SECONDS


def count_pdf_pages(pdf_bytes: bytes) -> int:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    return len(reader.pages)


def assert_pdf_page_limit(pdf_bytes: bytes, user_id: str | None) -> int:
    page_count = count_pdf_pages(pdf_bytes)
    limit = page_limit_for_user(user_id)
    if page_count > limit:
        raise ValueError(f"PDF has {page_count} pages; max {limit}")
    return page_count
