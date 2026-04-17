from __future__ import annotations

import feature_flags


def is_open(operation: str = "") -> bool:
    """
    Simple circuit breaker backed by SSM feature flags.
    - Global: circuit_breaker_open
    - Per-operation: circuit_breaker_open_<operation>
    """
    if feature_flags.get("circuit_breaker_open", default=False):
        return True
    if operation:
        return feature_flags.get(f"circuit_breaker_open_{operation}", default=False)
    return False

