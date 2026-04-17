import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";

const MAX_BYTES = 100 * 1024 * 1024;

function bytesLabel(bytes) {
  if (!bytes) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildSessionId() {
  const existing = sessionStorage.getItem("superdoc_session");
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem("superdoc_session", id);
  return id;
}

export function Tools() {
  const navigate = useNavigate();
  const auth = useAuth();

  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [watermarkText, setWatermarkText] = useState("DRAFT");
  const [imgFormat, setImgFormat] = useState("png");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");

  const [row, setRow] = useState(1);
  const [col, setCol] = useState(1);
  const [cellValue, setCellValue] = useState("");

  const fileRef = useRef(null);
  const [file, setFile] = useState(null);

  const canSubmit = useMemo(() => Boolean(file) && !loading, [file, loading]);

  async function createJob(operation, params) {
    const payload = {
      operation,
      file_size_bytes: file.size,
      file_name: file.name,
      params,
    };

    if (file.size > MAX_BYTES) throw new Error("File too large. Max 100MB.");

    if (auth?.isAuthenticated) return api.createUserJob(payload);
    return api.createJob({ ...payload, session_id: buildSessionId() });
  }

  async function run(operation, params) {
    setErr("");
    if (!file) return;
    setLoading(true);
    try {
      const data = await createJob(operation, params);
      await api.uploadToS3(data.upload || data.upload_url, file);
      await api.triggerProcess(data.job_id);
      navigate(`/processing/${data.job_id}`);
    } catch (e) {
      setErr(e?.message || "Failed to start job.");
    } finally {
      setLoading(false);
    }
  }

  function resetFile() {
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold font-headline text-on-surface">Tools</h1>
        <p className="text-sm text-on-surface-variant">
          Simple editors and converters. Max 100MB per run.
        </p>
      </div>

      {err && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container mb-6">
          <span className="material-symbols-outlined text-error text-[20px]">warning</span>
          <span className="text-sm font-medium">{err}</span>
        </div>
      )}

      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-on-surface">Pick a file</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              {file ? `${file.name} · ${bytesLabel(file.size)}` : "No file selected"}
            </p>
          </div>
          {file ? (
            <button
              onClick={resetFile}
              className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors"
            >
              Clear
            </button>
          ) : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          className="mt-4 block w-full text-sm"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Local image editor */}
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">Image & GIF Editor</h3>
          <p className="text-sm text-on-surface-variant mb-4">
            Quick edits in your browser. Export as PNG/JPG/WEBP.
          </p>
          <Link
            to="/editor/image"
            className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity no-underline"
          >
            Open editor
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </section>

        {/* Local PDF editor */}
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">PDF Editor</h3>
          <p className="text-sm text-on-surface-variant mb-4">
            Rotate pages, watermark, delete page ranges. Export locally.
          </p>
          <Link
            to="/editor/pdf"
            className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity no-underline"
          >
            Open editor
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </section>

        {/* Local DOCX editor */}
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">DOCX Editor</h3>
          <p className="text-sm text-on-surface-variant mb-4">
            Text-only edits in your browser. Export locally.
          </p>
          <Link
            to="/editor/docx"
            className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors no-underline"
          >
            Open editor
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </section>

        {/* Local XLSX editor */}
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">XLSX Editor</h3>
          <p className="text-sm text-on-surface-variant mb-4">
            Edit cells (A1 format) and export XLSX locally.
          </p>
          <Link
            to="/editor/xlsx"
            className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors no-underline"
          >
            Open editor
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </Link>
        </section>

        {/* PDF Watermark */}
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">PDF Watermark</h3>
          <p className="text-sm text-on-surface-variant mb-4">Adds a light diagonal watermark.</p>
          <input
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            placeholder="Watermark text"
            className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1"
          />
          <button
            disabled={!canSubmit}
            onClick={() => run("pdf_annotate", { watermark_text: watermarkText })}
            className="mt-4 w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Starting…" : "Run"}
          </button>
        </section>

        {/* Image Convert */}
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">Image Convert</h3>
          <p className="text-sm text-on-surface-variant mb-4">Convert JPG/PNG/WEBP/GIF.</p>
          <select
            value={imgFormat}
            onChange={(e) => setImgFormat(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
          >
            {["png", "jpg", "webp", "gif"].map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            disabled={!canSubmit}
            onClick={() => run("image_convert", { target_format: imgFormat })}
            className="mt-4 w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Starting…" : "Run"}
          </button>
        </section>

        {/* DOCX Replace Text */}
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">DOCX Replace Text</h3>
          <p className="text-sm text-on-surface-variant mb-4">Simple find/replace in paragraphs.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              placeholder="Find"
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1"
            />
            <input
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="Replace"
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1"
            />
          </div>
          <button
            disabled={!canSubmit}
            onClick={() =>
              run("doc_edit", {
                ops: [{ action: "replace_text", find: findText, replace: replaceText }],
              })
            }
            className="mt-4 w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Starting…" : "Run"}
          </button>
        </section>

        {/* XLSX Set Cell */}
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">XLSX Set Cell</h3>
          <p className="text-sm text-on-surface-variant mb-4">Set a cell value in the first sheet.</p>
          <div className="grid grid-cols-3 gap-3">
            <input
              value={row}
              type="number"
              min={1}
              onChange={(e) => setRow(Number(e.target.value || 1))}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
              placeholder="Row"
            />
            <input
              value={col}
              type="number"
              min={1}
              onChange={(e) => setCol(Number(e.target.value || 1))}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
              placeholder="Col"
            />
            <input
              value={cellValue}
              onChange={(e) => setCellValue(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
              placeholder="Value"
            />
          </div>
          <button
            disabled={!canSubmit}
            onClick={() =>
              run("doc_edit", {
                ops: [{ action: "set_cell", row, col, value: cellValue }],
              })
            }
            className="mt-4 w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? "Starting…" : "Run"}
          </button>
        </section>
      </div>
    </div>
  );
}
