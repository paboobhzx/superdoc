"""Fast docx-to-PDF handler using python-docx + reportlab.

Trades fidelity for speed: extracts paragraph text and basic heading styles,
produces a clean readable PDF in < 2 seconds. Complex layouts, images, and
custom fonts are not preserved — use the high-fidelity (LibreOffice) path for those.
"""
import io
import json as _json
from xml.sax.saxutils import escape

import dynamo
import output_naming
import page_sizes
import s3
from logger import get_logger

log = get_logger(__name__)


def _docx_to_pdf(docx_bytes: bytes, paper_size: str | None = None) -> bytes:
    from docx import Document
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    pw, ph = page_sizes.get(paper_size)
    buf = io.BytesIO()
    doc_template = SimpleDocTemplate(buf, pagesize=(pw, ph))
    styles = getSampleStyleSheet()
    story = []

    word_doc = Document(io.BytesIO(docx_bytes))
    for para in word_doc.paragraphs:
        text = para.text
        if not text.strip():
            story.append(Spacer(1, 6))
            continue
        style_name = para.style.name or ""
        if "Heading 1" in style_name:
            rl_style = styles["Heading1"]
        elif "Heading 2" in style_name:
            rl_style = styles["Heading2"]
        elif "Heading 3" in style_name:
            rl_style = styles["Heading3"]
        else:
            rl_style = styles["Normal"]
        try:
            story.append(Paragraph(escape(text), rl_style))
        except Exception:
            story.append(Paragraph(escape(text[:200]), rl_style))

    if not story:
        story.append(Paragraph("(empty document)", styles["Normal"]))

    doc_template.build(story)
    return buf.getvalue()


def handler(event, context):
    if event.get("_warmup"):
        log.info("warmup ping received")
        return
    body = _json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    file_key = body["file_key"]
    params = body.get("params") or {}
    paper_size = params.get("paper_size") or None

    try:
        dynamo.update_job(job_id, status="PROCESSING")
        data = s3.get_bytes(file_key)
        result = _docx_to_pdf(data, paper_size=paper_size)
        out_key = s3.make_output_key(job_id, file_key, output_naming.output_filename("docx_to_pdf", body, file_key, "pdf"))
        s3.put_bytes(out_key, result)
        dynamo.mark_done(job_id, out_key)
        log.info("docx_to_pdf_fast done", extra={"job_id": job_id})
    except Exception as exc:
        log.exception("docx_to_pdf_fast failed: %s", exc)
        dynamo.mark_failed(job_id, str(exc))
        raise
