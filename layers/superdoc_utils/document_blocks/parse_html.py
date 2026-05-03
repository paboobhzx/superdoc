from __future__ import annotations

from bs4 import NavigableString, BeautifulSoup

from .model import Block, Inline


def _parse_inlines(node, *, bold: bool = False, italic: bool = False, code: bool = False, href: str | None = None) -> list[Inline]:
    if isinstance(node, NavigableString):
        text = str(node)
        return [Inline(text=text, bold=bold, italic=italic, code=code, href=href)] if text else []

    name = getattr(node, "name", "")
    next_bold = bold or name in ("strong", "b")
    next_italic = italic or name in ("em", "i")
    next_code = code or name == "code"
    next_href = node.get("href") or href if name == "a" else href
    if name == "br":
        return [Inline("\n", bold=bold, italic=italic, code=code, href=href)]

    parts: list[Inline] = []
    for child in getattr(node, "children", []):
        parts.extend(_parse_inlines(child, bold=next_bold, italic=next_italic, code=next_code, href=next_href))
    return parts


def parse_html(html_text: str) -> list[Block]:
    soup = BeautifulSoup(html_text, "html.parser")
    blocks: list[Block] = []

    def parse_block(node) -> Block | None:
        if isinstance(node, NavigableString):
            if str(node).strip():
                return Block(kind="paragraph", inlines=[Inline(str(node).strip())])
            return None

        name = getattr(node, "name", "")
        if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            return Block(kind="heading", level=int(name[1]), inlines=_parse_inlines(node))
        if name == "p":
            return Block(kind="paragraph", inlines=_parse_inlines(node))
        if name in ("ul", "ol"):
            items = [_parse_inlines(li) for li in node.find_all("li", recursive=False)]
            return Block(kind="list", ordered=name == "ol", items=items)
        if name == "blockquote":
            quote_blocks = [parsed for child in node.children if (parsed := parse_block(child)) is not None]
            return Block(kind="quote", blocks=quote_blocks)
        if name == "pre":
            return Block(kind="code", text=node.get_text().rstrip("\n"))
        if name == "table":
            headers: list[list[Inline]] = []
            rows: list[list[list[Inline]]] = []
            thead = node.find("thead")
            if thead:
                first = thead.find("tr")
                if first:
                    headers = [_parse_inlines(cell) for cell in first.find_all(["th", "td"], recursive=False)]
            tbody = node.find("tbody") or node
            for tr in tbody.find_all("tr", recursive=False):
                cells = [_parse_inlines(cell) for cell in tr.find_all(["td", "th"], recursive=False)]
                if cells:
                    rows.append(cells)
            if not headers and rows:
                headers = rows.pop(0)
            return Block(kind="table", headers=headers, rows=rows)
        if name == "section":
            section_blocks = [parsed for child in node.children if (parsed := parse_block(child)) is not None]
            if section_blocks:
                return Block(kind="section", blocks=section_blocks)
        return None

    for child in soup.children:
        block = parse_block(child)
        if block is not None:
            blocks.append(block)
    return blocks or [Block(kind="paragraph", inlines=[Inline("")])]
