from __future__ import annotations

import re


_W_PRODUCER = 30
_W_XOBJECTS = 25
_W_COLUMNS = 20
_W_IMAGE_COV = 15
_W_TEXT_GAP = 10

_SECS_IMAGE_PER_PAGE = 2.5
_SECS_PDF2DOCX_PER_PAGE = 8.0

_COMPLEX_PRODUCERS = frozenset([
    "fpdf", "fpdf2", "wkhtmltopdf", "indesign", "quark", "scribus",
    "illustrator", "photoshop", "reportlab", "prince", "weasyprint",
])

_FRAGILE_LAYOUT_THRESHOLD = 60
_HIGH_FIDELITY_GOOD_THRESHOLD = 45


def _score_producer(producer: str) -> float:
    if not producer:
        return 40
    low = producer.lower()
    if any(kw in low for kw in _COMPLEX_PRODUCERS):
        return 100
    if "microsoft word" in low or "libreoffice" in low or "openoffice" in low:
        return 0
    if "acrobat" in low or "pdf-xchange" in low:
        return 20
    return 50


def _mean_xobjects_per_page(doc) -> float:
    total = 0
    for page_num in range(doc.page_count):
        try:
            page = doc.load_page(page_num)
            total += len(page.get_images(full=True))
        except Exception:
            pass
    return total / max(doc.page_count, 1)


def _score_xobjects(mean_xobj: float) -> float:
    return min(100.0, mean_xobj * 5.0)


def _column_count_hint(doc, sample_pages: int = 5) -> float:
    pages_to_check = min(sample_pages, doc.page_count)
    col_hints = []
    for page_num in range(pages_to_check):
        try:
            page = doc.load_page(page_num)
            blocks = page.get_text("dict").get("blocks", [])
            x_starts = [b["bbox"][0] for b in blocks if b.get("type") == 0]
            if not x_starts:
                continue
            page_width = page.rect.width
            left_zone = [x for x in x_starts if x < page_width * 0.4]
            right_zone = [x for x in x_starts if x > page_width * 0.5]
            col_hints.append(2.0 if left_zone and right_zone else 1.0)
        except Exception:
            col_hints.append(1.0)
    return sum(col_hints) / max(len(col_hints), 1)


def _score_columns(col_hint: float) -> float:
    return min(100.0, max(0.0, (col_hint - 1.0) * 100.0))


def _image_coverage_sample(doc, sample_pages: int = 3) -> float:
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
                for rect in page.get_image_rects(img[0]):
                    image_area += rect.width * rect.height
            ratios.append(min(1.0, image_area / page_area))
        except Exception:
            ratios.append(0.0)
    return sum(ratios) / max(len(ratios), 1)


def _score_image_coverage(ratio: float) -> float:
    return ratio * 100.0


def _text_extractable_ratio(doc) -> float:
    if doc.page_count == 0:
        return 0.0
    good = 0
    for page_num in range(doc.page_count):
        try:
            text = doc.load_page(page_num).get_text("text") or ""
            if len(text.split()) > 50:
                good += 1
        except Exception:
            pass
    return good / doc.page_count


def _score_text_gap(text_ratio: float) -> float:
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
    regular_text_viable = text_ratio >= 0.25

    if text_ratio == 0.0:
        return "image", True, False, ["scanned_best_effort"]
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


def analyze_pdf(pdf_bytes: bytes) -> dict:
    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        meta = doc.metadata or {}
        producer = meta.get("producer") or meta.get("creator") or ""
        page_count = doc.page_count
        file_size_mb = round(len(pdf_bytes) / 1024 / 1024, 2)

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
        "estimated_seconds": {
            "image": max(5, int(page_count * _SECS_IMAGE_PER_PAGE)),
            "text": max(10, int(page_count * _SECS_PDF2DOCX_PER_PAGE)),
        },
    }


def detect_watermarks(pdf_bytes: bytes, text: str = "", case: str = "insensitive") -> dict:
    import pymupdf

    needle = (text or "").strip()
    flags = 0 if case == "sensitive" else re.IGNORECASE
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        annotations = []
        text_hits = []
        for page_idx in range(doc.page_count):
            page = doc.load_page(page_idx)
            annot = page.first_annot
            while annot:
                info = annot.info or {}
                content = info.get("content") or info.get("title") or ""
                if not needle or re.search(re.escape(needle), content, flags):
                    annotations.append({"page": page_idx + 1, "type": annot.type[1], "content": content})
                annot = annot.next
            if needle:
                for rect in page.search_for(needle):
                    text_hits.append({"page": page_idx + 1, "bbox": [rect.x0, rect.y0, rect.x1, rect.y1]})
        detections = len(annotations) + len(text_hits)
        confidence = 0.0 if detections == 0 else min(1.0, 0.55 + detections / max(doc.page_count, 1) * 0.25)
        return {
            "page_count": doc.page_count,
            "detections": detections,
            "confidence": round(confidence, 3),
            "annotations": annotations,
            "text_hits": text_hits,
            "unsafe_xobjects": [],
        }
    finally:
        doc.close()


def remove_detected_watermarks(pdf_bytes: bytes, text: str = "", case: str = "insensitive") -> tuple[bytes, dict]:
    import pymupdf

    report = detect_watermarks(pdf_bytes, text=text, case=case)
    if report["detections"] <= 0:
        raise ValueError("No removable watermark was detected.")

    needle = (text or "").strip()
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        removed_annotations = 0
        redactions = 0
        for page_idx in range(doc.page_count):
            page = doc.load_page(page_idx)
            annot = page.first_annot
            while annot:
                next_annot = annot.next
                info = annot.info or {}
                content = info.get("content") or info.get("title") or ""
                matches = not needle or (content == needle if case == "sensitive" else needle.lower() in content.lower())
                if matches:
                    page.delete_annot(annot)
                    removed_annotations += 1
                annot = next_annot
            if needle:
                page_redactions = 0
                for rect in page.search_for(needle):
                    page.add_redact_annot(rect, fill=None)
                    redactions += 1
                    page_redactions += 1
                if page_redactions:
                    page.apply_redactions(images=0)
        out = doc.tobytes(garbage=4, deflate=True)
        report["removed_annotations"] = removed_annotations
        report["redactions"] = redactions
        return out, report
    finally:
        doc.close()
