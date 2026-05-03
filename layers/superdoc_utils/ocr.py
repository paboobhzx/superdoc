from __future__ import annotations

import os
import shutil
import subprocess
import tempfile


def extract_lines(image_bytes: bytes) -> list[str]:
    """Extract OCR text lines, preferring local Tesseract over Textract."""
    text = _extract_with_tesseract(image_bytes)
    if text is None:
        text = _extract_with_textract(image_bytes)
    return [line.rstrip() for line in text.splitlines() if line.strip()]


def _extract_with_tesseract(image_bytes: bytes) -> str | None:
    tesseract = shutil.which(os.environ.get("TESSERACT_BIN", "tesseract"))
    if not tesseract:
        return None

    with tempfile.NamedTemporaryFile(suffix=".png") as fh:
        fh.write(image_bytes)
        fh.flush()
        completed = subprocess.run(
            [tesseract, fh.name, "stdout", "-l", os.environ.get("TESSERACT_LANG", "eng")],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=int(os.environ.get("OCR_TESSERACT_TIMEOUT_SECONDS", "60")),
        )
    if completed.returncode != 0:
        return None
    return completed.stdout.decode("utf-8", errors="replace")


def _extract_with_textract(image_bytes: bytes) -> str:
    import boto3

    client = boto3.client("textract")
    response = client.detect_document_text(Document={"Bytes": image_bytes})
    lines: list[tuple[float, float, str]] = []
    for block in response.get("Blocks", []):
        if block.get("BlockType") != "LINE":
            continue
        text = block.get("Text") or ""
        box = ((block.get("Geometry") or {}).get("BoundingBox") or {})
        lines.append((float(box.get("Top", 0)), float(box.get("Left", 0)), text))
    lines.sort(key=lambda item: (item[0], item[1]))
    return "\n".join(text for _top, _left, text in lines)
