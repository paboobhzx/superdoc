"""Synchronous PDF complexity analysis endpoint.

POST /jobs/{jobId}/analyze

Reads the uploaded PDF from S3 (using the job's file_key) and returns a
complexity score with a recommended conversion mode and estimated time.

Target latency: < 3s. Uses PyMuPDF for all analysis — no pdf2docx, no rendering.
"""
import json
import os

import dynamo
import response
import s3
from logger import get_logger

log = get_logger(__name__)

# Weights for the complexity score blend (must sum to 100)
_W_PRODUCER = 30        # producer type (FPDF/wkhtmltopdf = complex)
_W_XOBJECTS = 25        # mean XObjects per page
_W_COLUMNS = 20         # multi-column layout hint
_W_IMAGE_COV = 15       # image coverage on sample pages
_W_TEXT_GAP = 10        # gaps in extractable text (low ratio = bad for pdf2docx)

# Seconds per page estimates
_SECS_IMAGE_PER_PAGE = 2.5    # Mode 1: PyMuPDF render
_SECS_PDF2DOCX_PER_PAGE = 8.0  # Mode 0: pdf2docx

# Producers that indicate pre-rendered / non-tagged PDFs
_COMPLEX_PRODUCERS = frozenset([
    "fpdf", "fpdf2", "wkhtmltopdf", "indesign", "quark", "scribus",
    "illustrator", "photoshop", "reportlab", "prince", "weasyprint",
])

_FRAGILE_LAYOUT_THRESHOLD = 60  # score >= this and text exists → prefer regular text
_HIGH_FIDELITY_GOOD_THRESHOLD = 45


def _score_producer(producer: str) -> float:
    """Return 0-100 based on producer heuristic. Higher = more complex."""
    if not producer:
        return 40  # unknown → moderate
    low = producer.lower()
    if any(kw in low for kw in _COMPLEX_PRODUCERS):
        return 100
    if "microsoft word" in low or "libreoffice" in low or "openoffice" in low:
        return 0   # native Word/LO PDFs reconstruct well with pdf2docx
    if "acrobat" in low or "pdf-xchange" in low:
        return 20
    return 50  # generic unknown producer


def _mean_xobjects_per_page(doc) -> float:
    """Average number of images referenced per page."""

    total = 0
    for page_num in range(doc.page_count):
        try:
            page = doc.load_page(page_num)
            total += len(page.get_images(full=True))
        except Exception:
            pass
    return total / max(doc.page_count, 1)


def _score_xobjects(mean_xobj: float) -> float:
    """0-100: 0 means no XObjects, 100 means >=20 XObjects/page."""
    return min(100.0, mean_xobj * 5.0)


def _column_count_hint(doc, sample_pages: int = 5) -> float:
    """Estimate number of text columns based on block x-positions.

    Returns a float: 1.0 = single column, 2.0 = two columns, etc.
    """
    pages_to_check = min(sample_pages, doc.page_count)
    col_hints = []
    for page_num in range(pages_to_check):
        try:
            page = doc.load_page(page_num)
            blocks = page.get_text("dict").get("blocks", [])
            x_starts = []
            for b in blocks:
                if b.get("type") == 0:  # text block
                    x_starts.append(b["bbox"][0])
            if not x_starts:
                continue
            page_width = page.rect.width
            # Simple heuristic: if blocks start in two distinct x-zones, it's 2-column
            left_zone = [x for x in x_starts if x < page_width * 0.4]
            right_zone = [x for x in x_starts if x > page_width * 0.5]
            if left_zone and right_zone:
                col_hints.append(2.0)
            else:
                col_hints.append(1.0)
        except Exception:
            col_hints.append(1.0)
    return sum(col_hints) / max(len(col_hints), 1)


def _score_columns(col_hint: float) -> float:
    """0-100: single column = 0, two columns = 100."""
    return min(100.0, max(0.0, (col_hint - 1.0) * 100.0))


def _image_coverage_sample(doc, sample_pages: int = 3) -> float:
    """Mean image bbox coverage ratio across sample pages."""
    pages_to_check = min(sample_pages, doc.page_count)
    ratios = []
    for page_num in range(pages_to_check):
        try:
            page = doc.load_page(page_num)
            page_area = page.rect.width * page.rect.height
            if page_area <= 0:
                continue
            image_area = 0.0
            for img in page.get_images(full=True):
                rects = page.get_image_rects(img[0])
                for rect in rects:
                    image_area += rect.width * rect.height
            ratios.append(min(1.0, image_area / page_area))
        except Exception:
            ratios.append(0.0)
    return sum(ratios) / max(len(ratios), 1)


def _score_image_coverage(ratio: float) -> float:
    """0-100: no image coverage = 0, fully covered = 100."""
    return ratio * 100.0


def _text_extractable_ratio(doc) -> float:
    """Fraction of pages with > 50 extractable words."""
    if doc.page_count == 0:
        return 0.0
    good = 0
    for page_num in range(doc.page_count):
        try:
            page = doc.load_page(page_num)
            text = page.get_text("text") or ""
            if len(text.split()) > 50:
                good += 1
        except Exception:
            pass
    return good / doc.page_count


def _score_text_gap(text_ratio: float) -> float:
    """0-100: all pages have text = 0, no pages have text = 100.

    Low text extractability → pdf2docx will produce near-empty output → more complex.
    """
    return (1.0 - text_ratio) * 100.0


