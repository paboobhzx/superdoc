"""Make a scanned PDF searchable/selectable by overlaying OCR text.

Uses ocrmypdf to run Tesseract OCR and produce a PDF with an invisible text
layer.  The visual appearance is preserved — only the text layer is added.
"""

import json
import tempfile

import dynamo
import output_naming
import s3
from logger import get_logger, log_event

log = get_logger(__name__)


def _process(data: bytes, body: dict) -> bytes:
    import ocrmypdf

    params = body.get("params") or {}
    language = params.get("language", "eng+por")

    with tempfile.NamedTemporaryFile(suffix=".pdf") as src, \
         tempfile.NamedTemporaryFile(suffix=".pdf") as dst:
        src.write(data)
        src.flush()

        ocrmypdf.ocr(
            src.name,
            dst.name,
            language=language,
            skip_text=True,       # don't re-OCR pages that already have text
            optimize=1,           # lossless optimisation
            jobs=2,               # parallelism within Lambda vCPU budget
            progress_bar=False,
        )

        dst.seek(0)
        return dst.read()


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]

    job = {
        "job_id": job_id,
        "operation": body.get("operation", "pdf_make_editable"),
        "file_size_bytes": body.get("file_size_bytes", 0),
        "file_name": body.get("file_name", ""),
        "session_id": body.get("session_id", ""),
        "user_id": body.get("user_id", ""),
    }

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        dynamo.update_progress(job_id, 5, "Reading PDF")
        log_event("info", "job_started", job)

        data = s3.get_bytes(file_key)
        dynamo.update_progress(job_id, 10, "Running OCR")
        result = _process(data, body)
        dynamo.update_progress(job_id, 90, "Saving output")

        out_key = s3.make_output_key(
            job_id, file_key,
            output_naming.output_filename("pdf_make_editable", body, file_key, "pdf"),
        )
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)

        log_event("info", "job_completed", job,
                  input_bytes=len(data), output_bytes=len(result))

    except Exception as exc:
        log_event("error", "job_failed", job, error=str(exc))
        dynamo.mark_failed(job_id, str(exc))
        raise
