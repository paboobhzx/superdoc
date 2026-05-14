from __future__ import annotations

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


def _casefold(value: str) -> str:
    return value.casefold()


def _annotation_matches(annot, needle: str) -> bool:
    if not needle:
        return True
    info = annot.info or {}
    haystack = " ".join(str(info.get(key) or "") for key in ("content", "title", "subject"))
    return _casefold(needle) in _casefold(haystack)


def detect_annotation_watermarks(doc, text: str = "") -> dict:
    needle = (text or "").strip()
    annotations = []
    for page_idx in range(doc.page_count):
        page = doc.load_page(page_idx)
        annot = page.first_annot
        while annot:
            if _annotation_matches(annot, needle):
                info = annot.info or {}
                rect = annot.rect
                annotations.append({
                    "page": page_idx + 1,
                    "xref": annot.xref,
                    "type": annot.type[1],
                    "content": info.get("content") or "",
                    "title": info.get("title") or "",
                    "bbox": [round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)],
                })
            annot = annot.next
    confidence = 0.0 if not annotations else min(1.0, 0.65 + len(annotations) / max(doc.page_count, 1) * 0.25)
    return {
        "detections": len(annotations),
        "confidence": round(confidence, 3),
        "annotations": annotations,
    }


def _image_candidates_for_page(page, page_idx: int) -> list[dict]:
    candidates = []
    page_area = max(page.rect.width * page.rect.height, 1.0)
    for image in page.get_images(full=True):
        xref = image[0]
        try:
            rects = page.get_image_rects(xref)
        except Exception:
            rects = []
        for rect in rects:
            if rect.is_empty or rect.is_infinite:
                continue
            area_ratio = max(0.0, min(1.0, (rect.width * rect.height) / page_area))
            center_x = rect.x0 + rect.width / 2
            center_y = rect.y0 + rect.height / 2
            centered = (
                abs(center_x - page.rect.width / 2) <= page.rect.width * 0.25
                and abs(center_y - page.rect.height / 2) <= page.rect.height * 0.25
            )
            watermark_like = centered and 0.03 <= area_ratio <= 0.85
            candidates.append({
                "page": page_idx + 1,
                "xref": xref,
                "bbox": [round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)],
                "area_ratio": round(area_ratio, 3),
                "watermark_like": watermark_like,
            })
    return candidates


def detect_xobject_watermarks(doc) -> dict:
    by_xref: dict[int, list[dict]] = {}
    for page_idx in range(doc.page_count):
        page = doc.load_page(page_idx)
        for candidate in _image_candidates_for_page(page, page_idx):
            by_xref.setdefault(candidate["xref"], []).append(candidate)

    candidates = []
    unsafe = []
    for xref, uses in by_xref.items():
        watermark_uses = [use for use in uses if use["watermark_like"]]
        page_coverage = len({use["page"] for use in watermark_uses}) / max(doc.page_count, 1)
        if watermark_uses and len(watermark_uses) == len(uses) and page_coverage >= 0.5:
            candidates.append({
                "xref": xref,
                "uses": watermark_uses,
                "page_coverage": round(page_coverage, 3),
                "safe_to_remove": True,
            })
        elif watermark_uses:
            unsafe.append({
                "xref": xref,
                "uses": uses,
                "reason": "xobject_not_isolated",
            })

    detections = sum(len(item["uses"]) for item in candidates)
    confidence = 0.0 if detections == 0 else min(1.0, 0.55 + detections / max(doc.page_count, 1) * 0.3)
    return {
        "detections": detections,
        "confidence": round(confidence, 3),
        "xobjects": candidates,
        "unsafe_xobjects": unsafe,
    }


def detect_watermarks(pdf_bytes: bytes, text: str = "", mode: str = "auto") -> dict:
    import pymupdf

    mode = (mode or "auto").lower()
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        annotation_report = detect_annotation_watermarks(doc, text=text) if mode in ("auto", "annot") else {
            "detections": 0,
            "confidence": 0.0,
            "annotations": [],
        }
        xobject_report = detect_xobject_watermarks(doc) if mode in ("auto", "xobject") else {
            "detections": 0,
            "confidence": 0.0,
            "xobjects": [],
            "unsafe_xobjects": [],
        }
        detections = annotation_report["detections"] + xobject_report["detections"]
        confidence = max(float(annotation_report["confidence"]), float(xobject_report["confidence"]))
        return {
            "page_count": doc.page_count,
            "mode": mode,
            "detections": detections,
            "confidence": round(confidence, 3),
            "annotations": annotation_report["annotations"],
            "xobjects": xobject_report["xobjects"],
            "unsafe_xobjects": xobject_report["unsafe_xobjects"],
        }
    finally:
        doc.close()


def _delete_matching_annotations(doc, text: str = "") -> int:
    needle = (text or "").strip()
    removed = 0
    for page_idx in range(doc.page_count):
        page = doc.load_page(page_idx)
        annot = page.first_annot
        while annot:
            next_annot = annot.next
            if _annotation_matches(annot, needle):
                page.delete_annot(annot)
                removed += 1
            annot = next_annot
    return removed


def _delete_safe_xobjects(doc, xobjects: list[dict]) -> int:
    removed = 0
    for item in xobjects:
        if not item.get("safe_to_remove"):
            continue
        xref = int(item["xref"])
        for page_idx in range(doc.page_count):
            page = doc.load_page(page_idx)
            if not any(image[0] == xref for image in page.get_images(full=True)):
                continue
            if hasattr(page, "delete_image"):
                page.delete_image(xref)
                removed += 1
            else:
                raise RuntimeError("unsafe_xobject_removal")
    return removed


def remove_detected_watermarks(pdf_bytes: bytes, text: str = "", mode: str = "auto") -> tuple[bytes, dict]:
    import pymupdf

    report = detect_watermarks(pdf_bytes, text=text, mode=mode)
    if report["detections"] <= 0:
        raise ValueError("no_watermark_detected")

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        removed_annotations = _delete_matching_annotations(doc, text=text) if mode in ("auto", "annot") else 0
        removed_xobjects = _delete_safe_xobjects(doc, report.get("xobjects") or []) if mode in ("auto", "xobject") else 0
        if report.get("unsafe_xobjects") and removed_xobjects == 0 and mode in ("auto", "xobject"):
            raise ValueError("unsafe_xobject_removal")
        if removed_annotations + removed_xobjects == 0:
            raise ValueError("no_watermark_detected")
        out = doc.tobytes(garbage=4, deflate=True)
        report["removed_annotations"] = removed_annotations
        report["removed_xobjects"] = removed_xobjects
        return out, report
    finally:
        doc.close()
