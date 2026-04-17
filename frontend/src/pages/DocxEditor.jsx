import { useMemo, useRef, useState } from "react";
import mammoth from "mammoth/mammoth.browser";
import { Document, Packer, Paragraph } from "docx";
import { downloadBlob } from "../lib/download";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { useNavigate } from "react-router-dom";

const MAX_BYTES = 100 * 1024 * 1024;

function baseName(name) {
  return (name || "edited").replace(/\.[^.]+$/, "");
}

export function DocxEditor() {
  const auth = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const canExport = useMemo(() => !busy && text.length > 0, [busy, text]);

  async function onPick(next) {
    setErr("");
    setFile(next || null);
    setText("");
    if (!next) return;
    if (next.size > MAX_BYTES) {
      setErr("File too large. Max 100MB.");
      return;
    }
    setBusy(true);
    try {
      const ab = await next.arrayBuffer();
      const res = await mammoth.extractRawText({ arrayBuffer: ab });
      const value = (res?.value || "").trim();
      if (!value) {
        setErr("No text found. This simple editor supports text-only edits.");
      }
      setText(value);
    } catch (e) {
      setErr(e?.message || "Failed to open DOCX.");
    } finally {
      setBusy(false);
    }
  }

  async function exportDocx() {
    setErr("");
    setBusy(true);
    try {
      const lines = (text || "").split(/\r?\n/);
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: lines.map((l) => new Paragraph(l)),
          },
        ],
      });
      const blob = await Packer.toBlob(doc);
      const name = `${baseName(file?.name)}.docx`;
      downloadBlob(blob, name);
    } catch (e) {
      setErr(e?.message || "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToFiles() {
    setErr("");
    if (!auth?.isAuthenticated) {
      setErr("Sign in to save files.");
      return;
    }
    if (!text) return;

    setSaving(true);
    try {
      const lines = (text || "").split(/\r?\n/);
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: lines.map((l) => new Paragraph(l)),
          },
        ],
      });
      const blob = await Packer.toBlob(doc);
      const name = `${baseName(file?.name)}.docx`;
      const f = new File([blob], name, {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const created = await api.createUserFile({ file_name: f.name, file_size_bytes: f.size });
      await api.uploadToS3(created.upload || created.upload_url, f);
      await api.completeUserFile(created.job_id);
      navigate("/dashboard");
    } catch (e) {
      setErr(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setErr("");
    setFile(null);
    setText("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold font-headline text-on-surface">DOCX Editor</h1>
        <p className="text-sm text-on-surface-variant">
          Simple text-only editor. Formatting/layout won’t be preserved.
        </p>
      </div>

      {err ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container mb-6">
          <span className="material-symbols-outlined text-error text-[20px]">warning</span>
          <span className="text-sm font-medium">{err}</span>
        </div>
      ) : null}

      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-on-surface">Pick a DOCX</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              {file ? file.name : "No file selected"}
            </p>
          </div>
          {file ? (
            <button
              onClick={reset}
              className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors"
            >
              Clear
            </button>
          ) : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="mt-4 block w-full text-sm"
          onChange={(e) => onPick(e.target.files?.[0] || null)}
        />
      </div>

      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="font-bold text-on-surface">Text</h3>
          <div className="flex gap-2">
            {auth?.isAuthenticated ? (
              <button
                disabled={!canExport || saving}
                onClick={saveToFiles}
                className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "Save to Files"}
              </button>
            ) : null}
            <button
              disabled={!canExport}
              onClick={exportDocx}
              className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? "Working…" : "Export DOCX"}
            </button>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Open a DOCX to edit its text…"
          className="w-full min-h-[360px] px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1"
        />
        <p className="text-xs text-on-surface-variant mt-3">
          Tip: for “find & replace” without losing formatting, use the server-side tool in <a className="text-primary font-semibold no-underline hover:underline" href="/tools">Tools</a>.
        </p>
      </div>
    </div>
  );
}
