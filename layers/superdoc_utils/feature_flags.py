import os
import time

import boto3

_ssm = boto3.client("ssm")
_cache: dict[str, tuple[bool, float]] = {}
_CACHE_TTL = 60  # seconds

_NAME_PREFIX = os.environ.get("NAME_PREFIX", "superdoc")


def _ssm_path(flag: str) -> str:
    # Current convention (Terraform): /<prefix>/features/<flag>
    return f"/{_NAME_PREFIX}/features/{flag}"


def _legacy_ssm_path(flag: str) -> str:
    # Backward compatible with earlier experiments.
    return f"/{_NAME_PREFIX}/flags/{flag}"


def get(flag: str, default: bool = True) -> bool:
    """Return flag value. Always fail open (returns default on any error)."""
    try:
        now = time.time()
        if flag in _cache:
            value, ts = _cache[flag]
            if now - ts < _CACHE_TTL:
                return value

        raw = None
        try:
            resp = _ssm.get_parameter(Name=_ssm_path(flag))
            raw = resp["Parameter"]["Value"].strip().lower()
        except Exception:
            resp = _ssm.get_parameter(Name=_legacy_ssm_path(flag))
            raw = resp["Parameter"]["Value"].strip().lower()

        value = raw in ("true", "1", "yes")
        _cache[flag] = (value, now)
        return value
    except Exception:
        return default


def disable(flag: str) -> None:
    try:
        _ssm.put_parameter(
            Name=_ssm_path(flag),
            Value="false",
            Type="String",
            Overwrite=True,
        )
        _cache.pop(flag, None)
    except Exception:
        pass


def enable(flag: str) -> None:
    try:
        _ssm.put_parameter(
            Name=_ssm_path(flag),
            Value="true",
            Type="String",
            Overwrite=True,
        )
        _cache.pop(flag, None)
    except Exception:
        pass
