from __future__ import annotations

import html

from .model import Block


def _inline_markup(text: str) -> str:
    return html.escape(text, quote=True)


def _render_inlines(inlines) -> str:
    parts: list[str] = []
    for item in inlines:
        text = html.escape(item.text).replace("\n", "<br/>")
        if not text:
            continue
        if item.code:
            text = f"<code>{text}</code>"
        if item.bold:
            text = f"<strong>{text}</strong>"
        if item.italic:
            text = f"<em>{text}</em>"
        if item.href:
            link = html.escape(item.href, quote=True)
            text = f'<a href="{link}">{text}</a>'
        parts.append(text)
    return "".join(parts)


def _render_blocks(blocks: list[Block]) -> list[str]:
    parts: list[str] = []
    for block in blocks:
        if block.kind == "heading":
            level = min(max(block.level, 1), 6)
            parts.append(f"<h{level}>{_render_inlines(block.inlines)}</h{level}>")
        elif block.kind == "paragraph":
            parts.append(f"<p>{_render_inlines(block.inlines) or '&nbsp;'}</p>")
        elif block.kind == "list":
            tag = "ol" if block.ordered else "ul"
            parts.append(f"<{tag}>")
            for item in block.items:
                parts.append(f"<li>{_render_inlines(item)}</li>")
            parts.append(f"</{tag}>")
        elif block.kind == "quote":
            parts.append("<blockquote>")
            parts.extend(_render_blocks(block.blocks))
            parts.append("</blockquote>")
        elif block.kind == "section":
            parts.append("<section>")
            parts.extend(_render_blocks(block.blocks))
            parts.append("</section>")
        elif block.kind == "code":
            parts.append(f"<pre><code>{html.escape(block.text)}</code></pre>")
        elif block.kind == "table":
            parts.append("<table>")
            if block.headers:
                parts.append("<thead><tr>")
                for cell in block.headers:
                    parts.append(f"<th>{_render_inlines(cell)}</th>")
                parts.append("</tr></thead>")
            parts.append("<tbody>")
            for row in block.rows:
                parts.append("<tr>")
                for cell in row:
                    parts.append(f"<td>{_render_inlines(cell)}</td>")
                parts.append("</tr>")
            parts.append("</tbody></table>")
    return parts


def render_html(blocks: list[Block]) -> bytes:
    parts = ["<!doctype html>", "<html>", "<body>"]
    parts.extend(_render_blocks(blocks))
    parts.append("</body></html>")
    return "\n".join(parts).encode("utf-8")
