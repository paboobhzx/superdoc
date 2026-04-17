import functools
from typing import Callable, TypeVar

from tenacity import retry, stop_after_attempt, wait_exponential

F = TypeVar("F", bound=Callable)


def retry_with_backoff(func: F) -> F:
    """Decorator: 3 attempts, exponential backoff 1-8s."""
    return retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        reraise=True,
    )(func)
