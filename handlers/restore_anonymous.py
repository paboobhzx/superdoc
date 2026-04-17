import feature_flags
from logger import get_logger

log = get_logger(__name__)


def handler(event, context):
    try:
        log.info("Restoring anonymous access via EventBridge trigger")
        feature_flags.enable("anonymous_enabled")
        log.info("Anonymous access restored")
    except Exception as exc:
        log.exception("restore_anonymous error: %s", exc)
        raise
