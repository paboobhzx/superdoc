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


@dataclass(frozen=True)
class PageClassification:
    page_index: int
    page_number: int
    page_type: PageType
    text_words: int
    text_viable: bool
    image_coverage_ratio: float
    reasons: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ClassificationSummary:
    total_pages: int
    text_pages: int
    scanned_image_pages: int
    hybrid_pages: int
    ambiguous_pages: int


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


def classify_page(page, page_index: int, cfg: ClassifierConfig | None = None) -> PageClassification:
    cfg = cfg or ClassifierConfig()
    text = page.get_text("text") or ""
    words = len(text.split())
    text_viable = words >= cfg.min_words_for_text_viable
    image_cov = _image_coverage(page, cfg)

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
    )
    return ClassificationResult(pages=pages, summary=summary)
