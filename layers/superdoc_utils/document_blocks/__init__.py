from .model import Block, Inline
from .parse_html import parse_html
from .parse_markdown import parse_markdown
from .render_docx import render_docx
from .render_html import render_html
from .render_image import render_image
from .render_pdf import render_pdf
from .render_text import render_plain_text


def render_to(blocks, target_format):
    target = (target_format or "").lower()
    if target == "txt":
        return render_plain_text(blocks)
    # Markdown output from blocks is intentionally not supported. Once the
    # original source has been parsed into blocks, we no longer have enough
    # fidelity to reconstruct the user's exact Markdown source.
    if target == "md":
        raise ValueError("Render to md is not supported from blocks; use the source bytes.")
    if target == "html":
        return render_html(blocks)
    if target == "pdf":
        return render_pdf(blocks)
    if target == "docx":
        return render_docx(blocks)
    if target in ("png", "jpg", "jpeg", "tiff", "webp", "gif"):
        return render_image(blocks, target)
    raise ValueError(f"Unsupported target_format: {target_format}")
