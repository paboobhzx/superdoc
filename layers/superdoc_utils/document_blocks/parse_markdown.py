from __future__ import annotations

from bs4 import BeautifulSoup

from .parse_html import parse_html


def parse_markdown(text: str):
    import markdown

    md = markdown.Markdown(
        extensions=[
            "markdown.extensions.fenced_code",
            "markdown.extensions.footnotes",
            "markdown.extensions.attr_list",
            "markdown.extensions.def_list",
            "markdown.extensions.tables",
            "markdown.extensions.abbr",
            "markdown.extensions.md_in_html",
            "markdown.extensions.sane_lists",
        ]
    )
    html_text = md.convert(text)
    # Markdown is first normalized to HTML and then re-used through the HTML
    # parser so both sources share the same block model and renderers.
    soup = BeautifulSoup(html_text, "html.parser")
    return parse_html(str(soup))
