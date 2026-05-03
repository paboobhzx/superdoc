from __future__ import annotations

import io
import os

from .model import Block
from .render_text import _plain_text_from_blocks, _node_text


IMAGE_WIDTH = int(os.environ.get("MARKDOWN_IMAGE_WIDTH", "1200"))
IMAGE_MAX_HEIGHT = int(os.environ.get("MARKDOWN_IMAGE_MAX_HEIGHT", "65000"))
IMAGE_MAX_PIXELS = int(os.environ.get("MARKDOWN_IMAGE_MAX_PIXELS", "50000000"))


def _font(size: int):
    from PIL import ImageFont

    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                pass
    return ImageFont.load_default()


def _wrap_text(draw, text: str, font, width: int) -> list[str]:
    lines: list[str] = []
    for raw_line in text.splitlines() or [""]:
        words = raw_line.split(" ")
        current = ""
        for word in words:
            candidate = word if not current else f"{current} {word}"
            if draw.textbbox((0, 0), candidate, font=font)[2] <= width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
        lines.append(current)
    return lines


def render_image(blocks: list[Block], target_format: str) -> bytes:
    from PIL import Image, ImageDraw

    margin = 72
    width = IMAGE_WIDTH
    content_width = width - (margin * 2)
    body_font = _font(24)
    small_font = _font(20)
    code_font = _font(19)
    heading_fonts = {1: _font(42), 2: _font(34), 3: _font(28)}

    scratch = Image.new("RGB", (width, 200), "white")
    draw = ImageDraw.Draw(scratch)
    commands = []
    y = margin

    def add_text(text: str, font, fill=(31, 35, 40), indent=0, spacing=10):
        nonlocal y
        for line in _wrap_text(draw, text, font, content_width - indent):
            commands.append(("text", margin + indent, y, line, font, fill))
            bbox = draw.textbbox((0, 0), line or " ", font=font)
            y += (bbox[3] - bbox[1]) + spacing
        y += spacing

    def add_block(block: Block, *, quote: bool = False):
        if block.kind == "heading":
            add_text(_node_text(block.inlines), heading_fonts.get(min(block.level, 3), heading_fonts[3]), fill=(17, 24, 39), spacing=12)
        elif block.kind == "paragraph":
            add_text(_node_text(block.inlines), body_font, indent=24 if quote else 0)
        elif block.kind == "list":
            for idx, item in enumerate(block.items, start=1):
                bullet = f"{idx}. " if block.ordered else "- "
                add_text(bullet + _node_text(item), body_font, indent=18, spacing=8)
        elif block.kind == "quote":
            for nested in block.blocks:
                add_block(nested, quote=True)
        elif block.kind == "section":
            for nested in block.blocks:
                add_block(nested, quote=quote)
        elif block.kind == "code":
            add_text(block.text, code_font, fill=(36, 41, 47), indent=18, spacing=8)
        elif block.kind == "table":
            table_lines = []
            if block.headers:
                table_lines.append(" | ".join(_node_text(cell) for cell in block.headers))
            for row in block.rows:
                table_lines.append(" | ".join(_node_text(cell) for cell in row))
            add_text("\n".join(table_lines), small_font, fill=(36, 41, 47))

    for block in blocks:
        add_block(block)

    height = max(y + margin, 400)
    if height > IMAGE_MAX_HEIGHT or (width * height) > IMAGE_MAX_PIXELS:
        raise ValueError("Document is too long to render as one image. Use PDF for very long documents.")

    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    for _kind, x, y_pos, text, font, fill in commands:
        draw.text((x, y_pos), text, font=font, fill=fill)

    out = io.BytesIO()
    fmt = "JPEG" if target_format in ("jpg", "jpeg") else target_format.upper()
    image.save(out, format=fmt, quality=92)
    return out.getvalue()
