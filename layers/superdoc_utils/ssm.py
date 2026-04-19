# layers/superdoc_utils/ssm.py
#
# Thin wrapper around SSM GetParameter with in-process caching. Lambda
# containers persist between invocations for the same function, so caching
# here meaningfully reduces SSM call volume (and cost). Cache is keyed by
# parameter name + decrypt flag and lives for the container\'s lifetime.

import os

import boto3

from logger import get_logger

log = get_logger(__name__)

_CACHE = {}
_ssm_client = None


def _client():
    global _ssm_client
    if _ssm_client is None:
        _ssm_client = boto3.client("ssm", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    return _ssm_client


def get_parameter(name: str, decrypt: bool = False) -> str:
    """Fetch an SSM parameter value, with in-process cache.

    Raises botocore.exceptions.ClientError if the parameter doesn\'t exist.
    Callers should catch and return a proper HTTP response rather than leaking
    AWS exceptions to the API client.
    """
    cache_key = (name, decrypt)
    if cache_key in _CACHE:
        return _CACHE[cache_key]

    resp = _client().get_parameter(Name=name, WithDecryption=decrypt)
    value = resp["Parameter"]["Value"]
    _CACHE[cache_key] = value
    return value


def bust_cache():
    """Exposed for tests - clear the in-memory cache."""
    _CACHE.clear()
