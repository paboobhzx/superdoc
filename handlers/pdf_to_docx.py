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
_QA_THRESHOLD = float(os.environ.get("PDF_TO_DOCX_QA_THRESHOLD", "0.7"))


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
    """Parse '1-5,8,10-12' into a sorted 0-indexed list, clamped to [0, total)."""
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


def _render_page_as_image_docx(page_bytes: bytes) -> bytes:
    """Render a single-page PDF as a full-page image in a DOCX."""
    import pymupdf
    from docx import Document
    from docx.shared import Inches

    usable_w = Inches(7.27)
    usable_h = Inches(10.69)
    zoom = 150 / 72.0
    matrix = pymupdf.Matrix(zoom, zoom)

    doc = pymupdf.open(stream=page_bytes, filetype="pdf")
    try:
        docx_doc = Document()
        section = docx_doc.sections[0]
        section.page_width = Inches(8.27)
        section.page_height = Inches(11.69)
        section.top_margin = Inches(0.5)
        section.bottom_margin = Inches(0.5)
        section.left_margin = Inches(0.5)
        section.right_margin = Inches(0.5)

        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        pix_w, pix_h = pix.width, pix.height
        png_bytes = pix.tobytes("png")
        pix = None

        img_stream = io.BytesIO(png_bytes)
        png_bytes = None

        if pix_h > 0:
            aspect = pix_w / pix_h
            height_if_fit_w = usable_w / aspect
            if height_if_fit_w > usable_h:
                docx_doc.add_picture(img_stream, height=usable_h)
            else:
                docx_doc.add_picture(img_stream, width=usable_w)
        else:
            docx_doc.add_picture(img_stream, width=usable_w)

        out = io.BytesIO()
        docx_doc.save(out)
        return out.getvalue()
    finally:
        doc.close()


def _extract_page_text_docx(page_bytes: bytes) -> bytes:
    """Extract text from a single-page PDF into a plain DOCX."""
    import pymupdf
    from docx import Document

    doc = pymupdf.open(stream=page_bytes, filetype="pdf")
    try:
        docx_doc = Document()
        page = doc.load_page(0)
        text = page.get_text("text") or ""
        if text.strip():
            for para in text.split("\n"):
                if para.strip():
                    docx_doc.add_paragraph(para.strip())
        out = io.BytesIO()
        docx_doc.save(out)
        return out.getvalue()
    finally:
        doc.close()


def _count_words_in_text(text: str) -> int:
    return len(text.split())


def _count_words_docx(docx_bytes: bytes) -> int:
    from docx import Document

    doc = Document(io.BytesIO(docx_bytes))
    total = 0
    for para in doc.paragraphs:
        total += _count_words_in_text(para.text)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                total += _count_words_in_text(cell.text)
    return total


def _pdf2docx_single_page(page_bytes: bytes) -> bytes:
    """Try converting a single-page PDF with pdf2docx. Returns DOCX bytes or raises."""
    from pdf2docx import Converter

    with tempfile.TemporaryDirectory(prefix="pdf2docx-") as workdir:
        src = os.path.join(workdir, "input.pdf")
        dst = os.path.join(workdir, "output.docx")
        with open(src, "wb") as fh:
            fh.write(page_bytes)
        cv = Converter(src)
        try:
            cv.convert(dst)
        finally:
            cv.close()
        with open(dst, "rb") as fh:
            return fh.read()


