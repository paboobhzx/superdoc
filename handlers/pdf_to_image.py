# handlers/pdf_to_image.py - Renders each PDF page as a PNG and packages
# the result as a ZIP file in S3.
#
# Uses PyMuPDF (fitz) rather than pdf2image+poppler because PyMuPDF ships a
# self-contained manylinux wheel - no system binaries needed. Much cleaner
# packaging story for Lambda layers.

import io
import json as _json
import zipfile

import dynamo
import s3
from logger import get_logger

log = get_logger(__name__)


_DEFAULT_DPI = 150
_MAX_PAGES = 200


def _render_pdf_to_zip(pdf_bytes: bytes, dpi: int) -> bytes:
    """Render every PDF page as PNG and zip them into a single archive.

    Page count is capped at _MAX_PAGES to protect Lambda memory. Rendering
    is sequential - concurrent rendering inside a Lambda worker is rarely
    a win because Lambda\'s CPU allocation scales with memory, not threads.
    """
    # Import inside the function so the Lambda cold-start overhead is
    # only paid when this operation is actually invoked (not during layer
    # scans for unrelated handlers).
    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_count = doc.page_count
        if page_count > _MAX_PAGES:
            raise ValueError(f"PDF has {page_count} pages; max {_MAX_PAGES}")

        zoom = dpi / 72.0
        matrix = pymupdf.Matrix(zoom, zoom)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_STORED) as zf:
            for page_num in range(page_count):
                page = doc.load_page(page_num)
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                png_bytes = pix.tobytes("png")
                arcname = f"page-{page_num + 1:04d}.png"
                zf.writestr(arcname, png_bytes)

        return buffer.getvalue()
    finally:
        doc.close()


def handler(event, context):
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    params = body.get("params") or {}

    raw_dpi = params.get("dpi")
    if raw_dpi is None:
        dpi = _DEFAULT_DPI
    else:
        dpi = int(raw_dpi)

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _render_pdf_to_zip(data, dpi=dpi)
        out_key = s3.make_output_key(job_id, file_key, "pages.zip")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_to_image done", extra={"job_id": job_id, "dpi": dpi})
    except Exception as exc:
        log.exception("pdf_to_image failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
