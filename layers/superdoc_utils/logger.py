import json
import logging
import os


def get_logger(name: str) -> logging.Logger:
    level = os.environ.get("LOG_LEVEL", "DEBUG").upper()
    logger = logging.getLogger(name)
    logger.setLevel(level)

    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setLevel(level)

        class JsonFormatter(logging.Formatter):
            def format(self, record: logging.LogRecord) -> str:
                payload = {
                    "level": record.levelname,
                    "message": record.getMessage(),
                    "logger": record.name,
                }
                for key in ("job_id", "operation", "session_id"):
                    if hasattr(record, key):
                        payload[key] = getattr(record, key)
                return json.dumps(payload)

        handler.setFormatter(JsonFormatter())
        logger.addHandler(handler)
        logger.propagate = False

    return logger
