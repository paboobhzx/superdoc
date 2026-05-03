from __future__ import annotations

from .model import Block, Inline


def _node_text(inlines):
    return "".join(part.text for part in inlines)


def _plain_text_from_blocks(blocks: list[Block]) -> str:
    lines: list[str] = []
    for block in blocks:
        if block.kind in ("heading", "paragraph"):
            lines.append(_node_text(block.inlines))
        elif block.kind == "list":
            lines.extend(_node_text(item) for item in block.items)
        elif block.kind == "quote":
            lines.extend(_plain_text_from_blocks(block.blocks).splitlines())
        elif block.kind == "section":
            lines.extend(_plain_text_from_blocks(block.blocks).splitlines())
        elif block.kind == "code":
            lines.append(block.text)
        elif block.kind == "table":
            if block.headers:
                lines.append(" | ".join(_node_text(cell) for cell in block.headers))
            for row in block.rows:
                lines.append(" | ".join(_node_text(cell) for cell in row))
    return "\n".join(lines).strip() + "\n"


def render_plain_text(blocks: list[Block]) -> bytes:
    return _plain_text_from_blocks(blocks).encode("utf-8")
