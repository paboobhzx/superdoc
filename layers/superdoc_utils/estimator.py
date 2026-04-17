_SECONDS_PER_MB: dict[str, float] = {
    "pdf_merge": 2.0,
    "pdf_split": 1.5,
    "pdf_compress": 3.0,
    "pdf_rotate": 1.0,
    "pdf_annotate": 2.0,
    "pdf_extract_text": 1.5,
    "pdf_to_docx": 5.0,
    "doc_edit": 2.0,
    "image_convert": 1.0,
    "video_process": 30.0,
}

_MINIMUM_SECONDS: dict[str, int] = {
    "pdf_merge": 3,
    "pdf_split": 2,
    "pdf_compress": 5,
    "pdf_rotate": 2,
    "pdf_annotate": 3,
    "pdf_extract_text": 2,
    "pdf_to_docx": 5,
    "doc_edit": 3,
    "image_convert": 2,
    "video_process": 30,
}


def estimate_seconds(operation: str, file_size_bytes: int) -> int:
    mb = max(int(file_size_bytes) / (1024 * 1024), 0.1)
    rate = _SECONDS_PER_MB.get(operation, 3.0)
    minimum = _MINIMUM_SECONDS.get(operation, 5)
    return max(minimum, int(mb * rate))
