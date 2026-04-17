import os

import boto3

_s3 = boto3.client("s3")
MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET", "superdoc-media")
TTL_SECONDS = int(os.environ.get("TTL_SECONDS", "43200"))

_DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100MB


def presign_upload(file_key: str, expiry: int = TTL_SECONDS) -> str:
    return _s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": MEDIA_BUCKET, "Key": file_key},
        ExpiresIn=expiry,
    )

def presign_post_upload(
    file_key: str,
    max_bytes: int = _DEFAULT_MAX_UPLOAD_BYTES,
    expiry: int = TTL_SECONDS,
) -> dict:
    if max_bytes <= 0:
        max_bytes = _DEFAULT_MAX_UPLOAD_BYTES

    # S3 will reject uploads that exceed max_bytes before the object is created.
    conditions = [
        {"key": file_key},
        ["content-length-range", 0, int(max_bytes)],
    ]
    resp = _s3.generate_presigned_post(
        Bucket=MEDIA_BUCKET,
        Key=file_key,
        Conditions=conditions,
        ExpiresIn=expiry,
    )
    return {"url": resp["url"], "fields": resp["fields"]}


def presign_download(file_key: str, expiry: int = TTL_SECONDS) -> str:
    return _s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": MEDIA_BUCKET, "Key": file_key},
        ExpiresIn=expiry,
    )


def get_bytes(file_key: str) -> bytes:
    resp = _s3.get_object(Bucket=MEDIA_BUCKET, Key=file_key)
    return resp["Body"].read()


def put_bytes(file_key: str, data: bytes) -> None:
    _s3.put_object(Bucket=MEDIA_BUCKET, Key=file_key, Body=data)


def delete_key(file_key: str) -> None:
    if not file_key:
        return
    _s3.delete_object(Bucket=MEDIA_BUCKET, Key=file_key)


def output_prefix(job_id: str, file_key: str) -> str:
    """
    Derives an outputs prefix from an input uploads key.
    Examples:
      uploads/<job>/<file>                 -> outputs/<job>/
      users/<sub>/uploads/<job>/<file>     -> users/<sub>/outputs/<job>/
    """
    if not file_key:
        return f"outputs/{job_id}/"

    marker = f"/uploads/{job_id}/"
    if marker in file_key:
        root = file_key.split(marker, 1)[0]
        if root:
            return f"{root}/outputs/{job_id}/"
        return f"outputs/{job_id}/"

    if file_key.startswith("uploads/"):
        return f"outputs/{job_id}/"

    # Fall back: keep same top-level dir, but write into outputs/<jobId>/
    parts = file_key.split("/", 1)
    if len(parts) == 2 and parts[0]:
        return f"{parts[0]}/outputs/{job_id}/"
    return f"outputs/{job_id}/"


def make_output_key(job_id: str, file_key: str, filename: str) -> str:
    base = output_prefix(job_id, file_key)
    name = filename.lstrip("/")
    return f"{base}{name}"
