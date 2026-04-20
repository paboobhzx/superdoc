// frontend/src/lib/docxFromHtml.js
//
// Converts an HTML string (as produced by TipTap's editor.getHTML()) into a
// DOCX Blob using the `docx` library already in the project. No new deps.
//
// Scope: inline formatting (bold, italic, underline), headings (h1-h4), lists
// (bullet + numbered), links, blockquote, simple tables (single row/column
// grouping), paragraphs, line breaks.
//
// NOT supported (by design — keeps the converter under 200 lines):
//   - Nested lists beyond one level
//   - Merged table cells
//   - Embedded images (would require base64 decoding + ImageRun)
//   - Custom fonts, colors, font sizes
//   - Page breaks, headers/footers, sections
//
// The TipTap editor produces clean semantic HTML, so the set of node types
// we need to handle is small. Each node type has one handler function.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  ExternalHyperlink,
} from "docx";


// Map h1-h4 to docx HeadingLevel constants. h5/h6 collapse to HEADING_4.
const HEADING_LEVELS = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
  h5: HeadingLevel.HEADING_4,
  h6: HeadingLevel.HEADING_4,
};


// Walks inline HTML (text nodes, <strong>, <em>, <u>, <a>, <br>) and returns
// an array of docx text-level runs. Called recursively when a formatting tag
// wraps more inline content.
function inlineRuns(node, inheritedStyle) {
  const style = { ...(inheritedStyle || {}) };
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    if (!text) return [];
    return [new TextRun({ text, ...style })];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }
  const tag = node.tagName.toLowerCase();
  if (tag === "br") {
    return [new TextRun({ text: "", break: 1, ...style })];
  }
  if (tag === "strong" || tag === "b") {
    style.bold = true;
  } else if (tag === "em" || tag === "i") {
    style.italics = true;
  } else if (tag === "u") {
    style.underline = {};
  } else if (tag === "s" || tag === "strike" || tag === "del") {
    style.strike = true;
  } else if (tag === "code") {
    style.font = "Courier New";
  }

  if (tag === "a") {
    // Links produce an ExternalHyperlink wrapper containing runs.
    const href = node.getAttribute("href") || "#";
    const childRuns = [];
    for (const child of node.childNodes) {
      childRuns.push(...inlineRuns(child, { ...style, style: "Hyperlink" }));
    }
    return [new ExternalHyperlink({ link: href, children: childRuns })];
  }

  const collected = [];
  for (const child of node.childNodes) {
    collected.push(...inlineRuns(child, style));
  }
  return collected;
}


// Convert a block-level element (p, h1-h6, blockquote, li) into docx
// Paragraph objects. A single element may produce multiple paragraphs when
// the input HTML nests block content in unexpected ways, but the common
// case is one paragraph per block element.
function blockElementToParagraphs(el) {
  const tag = el.tagName.toLowerCase();
  const runs = [];
  for (const child of el.childNodes) {
    runs.push(...inlineRuns(child, null));
  }
  // Empty paragraphs still get emitted — they're intentional blank lines.
  if (tag in HEADING_LEVELS) {
    return [new Paragraph({ children: runs, heading: HEADING_LEVELS[tag] })];
  }
  if (tag === "blockquote") {
    return [new Paragraph({ children: runs, style: "IntenseQuote" })];
  }
  return [new Paragraph({ children: runs })];
}


// <ul> and <ol> render each <li> as a bullet/numbered paragraph. Only
// handles one nesting level — nested lists flatten. Good enough for ~90%
// of documents.
function listToParagraphs(listEl, ordered) {
  const paragraphs = [];
  for (const child of listEl.children) {
    if (child.tagName.toLowerCase() !== "li") continue;
    const runs = [];
    for (const liChild of child.childNodes) {
      runs.push(...inlineRuns(liChild, null));
    }
    if (ordered) {
      paragraphs.push(new Paragraph({ children: runs, numbering: { reference: "ordered-list", level: 0 } }));
    } else {
      paragraphs.push(new Paragraph({ children: runs, bullet: { level: 0 } }));
    }
  }
  return paragraphs;
}


// <table> with <tr>/<td> or <thead>/<tbody> structures. Produces a single
// docx Table with equal-width columns. Merged cells not supported.
function tableToDocx(tableEl) {
  const rows = [];
  // Collect <tr> from thead/tbody/tfoot or directly from the table.
  const trNodes = tableEl.querySelectorAll("tr");
  trNodes.forEach((tr) => {
    const cells = [];
    tr.querySelectorAll("td, th").forEach((td) => {
      const runs = [];
      for (const child of td.childNodes) {
        runs.push(...inlineRuns(child, null));
      }
      cells.push(new TableCell({
        children: [new Paragraph({ children: runs })],
      }));
    });
    if (cells.length > 0) {
      rows.push(new TableRow({ children: cells }));
    }
  });
  if (rows.length === 0) return [];
  return [new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })];
}


// Top-level walker. Takes an HTML string; returns an array of docx block
// elements (Paragraph | Table) suitable for Document.sections[0].children.
function htmlToDocxBlocks(html) {
  // Use DOMParser — available in browser and in jsdom (for tests).
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild || doc.body;

  const blocks = [];
  for (const child of root.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === "p" || tag === "blockquote" || tag in HEADING_LEVELS) {
      blocks.push(...blockElementToParagraphs(child));
    } else if (tag === "ul") {
      blocks.push(...listToParagraphs(child, false));
    } else if (tag === "ol") {
      blocks.push(...listToParagraphs(child, true));
    } else if (tag === "table") {
      blocks.push(...tableToDocx(child));
    } else if (tag === "hr") {
      // Horizontal rule — emit an empty paragraph with a bottom border via
      // text; skipping gracefully is fine. Leaving a blank line keeps the
      // visual cue.
      blocks.push(new Paragraph({ children: [] }));
    } else {
      // Unknown element — fall back to treating it as a plain paragraph.
      blocks.push(...blockElementToParagraphs(child));
    }
  }
  // A DOCX with zero blocks is invalid; always emit at least one.
  if (blocks.length === 0) {
    blocks.push(new Paragraph({ children: [] }));
  }
  return blocks;
}


// Produces a Blob suitable for download or upload. The numbering config
// at the bottom enables ordered lists via Word's numbering scheme.
export async function htmlToDocxBlob(html) {
  const children = htmlToDocxBlocks(html || "");
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  });
  return await Packer.toBlob(doc);
}