def _build_rationale_keys(
    producer_score: float,
    xobj_score: float,
    col_score: float,
    img_score: float,
    text_gap_score: float,
    text_ratio: float,
) -> list[str]:
    keys = []
    if text_ratio == 0.0:
        keys.append("no_extractable_text")
    if producer_score >= 80:
        keys.append("fpdf_producer")
    if xobj_score >= 60:
        keys.append("high_xobjects_per_page")
    if col_score >= 50:
        keys.append("multi_column_layout")
    if img_score >= 60:
        keys.append("high_image_coverage")
    if not keys:
        keys.append("simple_layout")
    return keys


def _derive_recommendation(
    complexity_score: int,
    xobj_score: float,
    col_score: float,
    img_score: float,
    text_ratio: float,
) -> tuple[str, bool, bool, list[str]]:
    """Return (recommendation, high_fidelity_viable, regular_text_viable, extra_keys).

    "image" maps to the frontend high-fidelity checkbox for backwards
    compatibility. It now means the hybrid high-fidelity path is expected to
    produce the most useful result, not that every PDF page is blindly rendered
    as an image.
    """
    regular_text_viable = text_ratio >= 0.25

    if text_ratio == 0.0:
        return "image", True, False, ["scanned_best_effort"]

    # Mostly image-based PDFs can usually be preserved visually by embedding
    # page images where reconstruction is weak. That is a legitimate
    # high-fidelity result, even though editable text will be limited.
    if img_score >= 75 and text_ratio < 0.5:
        return "image", True, regular_text_viable, ["image_dominant_pdf"]

    fragile_layout = (
        complexity_score >= _FRAGILE_LAYOUT_THRESHOLD
        or xobj_score >= 60
        or col_score >= 50
    )
    if fragile_layout and regular_text_viable:
        return "text", False, True, ["high_fidelity_risk"]

    high_fidelity_viable = complexity_score <= _HIGH_FIDELITY_GOOD_THRESHOLD and text_ratio >= 0.6
    if high_fidelity_viable:
        return "image", True, True, ["high_fidelity_viable"]

    return "text", False, regular_text_viable, ["regular_text_safer"]


def _analyze_pdf(pdf_bytes: bytes) -> dict:
    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        # Metadata
        meta = doc.metadata or {}
        producer = meta.get("producer") or meta.get("creator") or ""
        page_count = doc.page_count
        file_size_mb = round(len(pdf_bytes) / 1024 / 1024, 2)

        # Signals
        producer_score = _score_producer(producer)
        mean_xobj = _mean_xobjects_per_page(doc)
        xobj_score = _score_xobjects(mean_xobj)
        col_hint = _column_count_hint(doc)
        col_score = _score_columns(col_hint)
        img_ratio = _image_coverage_sample(doc)
        img_score = _score_image_coverage(img_ratio)
        text_ratio = _text_extractable_ratio(doc)
        text_gap_score = _score_text_gap(text_ratio)
    finally:
        doc.close()

    # Weighted complexity score (0-100)
    complexity_score = int(
        producer_score * _W_PRODUCER / 100
        + xobj_score * _W_XOBJECTS / 100
        + col_score * _W_COLUMNS / 100
        + img_score * _W_IMAGE_COV / 100
        + text_gap_score * _W_TEXT_GAP / 100
    )
    complexity_score = max(0, min(100, complexity_score))

    recommendation, high_fidelity_viable, regular_text_viable, decision_keys = _derive_recommendation(
        complexity_score, xobj_score, col_score, img_score, text_ratio
    )

    rationale_keys = decision_keys + _build_rationale_keys(
        producer_score, xobj_score, col_score, img_score, text_gap_score, text_ratio
    )

    estimated_seconds = {
        "image": max(5, int(page_count * _SECS_IMAGE_PER_PAGE)),
        "text": max(10, int(page_count * _SECS_PDF2DOCX_PER_PAGE)),
    }

    return {
        "complexity_score": complexity_score,
        "recommendation": recommendation,
        "high_fidelity_viable": high_fidelity_viable,
        "regular_text_viable": regular_text_viable,
        "rationale_keys": rationale_keys,
        "page_count": page_count,
        "file_size_mb": file_size_mb,
        "signals": {
            "producer": producer,
            "mean_xobjects_per_page": round(mean_xobj, 2),
            "text_extractable_ratio": round(text_ratio, 3),
            "image_coverage_ratio": round(img_ratio, 3),
            "column_count_hint": round(col_hint, 2),
        },
        "estimated_seconds": estimated_seconds,
    }


def handler(event, context):
    try:
        if event.get("httpMethod") == "OPTIONS":
            return response.preflight()

        job_id = (event.get("pathParameters") or {}).get("jobId") or ""
        if not job_id:
            return response.error("jobId is required", 400)

        # Support anonymous sessions
        qs = event.get("queryStringParameters") or {}
        session_id = qs.get("session_id") or ""

        job = dynamo.get_job(job_id)
        if not job:
            return response.error("Job not found", 404)

        # Authorization: registered jobs require the matching auth cookie;
        # anonymous jobs require the matching anonymous session id.
        job_user_id = job.get("user_id") or ""
        if job_user_id:
            import auth_session
            user = auth_session.current_user(event)
            if (user.get("user_id") or "") != job_user_id:
                return response.error("Forbidden", 403)
        elif not session_id or job.get("session_id") != session_id:
            return response.error("Forbidden", 403)

        file_key = job.get("file_key") or ""
        if not file_key:
            return response.error("Job has no associated file", 422)

        pdf_bytes = s3.get_bytes(file_key)
        result = _analyze_pdf(pdf_bytes)

        log.info(
            "pdf_analyze done",
            extra={
                "job_id": job_id,
                "complexity_score": result["complexity_score"],
                "recommendation": result["recommendation"],
                "page_count": result["page_count"],
            },
        )
        return response.ok(result)

    except Exception as exc:
        log.exception("pdf_analyze error: %s", exc)
        return response.error("Analysis failed", 500)
