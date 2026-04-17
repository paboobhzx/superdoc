import io
import json
import zipfile

import dynamo
import s3
from logger import get_logger
from pypdf import PdfReader, PdfWriter

log = get_logger(__name__)


def _parse_ranges(ranges_str: str, total_pages: int) -> list[tuple[int, int]]:
    """Parse '1-3,5,7-9' into [(0,2),(4,4),(6,8)] (0-indexed)."""
    if not ranges_str:
        return [(0, total_pages - 1)]
    result = []
    for part in ranges_str.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            result.append((int(start) - 1, int(end) - 1))
        else:
            idx = int(part) - 1
            result.append((idx, idx))
    return result


def _process(data: bytes, body: dict) -> bytes:
    reader = PdfReader(io.BytesIO(data))
    total = len(reader.pages)
    ranges = _parse_ranges(body.get("ranges", ""), total)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, (start, end) in enumerate(ranges):
            writer = PdfWriter()
            for page_idx in range(start, min(end + 1, total)):
                writer.add_page(reader.pages[page_idx])
            part_buf = io.BytesIO()
            writer.write(part_buf)
            zf.writestr(f"part_{i+1}.pdf", part_buf.getvalue())

    return buf.getvalue()


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _process(data, body)
        out_key = s3.make_output_key(job_id, file_key, "split.zip")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_split done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_split failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
