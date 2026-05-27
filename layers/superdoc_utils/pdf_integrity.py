from __future__ import annotations

import io
import zipfile


def _scan_pdf_bytes(pdf_bytes: bytes) -> dict:
    import pymupdf

    warnings: list[str] = []
    problem_pages: list[int] = []

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        return {
            "score": 0,
            "page_count": 0,
            "problem_pages": [],
            "warnings": [f"Could not open PDF: {exc}"],
            "repairable": False,
        }

    try:
        page_count = int(doc.page_count or 0)
        for idx in range(page_count):
            page_num = idx + 1
            try:
                page = doc.load_page(idx)
                _ = page.get_text("text")
                _ = page.get_pixmap(matrix=pymupdf.Matrix(0.2, 0.2), alpha=False)
            except Exception as exc:
                problem_pages.append(page_num)
                warnings.append(f"Page {page_num} failed rendering or text extraction: {exc}")

        repairable = False
        try:
            _ = doc.tobytes(garbage=4, deflate=True)
            repairable = True
        except Exception:
            repairable = False
    finally:
        doc.close()

    score = 100 if page_count == 0 else max(0, int(round((1 - len(problem_pages) / page_count) * 100)))
    return {
        "score": score,
        "page_count": page_count,
        "problem_pages": problem_pages,
        "warnings": warnings,
        "repairable": repairable,
    }


def analyze_pdf_integrity(
    file_bytes: bytes,
    operation: str | None = None,
) -> dict:
    op = (operation or "").strip().lower()
    warnings: list[str] = []

    if op in {"pdf_merge", "pdf_svg_annotate"}:
        try:
            zf = zipfile.ZipFile(io.BytesIO(file_bytes))
        except Exception as exc:
            return {
                "score": 0,
                "page_count": 0,
                "problem_pages": [],
                "warnings": [f"Could not open ZIP: {exc}"],
                "repairable": False,
            }
        with zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".pdf")]
            if op == "pdf_svg_annotate":
                names = [n for n in names if n.lower().endswith("document.pdf")]
            if not names:
                return {
                    "score": 100,
                    "page_count": 0,
                    "problem_pages": [],
                    "warnings": ["No PDF files found in ZIP for integrity checks."],
                    "repairable": False,
                }

            scans = []
            for name in names:
                scanned = _scan_pdf_bytes(zf.read(name))
                scans.append(scanned)
                warnings.extend([f"{name}: {w}" for w in scanned.get("warnings", [])])
            page_count = sum(int(item.get("page_count") or 0) for item in scans)
            total_problem = sum(len(item.get("problem_pages") or []) for item in scans)
            score = 100 if page_count == 0 else max(0, int(round((1 - total_problem / page_count) * 100)))
            return {
                "score": score,
                "page_count": page_count,
                "problem_pages": [],
                "warnings": warnings,
                "repairable": any(bool(item.get("repairable")) for item in scans),
            }

    return _scan_pdf_bytes(file_bytes)


def detect_encryption(pdf_bytes: bytes) -> dict:
    """Check whether a PDF is encrypted / password-protected."""
    import pymupdf

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return {"is_encrypted": False, "needs_password": False, "permissions": {}}

    try:
        is_encrypted = bool(doc.is_encrypted)
        needs_password = bool(doc.needs_pass)

        # Permission flags (only meaningful when encrypted)
        perms = {}
        if is_encrypted:
            perms = {
                "print": bool(doc.permissions & pymupdf.PDF_PERM_PRINT),
                "copy": bool(doc.permissions & pymupdf.PDF_PERM_COPY),
                "modify": bool(doc.permissions & pymupdf.PDF_PERM_MODIFY),
                "annotate": bool(doc.permissions & pymupdf.PDF_PERM_ANNOTATE),
            }

        return {
            "is_encrypted": is_encrypted,
            "needs_password": needs_password,
            "permissions": perms,
        }
    finally:
        doc.close()


def detect_signatures(pdf_bytes: bytes) -> dict:
    """Detect digital signature fields in a PDF."""
    import pymupdf

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return {"has_signatures": False, "count": 0, "details": []}

    try:
        details: list[dict] = []
        for page_idx in range(doc.page_count):
            page = doc.load_page(page_idx)
            widgets = page.widgets()
            if not widgets:
                continue
            for widget in widgets:
                if widget.field_type == pymupdf.PDF_WIDGET_TYPE_SIG:
                    details.append({
                        "page": page_idx + 1,
                        "field_name": widget.field_name or "",
                        "is_signed": bool(widget.field_value),
                    })

        return {
            "has_signatures": len(details) > 0,
            "count": len(details),
            "details": details,
        }
    finally:
        doc.close()


def repair_pdf_bytes(pdf_bytes: bytes) -> bytes:
    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        return doc.tobytes(garbage=4, deflate=True)
    finally:
        doc.close()
