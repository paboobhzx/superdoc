from __future__ import annotations

import io

from .model import Block


def _paragraph_markup(inlines) -> str:
    import html

    parts: list[str] = []
    for item in inlines:
        text = html.escape(item.text).replace("\n", "<br/>")
        if not text:
            continue
        if item.code:
            text = f'<font name="Courier">{text}</font>'
        if item.bold:
            text = f"<b>{text}</b>"
        if item.italic:
            text = f"<i>{text}</i>"
        if item.href:
            link = html.escape(item.href, quote=True)
            text = f'<link href="{link}" color="blue">{text}</link>'
        parts.append(text)
    return "".join(parts) or "&nbsp;"


def render_pdf(blocks: list[Block]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import ListFlowable, ListItem, Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    styles["Normal"].fontName = "Helvetica"
    styles["Normal"].fontSize = 10.5
    styles["Normal"].leading = 15
    styles["Code"].fontName = "Courier"
    styles["Code"].fontSize = 9
    styles["Code"].leading = 12

    story = []

    def add_block(block: Block, *, quote: bool = False):
        left_indent = 18 if quote else 0
        if block.kind == "heading":
            style = styles[f"Heading{min(max(block.level, 1), 3)}"]
            story.append(Paragraph(_paragraph_markup(block.inlines), style))
            story.append(Spacer(1, 6))
        elif block.kind == "paragraph":
            style = styles["Normal"].clone("QuoteParagraph" if quote else "BodyParagraph")
            style.leftIndent = left_indent
            story.append(Paragraph(_paragraph_markup(block.inlines), style))
            story.append(Spacer(1, 8))
        elif block.kind == "list":
            items = [ListItem(Paragraph(_paragraph_markup(item), styles["Normal"])) for item in block.items]
            story.append(ListFlowable(items, bulletType="1" if block.ordered else "bullet", leftIndent=24 + left_indent))
            story.append(Spacer(1, 8))
        elif block.kind == "quote":
            for nested in block.blocks:
                add_block(nested, quote=True)
        elif block.kind == "section":
            for nested in block.blocks:
                add_block(nested, quote=quote)
        elif block.kind == "code":
            story.append(Preformatted(block.text or " ", styles["Code"], maxLineLength=90))
            story.append(Spacer(1, 8))
        elif block.kind == "table":
            data = []
            if block.headers:
                data.append([Paragraph(_paragraph_markup(cell), styles["Normal"]) for cell in block.headers])
            for row in block.rows:
                data.append([Paragraph(_paragraph_markup(cell), styles["Normal"]) for cell in row])
            if data:
                table = Table(data, hAlign="LEFT")
                table.setStyle(TableStyle([
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D0D7DE")),
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F6F8FA")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.append(table)
                story.append(Spacer(1, 10))

    for block in blocks:
        add_block(block)

    out = io.BytesIO()

    def paint_background(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(colors.white)
        canvas.rect(0, 0, doc.pagesize[0], doc.pagesize[1], stroke=0, fill=1)
        canvas.restoreState()

    doc = SimpleDocTemplate(out, pagesize=letter, leftMargin=0.8 * inch, rightMargin=0.8 * inch, topMargin=0.7 * inch, bottomMargin=0.7 * inch)
    doc.build(story, onFirstPage=paint_background, onLaterPages=paint_background)
    return out.getvalue()
