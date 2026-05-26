from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class PageType(str, Enum):
    TEXT = "TEXT"
    SCANNED_IMAGE = "SCANNED_IMAGE"
    HYBRID = "HYBRID"
    AMBIGUOUS = "AMBIGUOUS"


@dataclass(frozen=True)
class ClassifierConfig:
    min_words_for_text_viable: int = 30
    image_dominant_threshold: float = 0.6
    hybrid_image_threshold: float = 0.15
    hybrid_min_words: int = 8
    max_image_rects_per_page: int = 120
    table_dark_ratio_threshold: float = 0.65
    table_min_line_bands: int = 3
    table_confidence_threshold: float = 0.55


@dataclass(frozen=True)
class PageClassification:
    page_index: int
    page_number: int
    page_type: PageType
    text_words: int
    text_viable: bool
    image_coverage_ratio: float
    likely_table_image: bool
    table_confidence: float
    reasons: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ClassificationSummary:
    total_pages: int
    text_pages: int
    scanned_image_pages: int
    hybrid_pages: int
    ambiguous_pages: int
    table_like_pages: int
    has_table_like_scanned_content: bool


@dataclass(frozen=True)
class ClassificationResult:
    pages: list[PageClassification]
    summary: ClassificationSummary


def _image_coverage(page, cfg: ClassifierConfig) -> float:
    page_area = max(page.rect.width * page.rect.height, 0.0)
    if page_area <= 0:
        return 0.0

    image_area = 0.0
    rect_count = 0
    for img in page.get_images(full=True):
        if rect_count >= cfg.max_image_rects_per_page:
            break
        try:
            rects = page.get_image_rects(img[0])
        except Exception:
            continue
        for rect in rects:
            image_area += max(rect.width * rect.height, 0.0)
            rect_count += 1
            if rect_count >= cfg.max_image_rects_per_page:
                break
    return min(1.0, image_area / page_area)


def _count_line_bands(values: list[float], threshold: float) -> int:
    bands = 0
    in_band = False
    for value in values:
        if value >= threshold:
            if not in_band:
                bands += 1
            in_band = True
        else:
            in_band = False
    return bands


def _table_like_confidence(page, cfg: ClassifierConfig) -> float:
    # Lightweight grid-line heuristic for scanned/table-like pages.
    try:
        pix = page.get_pixmap(dpi=72, alpha=False)
        width, height = pix.width, pix.height
        if width <= 0 or height <= 0:
            return 0.0
        data = pix.samples
        stride = pix.n
        row_ratios: list[float] = []
        col_dark_counts = [0] * width
        threshold = 140
        for y in range(height):
            row_dark = 0
            row_offset = y * width * stride
            for x in range(width):
                offset = row_offset + (x * stride)
                r = data[offset]
                g = data[offset + 1]
                b = data[offset + 2]
                gray = (r + g + b) // 3
                if gray < threshold:
                    row_dark += 1
                    col_dark_counts[x] += 1
            row_ratios.append(row_dark / width)
        col_ratios = [count / height for count in col_dark_counts]

        horizontal_bands = _count_line_bands(row_ratios, cfg.table_dark_ratio_threshold)
        vertical_bands = _count_line_bands(col_ratios, cfg.table_dark_ratio_threshold)

        score_h = min(1.0, horizontal_bands / 8.0)
        score_v = min(1.0, vertical_bands / 8.0)
        grid_balance = min(score_h, score_v)
        return min(1.0, 0.35 * score_h + 0.35 * score_v + 0.30 * grid_balance)
    except Exception:
        return 0.0


def classify_page(page, page_index: int, cfg: ClassifierConfig | None = None) -> PageClassification:
    cfg = cfg or ClassifierConfig()
    text = page.get_text("text") or ""
    words = len(text.split())
    text_viable = words >= cfg.min_words_for_text_viable
    image_cov = _image_coverage(page, cfg)
    table_confidence = round(_table_like_confidence(page, cfg), 3)
    likely_table_image = table_confidence >= cfg.table_confidence_threshold

    reasons: list[str] = []

    # Priority: scanned -> text -> hybrid -> ambiguous
    if not text_viable:
        reasons.append("regular_text_not_viable")
        if image_cov >= cfg.hybrid_image_threshold:
            reasons.append("image_present")
        return PageClassification(
            page_index=page_index,
            page_number=page_index + 1,
            page_type=PageType.SCANNED_IMAGE,
            text_words=words,
            text_viable=False,
            image_coverage_ratio=round(image_cov, 3),
            likely_table_image=likely_table_image,
            table_confidence=table_confidence,
            reasons=reasons,
        )

    if image_cov < cfg.hybrid_image_threshold:
        reasons.append("extractable_text_viable")
        return PageClassification(
            page_index=page_index,
            page_number=page_index + 1,
            page_type=PageType.TEXT,
            text_words=words,
            text_viable=True,
            image_coverage_ratio=round(image_cov, 3),
            likely_table_image=likely_table_image,
            table_confidence=table_confidence,
            reasons=reasons,
        )

    if image_cov >= cfg.image_dominant_threshold or words >= cfg.hybrid_min_words:
        reasons.append("text_and_images")
        return PageClassification(
            page_index=page_index,
            page_number=page_index + 1,
            page_type=PageType.HYBRID,
            text_words=words,
            text_viable=True,
            image_coverage_ratio=round(image_cov, 3),
            likely_table_image=likely_table_image,
            table_confidence=table_confidence,
            reasons=reasons,
        )

    reasons.append("unclear_content_mix")
    return PageClassification(
        page_index=page_index,
        page_number=page_index + 1,
        page_type=PageType.AMBIGUOUS,
        text_words=words,
        text_viable=True,
        image_coverage_ratio=round(image_cov, 3),
        likely_table_image=likely_table_image,
        table_confidence=table_confidence,
        reasons=reasons,
    )


def classify_pdf(pdf_bytes: bytes, cfg: ClassifierConfig | None = None) -> ClassificationResult:
    import pymupdf

    cfg = cfg or ClassifierConfig()
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        pages: list[PageClassification] = []
        for i in range(doc.page_count):
            pages.append(classify_page(doc.load_page(i), i, cfg))
    finally:
        doc.close()

    summary = ClassificationSummary(
        total_pages=len(pages),
        text_pages=sum(1 for p in pages if p.page_type == PageType.TEXT),
        scanned_image_pages=sum(1 for p in pages if p.page_type == PageType.SCANNED_IMAGE),
        hybrid_pages=sum(1 for p in pages if p.page_type == PageType.HYBRID),
        ambiguous_pages=sum(1 for p in pages if p.page_type == PageType.AMBIGUOUS),
        table_like_pages=sum(1 for p in pages if p.likely_table_image),
        has_table_like_scanned_content=any(
            p.likely_table_image and p.page_type in (PageType.SCANNED_IMAGE, PageType.HYBRID)
            for p in pages
        ),
    )
    return ClassificationResult(pages=pages, summary=summary)
