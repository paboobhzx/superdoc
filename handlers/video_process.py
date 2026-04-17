import json

import dynamo
import feature_flags
from logger import get_logger

log = get_logger(__name__)


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]

    if not feature_flags.get("video_processing_enabled"):
        log.warning("Video processing disabled by feature flag", extra={"job_id": job_id})
        dynamo.mark_failed(job_id, "Video processing temporarily unavailable")
        return  # do NOT re-raise — keeps message out of DLQ

    # Future: invoke FFmpeg processing here
    log.error("video_process reached active code path — not yet implemented", extra={"job_id": job_id})
    dynamo.mark_failed(job_id, "Video processing not yet implemented")
