import json as _json
import io
import os
import shutil
import subprocess
import tempfile
import zipfile

import dynamo
import limits
import output_naming
import s3
from logger import get_logger

log = get_logger(__name__)

_LIBREOFFICE_BIN = os.environ.get("LIBREOFFICE_BIN", "libreoffice")

_PAPER_SIZES_MM: dict[str, tuple[float, float]] = {
    "A4":     (210.0,  297.0),
    "A3":     (297.0,  420.0),
    "Letter": (215.9,  279.4),
    "Legal":  (215.9,  355.6),
    "A5":     (148.0,  210.0),
}


def _set_docx_paper_size(docx_bytes: bytes, paper_size: str) -> bytes:
    """Return docx_bytes with every section resized to paper_size (e.g. 'A4', 'Letter')."""
    dims = _PAPER_SIZES_MM.get(paper_size)
    if not dims:
        return docx_bytes
    from docx import Document
    from docx.shared import Mm
    w_mm, h_mm = dims
    doc = Document(io.BytesIO(docx_bytes))
    for section in doc.sections:
        section.page_width = Mm(w_mm)
        section.page_height = Mm(h_mm)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _docx_to_pdf(docx_bytes: bytes, paper_size: str | None = None) -> bytes:
    if paper_size:
        docx_bytes = _set_docx_paper_size(docx_bytes, paper_size)
    return _office_to_pdf(docx_bytes, "input.docx")


def _docx_to_image_zip(docx_bytes: bytes, target_format: str = "png", dpi: int = 150, paper_size: str | None = None) -> bytes:
    pdf_bytes = _docx_to_pdf(docx_bytes, paper_size=paper_size)
    return _render_pdf_to_zip(pdf_bytes, target_format=target_format, dpi=dpi)


def _render_pdf_to_zip(pdf_bytes: bytes, target_format: str, dpi: int) -> bytes:
    import pymupdf

    target = (target_format or "png").lower()
    if target == "jpeg":
        target = "jpg"
    if target not in {"png", "jpg"}:
        raise ValueError("target_format must be one of: jpg, png")

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        buffer = io.BytesIO()
        matrix = pymupdf.Matrix(dpi / 72.0, dpi / 72.0)
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_STORED) as zf:
            for page_num in range(doc.page_count):
                page = doc.load_page(page_num)
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                image_bytes = pix.tobytes("jpeg" if target == "jpg" else "png")
                zf.writestr(f"page-{page_num + 1:04d}.{target}", image_bytes)
        return buffer.getvalue()
    finally:
        doc.close()


def _office_to_pdf(source_bytes: bytes, source_name: str) -> bytes:
    if not shutil.which(_LIBREOFFICE_BIN):
        raise RuntimeError(f"LibreOffice executable not found: {_LIBREOFFICE_BIN}")

    with tempfile.TemporaryDirectory(prefix="office-to-pdf-") as workdir:
        outdir = os.path.join(workdir, "out")
        profile = os.path.join(workdir, "profile")
        os.makedirs(outdir, exist_ok=True)
        os.makedirs(profile, exist_ok=True)

        source_path = os.path.join(workdir, source_name)
        with open(source_path, "wb") as fh:
            fh.write(source_bytes)

        cmd = [
            _LIBREOFFICE_BIN,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            "--nolockcheck",
            f"-env:UserInstallation=file://{profile}",
            "--convert-to",
            "pdf",
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
            raise RuntimeError(f"LibreOffice PDF export failed: {detail}")

        pdf_path = os.path.join(outdir, f"{os.path.splitext(source_name)[0]}.pdf")
        if not os.path.exists(pdf_path):
            raise RuntimeError("LibreOffice PDF export did not produce an output file")

        with open(pdf_path, "rb") as fh:
            result = fh.read()
        if not result.startswith(b"%PDF"):
            raise RuntimeError("LibreOffice PDF export produced an invalid PDF")
        return result


def handler(event, context):
    # EventBridge warmup ping arrives as a direct invocation, not via SQS.
    if event.get("_warmup"):
        log.info("warmup ping received")
        return
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    operation = body.get("operation", "docx_to_pdf")
    params = body.get("params") or {}
    # Keep one worker for both PDF export and page-image export. The latter
    # only activates for the explicit docx_to_image operation or when the
    # target format is an image extension.
    target_format = (params.get("target_format") or body.get("target_format") or "pdf").lower()
    dpi = int(params.get("dpi") or body.get("dpi") or 150)
    paper_size = params.get("paper_size") or None

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        pdf_bytes = _docx_to_pdf(data, paper_size=paper_size)
        limits.assert_pdf_page_limit(pdf_bytes, body.get("user_id") or "")
        if operation == "docx_to_image" or target_format in ("png", "jpg", "jpeg"):
            result = _render_pdf_to_zip(pdf_bytes, target_format=target_format, dpi=dpi)
            output_name = output_naming.output_filename(operation, body, file_key, "zip")
        else:
            result = pdf_bytes
            output_name = output_naming.output_filename(operation, body, file_key, "pdf")
        out_key = s3.make_output_key(job_id, file_key, output_name)
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("docx_to_pdf done", extra={"job_id": job_id, "target_format": target_format})
    except Exception as exc:
        log.exception("docx_to_pdf failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
