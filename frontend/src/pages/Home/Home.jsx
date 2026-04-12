import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { DropZone } from "../../components/DropZone/DropZone";
import { ToolCard }  from "../../components/ToolCard/ToolCard";
import { api }       from "../../lib/api";
import styles        from "./Home.module.css";

const TOOLS = [
  {
    icon:    "📄",
    title:   "PDF Tools",
    desc:    "Merge, split, compress, rotate, annotate PDFs",
    accent:  "#1557E8",
    bgColor: "var(--primary-light)",
  },
  {
    icon:    "📝",
    title:   "Documents",
    desc:    "Edit Word & Excel. Convert between formats",
    accent:  "#16A34A",
    bgColor: "#F0FDF4",
  },
  {
    icon:    "🖼",
    title:   "Images",
    desc:    "Crop, resize, convert, remove background",
    accent:  "#EA580C",
    bgColor: "#FFF7ED",
  },
  {
    icon:    "🎬",
    title:   "Video",
    desc:    "Trim, convert, transcribe, hardcode subtitles",
    accent:  "#9333EA",
    bgColor: "#FDF4FF",
    badge:   "$1 / video",
  },
  {
    icon:    "🔄",
    title:   "Convert Anything",
    desc:    "Any format to any format — just drop and go",
    accent:  "#0284C7",
    bgColor: "#F0F9FF",
  },
  {
    icon:    "📤",
    title:   "Extract & Export",
    desc:    "Text, audio, and frames from any file",
    accent:  "#E11D48",
    bgColor: "#FFF1F2",
  },
];

export function Home() {
  const navigate = useNavigate();
  const [uploading, setUploading] = useState(false);
  const [err, setErr]             = useState(null);

  // Detect operation from file type
  function detectOperation(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    const map  = {
      pdf:  "pdf_to_docx",
      docx: "docx_to_pdf",
      doc:  "docx_to_pdf",
      jpg:  "image_convert",
      jpeg: "image_convert",
      png:  "image_convert",
      gif:  "image_convert",
      webp: "image_convert",
      mp4:  "video_process",
      webm: "video_process",
      xlsx: "doc_edit",
      xls:  "doc_edit",
    };
    return map[ext] || "pdf_to_docx";
  }

  const handleFile = useCallback(async (file) => {
    setErr(null);
    setUploading(true);
    try {
      const session_id = sessionStorage.getItem("superdoc_session") || crypto.randomUUID();
      sessionStorage.setItem("superdoc_session", session_id);

      const operation = detectOperation(file);
      const { job_id, upload_url } = await api.createJob({
        operation,
        file_size_bytes: file.size,
        file_name:       file.name,
        session_id,
      });

      // Upload directly to S3
      await api.uploadToS3(upload_url, file);

      // Trigger processing
      await api.triggerProcess(job_id);

      navigate(`/processing/${job_id}`);
    } catch (e) {
      setErr(e.message || "Upload failed — please try again");
    } finally {
      setUploading(false);
    }
  }, [navigate]);

  return (
    <main className={styles.main}>
      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <div className={styles.pill}>
            🆓 Free forever · No account needed · No dark patterns
          </div>
          <h1 className={styles.headline}>
            Convert, Edit &<br />
            <span className={styles.accent}>Transform Any File.</span>
          </h1>
          <p className={styles.sub}>
            Upload a PDF, Word doc, image or video and we handle the rest.
            Serverless, honest, and fast — no forced signups, no hidden fees.
          </p>
          <div className={styles.ctas}>
            <label className={styles.ctaPrimary}>
              {uploading ? "Uploading…" : "Upload a file →"}
              <input
                type="file"
                style={{ display: "none" }}
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                disabled={uploading}
              />
            </label>
            <button className={styles.ctaSecondary}>See all tools</button>
          </div>
          {err && <p className={styles.error}>{err}</p>}
        </div>

        <div className={styles.dropWrap}>
          <DropZone onFile={handleFile} disabled={uploading} />
        </div>
      </section>

      {/* Tools grid */}
      <section className={styles.tools}>
        <div className={styles.toolsHeader}>
          <h2 className={styles.toolsTitle}>Everything you need</h2>
          <p className={styles.toolsSub}>
            No bloat, no subscriptions. Just tools that work.
          </p>
        </div>
        <div className={styles.grid}>
          {TOOLS.map((tool) => (
            <ToolCard key={tool.title} {...tool} onClick={() => handleFile} />
          ))}
        </div>
      </section>

      {/* Footer note */}
      <p className={styles.footer}>
        🔒 All files are automatically deleted after 24 hours. We never store your data.
      </p>
    </main>
  );
}