def _process_page(
    page_bytes: bytes,
    page_num: int,
    page_words_pdf: int,
    high_fidelity: bool,
    fallback_strategy: str,
    job_id: str,
) -> tuple[bytes, str]:
    """Process a single page and return (docx_bytes, mode_used).

    Modes:
      - 'image'   — PyMuPDF page-as-image (always layout-faithful, never editable)
      - 'pdf2docx' — pdf2docx reconstruction (editable when it works)
      - 'text'    — plain-text extraction fallback (always editable, no layout)
    """
    # high_fidelity=True: always render as image, skip reconstruction entirely
    if high_fidelity:
        return _render_page_as_image_docx(page_bytes), "image"

    # Attempt pdf2docx reconstruction
    docx_bytes = None
    try:
        docx_bytes = _pdf2docx_single_page(page_bytes)
    except Exception as exc:
        log.warning(
            "pdf2docx failed on page %d: %s, applying fallback=%s",
            page_num + 1, exc, fallback_strategy,
            extra={"job_id": job_id},
        )

    # QA gate: if pdf2docx succeeded, check word retention
    if docx_bytes is not None and page_words_pdf > 0:
        docx_words = _count_words_docx(docx_bytes)
        ratio = docx_words / page_words_pdf
        if ratio < _QA_THRESHOLD:
            log.warning(
                "qa_gate page %d: ratio %.3f < %.2f, applying fallback=%s",
                page_num + 1, ratio, _QA_THRESHOLD, fallback_strategy,
                extra={"job_id": job_id},
            )
            docx_bytes = None  # trigger fallback below

    if docx_bytes is not None:
        return docx_bytes, "pdf2docx"

    # Apply fallback strategy
    if fallback_strategy == "image":
        return _render_page_as_image_docx(page_bytes), "image"

    # fallback_strategy == "text" (default)
    return _extract_page_text_docx(page_bytes), "text"


def _process(pdf_bytes: bytes, body: dict) -> bytes:
    import pymupdf
    from pypdf import PdfReader, PdfWriter

    params = body.get("params") or {}
    page_range_str = (params.get("page_range") or "").strip()
    high_fidelity = bool(params.get("high_fidelity", True))
    fallback_strategy = (params.get("fallback_strategy") or "text").lower()
    job_id = body.get("job_id", "unknown")

    # Determine pages to convert
    reader = PdfReader(io.BytesIO(pdf_bytes))
    total_pages = len(reader.pages)
    page_indices = _parse_page_range(page_range_str, total_pages)
    n_pages = len(page_indices)

    log.info(
        "pdf_to_docx per-page conversion planned",
        extra={
            "job_id": job_id,
            "total_pages": total_pages,
            "pages_to_convert": n_pages,
            "high_fidelity": high_fidelity,
            "fallback_strategy": fallback_strategy,
        },
    )

    # Pre-extract word counts via PyMuPDF for QA gate (cheap, < 1s for 300 pages)
    page_word_counts: list[int] = []
    if not high_fidelity:
        fitz_doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        try:
            for idx in page_indices:
                page = fitz_doc.load_page(idx)
                text = page.get_text("text") or ""
                page_word_counts.append(_count_words_in_text(text))
        finally:
            fitz_doc.close()
    else:
        page_word_counts = [0] * n_pages

    # Process each page individually
    docx_pages: list[bytes] = []
    for i, page_idx in enumerate(page_indices):
        # Extract the single page as a fresh PDF
        page_writer = PdfWriter()
        page_writer.add_page(reader.pages[page_idx])
        page_buf = io.BytesIO()
        page_writer.write(page_buf)
        page_bytes_single = page_buf.getvalue()

        page_docx, mode_used = _process_page(
            page_bytes=page_bytes_single,
            page_num=page_idx,
            page_words_pdf=page_word_counts[i],
            high_fidelity=high_fidelity,
            fallback_strategy=fallback_strategy,
            job_id=job_id,
        )
        docx_pages.append(page_docx)

        # Record per-page mode to DynamoDB (best-effort, never crash the conversion)
        try:
            dynamo.record_page_result(job_id, page=page_idx + 1, mode_used=mode_used)
        except Exception:
            pass

        log.info(
            "pdf_to_docx page %d/%d mode=%s",
            i + 1, n_pages, mode_used,
            extra={"job_id": job_id},
        )

    return _merge_docx(docx_pages)


def _output_filename(body: dict, file_key: str) -> str:
    original = body.get("file_name") or os.path.basename(file_key) or "document.pdf"
    stem, _ext = os.path.splitext(os.path.basename(original))
    return f"{stem or 'document'}.docx"


def handler(event, context):
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
