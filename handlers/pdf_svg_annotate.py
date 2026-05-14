import io
import json
import zipfile
from xml.etree import ElementTree

import dynamo
import limits
import s3
from logger import get_logger

log = get_logger(__name__)


def _svg_attr(element, name: str, default=None):
    if name in element.attrib:
        return element.attrib[name]
    data_name = f"data-{name}"
    if data_name in element.attrib:
        return element.attrib[data_name]
    return default


def _float_attr(element, name: str, default=0.0) -> float:
    value = _svg_attr(element, name, default)
    return float(str(value).replace("px", ""))


def _page_index(element, page_count: int) -> int:
    raw = _svg_attr(element, "page", "1")
    idx = int(raw) - 1
    if idx < 0 or idx >= page_count:
        raise ValueError(f"Annotation page {idx + 1} is outside the document range 1-{page_count}")
    return idx


def _rect_from_svg(pymupdf, page, x: float, y: float, width: float, height: float):
    # SVG and PyMuPDF both expose a top-left coordinate space for page APIs.
    # PDF content streams use bottom-left coordinates, but annotations in
    # PyMuPDF are placed through the page coordinate system.
    return pymupdf.Rect(x, y, x + width, y + height) & page.rect


def _points_from_attr(pymupdf, element):
    raw = _svg_attr(element, "points", "") or ""
    points = []
    for part in raw.replace(";", " ").split():
        if "," not in part:
            continue
        x_raw, y_raw = part.split(",", 1)
        points.append(pymupdf.Point(float(x_raw), float(y_raw)))
    return points


def _annotation_type(element) -> str:
    tag = element.tag.rsplit("}", 1)[-1].lower()
    raw = _svg_attr(element, "type") or _svg_attr(element, "annotation") or tag
    value = str(raw).strip().lower()
    aliases = {
        "highlight": "highlight",
        "text": "freetext",
        "freetext": "freetext",
        "line": "line",
        "rect": "square",
        "rectangle": "square",
        "square": "square",
        "circle": "circle",
        "ellipse": "circle",
        "ink": "ink",
        "polyline": "ink",
        "path": "ink",
    }
    return aliases.get(value, "")


def _apply_annotation(pymupdf, doc, element):
    page = doc.load_page(_page_index(element, doc.page_count))
    kind = _annotation_type(element)
    x = _float_attr(element, "x", 0)
    y = _float_attr(element, "y", 0)
    width = _float_attr(element, "width", _float_attr(element, "w", 0))
    height = _float_attr(element, "height", _float_attr(element, "h", 0))
    text = _svg_attr(element, "text", "") or (element.text or "")

    if kind == "highlight":
        rect = _rect_from_svg(pymupdf, page, x, y, width, height)
        annot = page.add_highlight_annot(rect)
    elif kind == "freetext":
        rect = _rect_from_svg(pymupdf, page, x, y, width or 120, height or 32)
        annot = page.add_freetext_annot(rect, text.strip())
    elif kind == "line":
        points = _points_from_attr(pymupdf, element)
        if len(points) < 2:
            x2 = _float_attr(element, "x2", x + width)
            y2 = _float_attr(element, "y2", y + height)
            points = [pymupdf.Point(x, y), pymupdf.Point(x2, y2)]
        annot = page.add_line_annot(points[0], points[1])
    elif kind == "square":
        rect = _rect_from_svg(pymupdf, page, x, y, width, height)
        annot = page.add_rect_annot(rect)
    elif kind == "circle":
        if width == 0 and height == 0:
            cx = _float_attr(element, "cx", x)
            cy = _float_attr(element, "cy", y)
            r = _float_attr(element, "r", 10)
            x, y, width, height = cx - r, cy - r, r * 2, r * 2
        rect = _rect_from_svg(pymupdf, page, x, y, width, height)
        annot = page.add_circle_annot(rect)
    elif kind == "ink":
        points = _points_from_attr(pymupdf, element)
        if len(points) < 2:
            return False
        annot = page.add_ink_annot([points])
    else:
        return False

    color = _svg_attr(element, "color", None) or _svg_attr(element, "stroke", None)
    if color and color.startswith("#") and len(color) == 7:
        rgb = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
        annot.set_colors(stroke=rgb)
    annot.update()
    return True


def _process(data: bytes, body: dict) -> bytes:
    import pymupdf

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = {name.lower(): name for name in zf.namelist()}
        pdf_name = names.get("document.pdf")
        svg_name = names.get("annotations.svg")
        if not pdf_name or not svg_name:
            raise ValueError("ZIP must contain document.pdf and annotations.svg")
        pdf_bytes = zf.read(pdf_name)
        svg_bytes = zf.read(svg_name)

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        root = ElementTree.fromstring(svg_bytes)
        applied = 0
        for element in root.iter():
            if _apply_annotation(pymupdf, doc, element):
                applied += 1
        if applied == 0:
            raise ValueError("No supported SVG annotations were found")
        if body.get("flatten") and hasattr(doc, "bake"):
            doc.bake(annots=True, widgets=False)
        return doc.tobytes(garbage=4, deflate=True)
    finally:
        doc.close()


def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _process(data, body)
        limits.assert_pdf_page_limit(result, body.get("user_id") or "")
        out_key = s3.make_output_key(job_id, file_key, "annotated.pdf")
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("pdf_svg_annotate done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("pdf_svg_annotate failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
