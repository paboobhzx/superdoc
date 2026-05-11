import copy
import io
import json
import os
import shutil
import subprocess
import tempfile

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)

_LIBREOFFICE_BIN = os.environ.get("LIBREOFFICE_BIN", "libreoffice")
_SECONDS_PER_PAGE = 8  # conservative estimate for pdf2docx on Lambda
_CHUNK_SIZE = 40       # pages per chunk — keeps each conversion well under the 300 s timeout


def _pdf_to_docx_libreoffice(pdf_bytes: bytes) -> bytes:
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


def _parse_page_range(page_range: str, total: int) -> list[int]:
    """Parse '1-5,8,10-12' into a sorted 0-indexed list, clamped to [0, total).

    Empty string returns all pages.
    """
    if not page_range or not page_range.strip():
        return list(range(total))
    indices: set[int] = set()
    for part in page_range.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            start = max(0, int(a.strip()) - 1)
            end = min(int(b.strip()) - 1, total - 1)
            if start <= end:
                indices.update(range(start, end + 1))
        else:
            idx = int(part.strip()) - 1
            if 0 <= idx < total:
                indices.add(idx)
    return sorted(indices)


def _merge_docx(docx_bytes_list: list[bytes]) -> bytes:
    """Merge DOCX chunks into one document, remapping image relationships."""
    from docx import Document
    from docx.oxml.ns import qn

    if len(docx_bytes_list) == 1:
        return docx_bytes_list[0]

    _IMAGE_RTYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    _R_EMBED = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed"

    master = Document(io.BytesIO(docx_bytes_list[0]))

    for chunk_bytes in docx_bytes_list[1:]:
        chunk = Document(io.BytesIO(chunk_bytes))
        master.add_page_break()

        children = list(chunk.element.body)
        if children and children[-1].tag == qn("w:sectPr"):
            children = children[:-1]

        for elem in children:
            clone = copy.deepcopy(elem)
            # Remap embedded image relationship IDs to the master document
            for blip in clone.findall(".//" + qn("a:blip")):
                old_rid = blip.get(_R_EMBED)
                if old_rid and old_rid in chunk.part.rels:
                    image_part = chunk.part.rels[old_rid].target_part
                    new_rid = master.part.relate_to(image_part, _IMAGE_RTYPE)
                    blip.set(_R_EMBED, new_rid)
            master.element.body.append(clone)

    out = io.BytesIO()
    master.save(out)
    return out.getvalue()


def _convert_pdf_to_docx_single(pdf_bytes: bytes, body: dict) -> bytes:
    """Convert a PDF (all pages) to DOCX: pdf2docx → LibreOffice → text fallback.

    pdf2docx reconstructs document flow (real paragraphs + tables).
    LibreOffice is the fallback: it succeeds but converts every PDF drawing primitive
    into a floating text frame, making the output structurally uneditable for complex PDFs.
    """
    try:
        from pdf2docx import Converter

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
    except Exception:
        pass

    try:
        return _pdf_to_docx_libreoffice(pdf_bytes)
    except Exception:
        return _extract_text_docx(pdf_bytes)


def _process(pdf_bytes: bytes, body: dict) -> bytes:
    from pypdf import PdfReader, PdfWriter

    params = body.get("params") or {}
    page_range_str = (params.get("page_range") or "").strip()

    reader = PdfReader(io.BytesIO(pdf_bytes))
    total_pages = len(reader.pages)
    page_indices = _parse_page_range(page_range_str, total_pages)
    n_pages = len(page_indices)

    log.info(
        "pdf_to_docx conversion planned",
        extra={
            "total_pages": total_pages,
            "pages_to_convert": n_pages,
            "estimated_seconds": n_pages * _SECONDS_PER_PAGE,
            "chunked": n_pages > _CHUNK_SIZE,
        },
    )

    # If a non-trivial page range was requested, extract only those pages into a
    # fresh sequential PDF so that chunk boundaries are simple and contiguous.
    if page_range_str and n_pages < total_pages:
        writer = PdfWriter()
        for idx in page_indices:
            writer.add_page(reader.pages[idx])
        buf = io.BytesIO()
        writer.write(buf)
        pdf_bytes = buf.getvalue()

    # Small enough to convert in one shot
    if n_pages <= _CHUNK_SIZE:
        return _convert_pdf_to_docx_single(pdf_bytes, body)

    # Large document: split into sequential chunks, convert each, then merge
    docx_chunks: list[bytes] = []
    for chunk_start in range(0, n_pages, _CHUNK_SIZE):
        chunk_end = min(chunk_start + _CHUNK_SIZE, n_pages)
        chunk_reader = PdfReader(io.BytesIO(pdf_bytes))
        chunk_writer = PdfWriter()
        for i in range(chunk_start, chunk_end):
            chunk_writer.add_page(chunk_reader.pages[i])
        chunk_buf = io.BytesIO()
        chunk_writer.write(chunk_buf)
        log.info(
            "pdf_to_docx chunk",
            extra={"chunk_start": chunk_start + 1, "chunk_end": chunk_end, "total_pages": n_pages},
        )
        docx_chunks.append(_convert_pdf_to_docx_single(chunk_buf.getvalue(), body))

    return _merge_docx(docx_chunks)


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
