import time

import boto3
import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)

_s3_client = boto3.client("s3")


def _delete_key(key: str) -> None:
    if not key:
        return
    _s3_client.delete_object(Bucket=s3.MEDIA_BUCKET, Key=key)


def _iter_output_keys(job: dict):
    output_key = job.get("output_key")
    if output_key:
        yield output_key

    output_keys = job.get("output_keys")
    if isinstance(output_keys, dict):
        for value in output_keys.values():
            if value:
                yield value
    elif isinstance(output_keys, list):
        for value in output_keys:
            if value:
                yield value


def handler(event, context):
    now = int(time.time())
    expired = dynamo.scan_all_expired(now)
    log.info("Found %d expired jobs to sweep", len(expired))

    purged = 0
    skipped = 0
    failed = 0

    for job in expired:
        job_id = job.get("job_id")
        if job.get("purge_status") == "purged":
            skipped += 1
            continue

        try:
            _delete_key(job.get("file_key"))
            for key in _iter_output_keys(job):
                _delete_key(key)
            dynamo.mark_job_purged(job_id)
            purged += 1
        except Exception as exc:
            log.exception("Failed to purge expired job %s: %s", job_id, exc)
            failed += 1

    log.info("Expired-file sweep done: purged=%d skipped=%d failed=%d", purged, skipped, failed)
    return {"purged": purged, "skipped": skipped, "failed": failed}
