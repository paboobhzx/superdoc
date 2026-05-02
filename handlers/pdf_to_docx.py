import json
import os
import tempfile

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)


def _extract_text_docx(data: bytes) -> bytes:
    from docx import Document
    import fitz

    doc = Document()
    doc.add_heading("Converted PDF", level=1)

    with fitz.open(stream=data, filetype="pdf") as pdf:
        for page_index, page in enumerate(pdf, start=1):
            text = page.get_text("text").strip()
            if page_index > 1:
                doc.add_page_break()
            if text:
                for paragraph in text.splitlines():
                    if paragraph.strip():
                        doc.add_paragraph(paragraph.strip())

    with tempfile.NamedTemporaryFile(suffix=".docx") as out:
        doc.save(out.name)
        out.seek(0)
        return out.read()


def _process(data: bytes, body: dict) -> bytes:
    try:
        from pdf2docx import Converter
    except ImportError:
        return _extract_text_docx(data)
    else:
        with tempfile.TemporaryDirectory(prefix="pdf-to-docx-") as workdir:
            input_path = os.path.join(workdir, "input.pdf")
            output_path = os.path.join(workdir, "output.docx")
            with open(input_path, "wb") as fh:
                fh.write(data)

            converter = Converter(input_path)
            try:
                converter.convert(output_path)
            finally:
                converter.close()

            with open(output_path, "rb") as fh:
                return fh.read()


def _output_filename(body: dict, file_key: str) -> str:
    original = body.get("file_name") or os.path.basename(file_key) or "converted.pdf"
    stem, _ext = os.path.splitext(os.path.basename(original))
    return f"{stem or 'converted'}.docx"


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _process(data, body)
        out_key = s3.make_output_key(job_id, file_key, _output_filename(body, file_key))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_docx done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_to_docx failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
