import time

import boto3
import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)

_s3_client = boto3.client("s3")


def handler(event, context):
    now = int(time.time())
    expired = dynamo.scan_expired(now)
    log.info("Found %d expired jobs to clean up", len(expired))

    deleted = 0
    failed = 0

    for job in expired:
        job_id = job.get("job_id")
        try:
            file_name = job.get("file_name", "file")
            upload_key = f"uploads/{job_id}/{file_name}"
            output_key = job.get("output_key")

            try:
                _s3_client.delete_object(Bucket=s3.MEDIA_BUCKET, Key=upload_key)
            except Exception:
                pass

            if output_key:
                try:
                    _s3_client.delete_object(Bucket=s3.MEDIA_BUCKET, Key=output_key)
                except Exception:
                    pass

            dynamo.delete_job(job_id)
            deleted += 1
        except Exception as exc:
            log.exception("Failed to clean job %s: %s", job_id, exc)
            failed += 1

    log.info("Cleanup done: deleted=%d failed=%d", deleted, failed)
    return {"deleted": deleted, "failed": failed}
