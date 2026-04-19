// frontend/src/pages/Home/picker.js
// UI-only metadata keyed by operation id. The backend catalog (GET /operations)
// returns label/category/input_types/output_type - those are functional facts.
// Icon and rich description live here because they are presentation choices
// that should not require a backend deploy to change.

export const OPERATION_UI = {
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
  pdf_to_docx: {
    icon: "description",
    description: "Editable Word document while keeping layout as close as possible.",
  },
  pdf_to_txt: {
    icon: "text_fields",
    description: "Plain text of every page, ideal for search, indexing, or AI pipelines.",
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
  image_convert: {
    icon: "transform",
    description: "Switch between PNG, JPG, WebP, and GIF without quality loss.",
  },
  doc_edit: {
    icon: "edit_document",
    description: "Find and replace text in Word, or edit individual Excel cells.",
  },
  video_process: {
    icon: "movie",
    description: "Trim, re-encode, or transcode video. Billed per video duration.",
  },
}

// Fallback metadata when an operation id arrives that we don't have UI data
// for yet. We still render it - the user can still pick it - but with a
// generic icon and description pulled from the backend label.
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
