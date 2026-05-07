import json
import io
import os
import shutil
import subprocess
import tempfile

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)

_LIBREOFFICE_BIN = os.environ.get("LIBREOFFICE_BIN", "libreoffice")


def _pdf_to_docx(pdf_bytes: bytes) -> bytes:
    if not shutil.which(_LIBREOFFICE_BIN):
        raise RuntimeError(f"LibreOffice executable not found: {_LIBREOFFICE_BIN}")

    with tempfile.TemporaryDirectory(prefix="pdf-to-docx-") as workdir:
        outdir = os.path.join(workdir, "out")
        profile = os.path.join(workdir, "profile")
        os.makedirs(outdir, exist_ok=True)
        os.makedirs(profile, exist_ok=True)

        source_path = os.path.join(workdir, "input.pdf")
        with open(source_path, "wb") as fh:
            fh.write(pdf_bytes)

        cmd = [
            _LIBREOFFICE_BIN,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            "--nolockcheck",
            f"-env:UserInstallation=file://{profile}",
            "--infilter=writer_pdf_import",
            "--convert-to",
            "docx:MS Word 2007 XML",
            "--outdir",
            outdir,
            source_path,
        ]
        completed = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=int(os.environ.get("LIBREOFFICE_TIMEOUT_SECONDS", "240")),
        )
        if completed.returncode != 0:
            stderr = completed.stderr.decode("utf-8", errors="replace").strip()
            stdout = completed.stdout.decode("utf-8", errors="replace").strip()
            detail = stderr or stdout or f"exit code {completed.returncode}"
            raise RuntimeError(f"LibreOffice DOCX export failed: {detail}")

        docx_path = os.path.join(outdir, "input.docx")
        if not os.path.exists(docx_path):
            raise RuntimeError("LibreOffice DOCX export did not produce an output file")

        with open(docx_path, "rb") as fh:
            return fh.read()


def _extract_text_docx(pdf_bytes: bytes) -> bytes:
    from docx import Document
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    doc = Document()
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            doc.add_paragraph(text)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def _process(pdf_bytes: bytes, body: dict) -> bytes:
    try:
        return _pdf_to_docx(pdf_bytes)
    except Exception:
        try:
            from pdf2docx import Converter
        except Exception:
            return _extract_text_docx(pdf_bytes)

        with tempfile.TemporaryDirectory(prefix="pdf2docx-") as workdir:
            source_path = os.path.join(workdir, "input.pdf")
            output_path = os.path.join(workdir, _output_filename(body, source_path))
            with open(source_path, "wb") as fh:
                fh.write(pdf_bytes)
            converter = Converter(source_path)
            try:
                converter.convert(output_path)
            finally:
                converter.close()
            with open(output_path, "rb") as fh:
                return fh.read()


def _output_filename(body: dict, file_key: str) -> str:
    original = body.get("file_name") or os.path.basename(file_key) or "document.pdf"
    stem, _ext = os.path.splitext(os.path.basename(original))
    return f"{stem or 'document'}.docx"


def handler(event, context):
    # EventBridge warmup ping arrives as a direct invocation, not via SQS.
    if event.get("_warmup"):
        log.info("warmup ping received")
        return
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
