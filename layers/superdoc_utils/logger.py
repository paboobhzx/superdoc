import hashlib
import json
import logging
import os

_ENV = os.environ.get("SUPERDOC_ENV", "prod")

# Keys whose values are PII-hashed (first 12 hex chars of SHA-256)
_PII_KEYS = frozenset({"file_name", "session_id", "user_id"})

# Internal logging keys to exclude from the structured output
_INTERNAL_KEYS = frozenset({
    "args", "created", "exc_info", "exc_text", "filename", "funcName",
    "levelname", "levelno", "lineno", "module", "msecs", "msg", "name",
    "pathname", "process", "processName", "relativeCreated", "stack_info",
    "taskName", "thread", "threadName",
})


def _pii_hash(value: str) -> str:
    """SHA-256 truncated to 12 hex chars — enough to correlate, not to identify."""
    return hashlib.sha256(str(value).encode()).hexdigest()[:12]


class _JsonFormatter(logging.Formatter):
    """Emits every field in record.__dict__ as a flat JSON object.

    PII keys are automatically hashed. Environment is always injected.
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "environment": _ENV,
        }
        for key, value in record.__dict__.items():
            if key in _INTERNAL_KEYS or key in payload:
                continue
            if key in _PII_KEYS and value:
                payload[key + "_hash"] = _pii_hash(value)
            elif key == "message":
                continue
            else:
                payload[key] = value
        if record.exc_info and not record.exc_text:
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text:
            payload["exception"] = record.exc_text
        return json.dumps(payload, default=str)


def get_logger(name: str) -> logging.Logger:
    level = os.environ.get("LOG_LEVEL", "DEBUG").upper()
    logger = logging.getLogger(name)
    logger.setLevel(level)

    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setLevel(level)
        handler.setFormatter(_JsonFormatter())
        logger.addHandler(handler)
        logger.propagate = False

    return logger


def log_event(
    level: str,
    event: str,
    job: dict | None = None,
    *,
    logger_name: str = "superdoc",
    **extras,
) -> None:
    """Structured log emitter with automatic job context injection.

    Usage::

        log_event("info", "ocr_succeeded", job, page_index=0, word_count=312)
        log_event("warning", "ocr_no_words", job, page_index=0, tesseract_available=False)

    Standard keys always present when ``job`` is provided:
        event, job_id, operation, file_size_bytes, environment,
        plus any **extras.

    PII fields (file_name, session_id, user_id) are SHA-256 hashed.
    """
    logger = get_logger(logger_name)
    context = {"event": event}

    if job and isinstance(job, dict):
        context["job_id"] = job.get("job_id") or job.get("id", "")
        context["operation"] = job.get("operation", "")
        context["file_size_bytes"] = job.get("file_size_bytes", 0)
        for pii_key in _PII_KEYS:
            val = job.get(pii_key)
            if val:
                context[pii_key] = val  # formatter handles hashing

    context.update(extras)

    log_fn = getattr(logger, level.lower(), logger.info)
    log_fn(event, extra=context)
