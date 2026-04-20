// frontend/src/pages/Home/picker.js
// UI-only metadata keyed by operation id. The backend catalog (GET /operations)
// returns label/category/input_types/output_type/kind/intent — those are
// functional facts. Icon and rich description live here because they are
// presentation choices that should not require a backend deploy to change.

export const OPERATION_UI = {
  // ── PDF ops ────────────────────────────────────────────────────────────
  pdf_compress: {
    icon: "compress",
    description: "Shrink PDFs while keeping quality readable. Great for email attachments.",
  },
  pdf_merge: {
    icon: "merge",
    description: "Combine multiple PDFs into one file, in the order you choose.",
  },
  pdf_split: {
    icon: "call_split",
    description: "Break a PDF into page ranges or individual pages.",
  },
  pdf_rotate: {
    icon: "rotate_right",
    description: "Rotate pages 90/180/270 degrees. Fix scans that came in sideways.",
  },
  pdf_annotate: {
    icon: "branding_watermark",
    description: "Overlay a watermark or note on every page.",
  },
  pdf_extract_text: {
    icon: "content_paste",
    description: "Structured JSON with page-by-page text. Best for developers and automation.",
  },
  pdf_to_docx: {
    icon: "description",
    description: "Editable Word document while keeping layout as close as possible.",
  },
  pdf_to_txt: {
    icon: "text_fields",
    description: "Plain text of every page, ideal for search, indexing, or AI pipelines.",
  },
  pdf_to_image: {
    icon: "image",
    description: "Render each page as a PNG image. Returned as a single ZIP.",
  },

  // ── DOCX / XLSX ops ────────────────────────────────────────────────────
  doc_edit: {
    // Rewritten in Round 4-3: this is now a WYSIWYG editor, not find-and-replace.
    icon: "edit_document",
    description: "Open in the WYSIWYG editor — edit headings, bold, lists, links, then export back to .docx.",
  },
  docx_to_txt: {
    icon: "text_fields",
    description: "Extract plain text from the Word document. Formatting is dropped.",
  },
  xlsx_to_csv: {
    icon: "table_chart",
    description: "Export the first sheet of the spreadsheet as a CSV file.",
  },

  // ── Image ops ──────────────────────────────────────────────────────────
  image_convert: {
    icon: "transform",
    description: "Switch between PNG, JPG, WebP, and GIF without quality loss.",
  },
  image_to_pdf: {
    icon: "picture_as_pdf",
    description: "Wrap the image into a single-page PDF document.",
  },

  // ── Video ops ──────────────────────────────────────────────────────────
  video_process: {
    icon: "movie",
    description: "Trim, re-encode, or transcode video. Billed per video duration.",
  },
}


// Fallback metadata when an operation id arrives that we don't have UI data
// for yet. We still render it — the user can still pick it — but with a
// generic icon. Description collapses to empty so the backend's label carries
// the message.
export const FALLBACK_UI = {
  icon: "auto_awesome",
  description: "",
}


export function uiFor(operationId) {
  const meta = OPERATION_UI[operationId]
  if (meta) {
    return meta
  }
  return FALLBACK_UI
}
