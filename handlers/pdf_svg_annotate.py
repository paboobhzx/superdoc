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
    if name == "type" and "data-annot-type" in element.attrib:
        return element.attrib["data-annot-type"]
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


def _viewbox(root) -> tuple[float, float, float, float] | None:
    raw = root.attrib.get("viewBox") or root.attrib.get("viewbox")
    if not raw:
        return None
    parts = [part for part in raw.replace(",", " ").split() if part]
    if len(parts) != 4:
        return None
    try:
        x, y, width, height = (float(part) for part in parts)
    except ValueError:
        return None
    if width <= 0 or height <= 0:
        return None
    return x, y, width, height


def _scale_values(page, viewbox, *values: float) -> tuple[float, ...]:
    if not viewbox:
        return values
    min_x, min_y, vb_width, vb_height = viewbox
    sx = page.rect.width / vb_width
    sy = page.rect.height / vb_height
    scaled = []
    for idx, value in enumerate(values):
        if idx % 2 == 0:
            scaled.append((value - min_x) * sx)
        else:
            scaled.append((value - min_y) * sy)
    return tuple(scaled)


def _scale_size(page, viewbox, width: float, height: float) -> tuple[float, float]:
    if not viewbox:
        return width, height
    _min_x, _min_y, vb_width, vb_height = viewbox
    return width * page.rect.width / vb_width, height * page.rect.height / vb_height


def _rect_from_svg(pymupdf, page, viewbox, x: float, y: float, width: float, height: float):
    # SVG and PyMuPDF both expose a top-left coordinate space for page APIs.
    # PDF content streams use bottom-left coordinates, but annotations in
    # PyMuPDF are placed through the page coordinate system.
    x, y = _scale_values(page, viewbox, x, y)
    width, height = _scale_size(page, viewbox, width, height)
    return pymupdf.Rect(x, y, x + width, y + height) & page.rect


def _points_from_attr(pymupdf, page, viewbox, element):
    raw = _svg_attr(element, "points", "") or ""
    points = []
    for part in raw.replace(";", " ").split():
        if "," not in part:
            continue
        x_raw, y_raw = part.split(",", 1)
        x, y = _scale_values(page, viewbox, float(x_raw), float(y_raw))
        points.append(pymupdf.Point(x, y))
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


def _apply_annotation(pymupdf, doc, element, viewbox):
    page = doc.load_page(_page_index(element, doc.page_count))
    kind = _annotation_type(element)
    x = _float_attr(element, "x", 0)
    y = _float_attr(element, "y", 0)
    width = _float_attr(element, "width", _float_attr(element, "w", 0))
    height = _float_attr(element, "height", _float_attr(element, "h", 0))
    text = _svg_attr(element, "text", "") or (element.text or "")

    if kind == "highlight":
        rect = _rect_from_svg(pymupdf, page, viewbox, x, y, width, height)
        annot = page.add_highlight_annot(rect)
    elif kind == "freetext":
        rect = _rect_from_svg(pymupdf, page, viewbox, x, y, width or 120, height or 32)
        annot = page.add_freetext_annot(rect, text.strip())
    elif kind == "line":
        points = _points_from_attr(pymupdf, page, viewbox, element)
        if len(points) < 2:
            x2 = _float_attr(element, "x2", x + width)
            y2 = _float_attr(element, "y2", y + height)
            x1, y1, x2, y2 = _scale_values(page, viewbox, x, y, x2, y2)
            points = [pymupdf.Point(x1, y1), pymupdf.Point(x2, y2)]
        annot = page.add_line_annot(points[0], points[1])
    elif kind == "square":
        rect = _rect_from_svg(pymupdf, page, viewbox, x, y, width, height)
        annot = page.add_rect_annot(rect)
    elif kind == "circle":
        if width == 0 and height == 0:
            cx = _float_attr(element, "cx", x)
            cy = _float_attr(element, "cy", y)
            r = _float_attr(element, "r", 10)
            x, y, width, height = cx - r, cy - r, r * 2, r * 2
        rect = _rect_from_svg(pymupdf, page, viewbox, x, y, width, height)
        annot = page.add_circle_annot(rect)
    elif kind == "ink":
        points = _points_from_attr(pymupdf, page, viewbox, element)
        if len(points) < 2:
            return False
        annot = page.add_ink_annot([points])
    else:
        return False

    color = _svg_attr(element, "color", None) or _svg_attr(element, "stroke", None) or _svg_attr(element, "fill", None)
    if color and color.startswith("#") and len(color) == 7:
        rgb = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
        annot.set_colors(stroke=rgb)
    author = _svg_attr(element, "author", None)
    if author and hasattr(annot, "set_info"):
        annot.set_info(title=str(author))
    annot.update()
    return True


def _flatten_annotations(doc) -> None:
    if not hasattr(doc, "bake"):
        raise ValueError("Installed PyMuPDF does not support annotation flattening")
    try:
        doc.bake(annots=True, widgets=False)
    except TypeError:
        doc.bake()


def _process(data: bytes, body: dict) -> bytes:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = {name.lower(): name for name in zf.namelist()}
        pdf_name = names.get("document.pdf")
        svg_name = names.get("annotations.svg")
        missing = []
        if not pdf_name:
            missing.append("document.pdf")
        if not svg_name:
            missing.append("annotations.svg")
        if missing:
            raise ValueError(f"ZIP is missing required file(s): {', '.join(missing)}")
        pdf_bytes = zf.read(pdf_name)
        svg_bytes = zf.read(svg_name)

    import pymupdf

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        root = ElementTree.fromstring(svg_bytes)
        viewbox = _viewbox(root)
        applied = 0
        for element in root.iter():
            if _apply_annotation(pymupdf, doc, element, viewbox):
                applied += 1
        if applied == 0:
            raise ValueError("No supported SVG annotations were found")
        if body.get("flatten"):
            _flatten_annotations(doc)
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
