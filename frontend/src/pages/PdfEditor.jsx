import { useMemo, useRef, useState, useEffect } from "react";
import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import { downloadBlob } from "../lib/download";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { useNavigate } from "react-router-dom";

// Auto-load from ?key=<s3_key> when present. Added in round 3a-3.
// Falls through harmlessly when no key is in the URL.
function useKeyFileLoader(onFileLoaded) {
  const [loadingKey, setLoadingKey] = useState(false)
  const [keyError, setKeyError] = useState("")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const key = params.get("key")
    const name = params.get("name") || "document"
    if (!key) {
      return
    }

    let cancelled = false
    setLoadingKey(true)
    setKeyError("")

    api.getPresignedDownload(key)
      .then((data) => fetch(data.url))
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`Download failed: HTTP ${resp.status}`)
        }
        return resp.blob()
      })
      .then((blob) => {
        if (cancelled) {
          return
        }
        const file = new File([blob], name, { type: blob.type })
        onFileLoaded(file)
      })
      .catch((e) => {
        if (cancelled) {
          return
        }
        setKeyError(e.message || "Could not load file from link")
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingKey(false)
        }
      })

    return () => { cancelled = true }
  }, [])

  return { loadingKey, keyError }
}


const MAX_BYTES = 100 * 1024 * 1024;

function baseName(name) {
  return (name || "edited").replace(/\.[^.]+$/, "");
}

async function readFileAsArrayBuffer(file) {
  return await file.arrayBuffer();
}

export function PdfEditor() {
  const auth = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const { loadingKey, keyError } = useKeyFileLoader((loaded) => {
    setFile(loaded)
    onPick(loaded).catch(() => {})
  })

  const [bytes, setBytes] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [watermarkText, setWatermarkText] = useState("DRAFT");
  const [deleteFrom, setDeleteFrom] = useState(0);
  const [deleteTo, setDeleteTo] = useState(0);

  const canEdit = useMemo(() => Boolean(bytes) && !busy, [bytes, busy]);

  async function onPick(next) {
    setErr("");
    setFile(next || null);
    setBytes(null);
    setPageCount(0);
    if (!next) return;
    if (next.size > MAX_BYTES) {
      setErr("File too large. Max 100MB.");
      return;
    }

    setBusy(true);
    try {
      const ab = await readFileAsArrayBuffer(next);
      const doc = await PDFDocument.load(ab);
      setBytes(new Uint8Array(ab));
      setPageCount(doc.getPageCount());
    } catch (e) {
      setErr(e?.message || "Failed to open PDF.");
    } finally {
      setBusy(false);
    }
  }

  async function withDoc(mutator) {
    setErr("");
    if (!bytes) return;
    setBusy(true);
    try {
      const doc = await PDFDocument.load(bytes);
      await mutator(doc);
      const out = await doc.save();
      setBytes(out);
      setPageCount(doc.getPageCount());
    } catch (e) {
      setErr(e?.message || "Edit failed.");
    } finally {
      setBusy(false);
    }
  }

  function rotateAll(deltaDeg) {
    return withDoc(async (doc) => {
      const pages = doc.getPages();
      for (const p of pages) {
        const cur = p.getRotation().angle || 0;
        p.setRotation(degrees((cur + deltaDeg + 360) % 360));
      }
    });
  }

  function applyWatermark() {
    return withDoc(async (doc) => {
      const text = (watermarkText || "").trim();
      if (!text) throw new Error("Watermark text is required.");

      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const pages = doc.getPages();
      for (const p of pages) {
        const { width, height } = p.getSize();
        const size = Math.max(24, Math.min(width, height) / 8);
        const x = width * 0.18;
        const y = height * 0.5;
        p.drawText(text, {
          x,
          y,
          size,
          font,
          color: rgb(0.2, 0.2, 0.2),
          opacity: 0.15,
          rotate: degrees(-35),
        });
      }
    });
  }

  function deleteRange() {
    return withDoc(async (doc) => {
      const from = Number(deleteFrom || 0);
      const to = Number(deleteTo || 0);
      if (!from || !to) throw new Error("Set both 'from' and 'to' page numbers.");
      if (from < 1 || to < 1) throw new Error("Page numbers start at 1.");
      if (to < from) throw new Error("'to' must be >= 'from'.");

      const max = doc.getPageCount();
      if (from > max || to > max) throw new Error(`Page range must be within 1..${max}.`);

      for (let i = to; i >= from; i -= 1) {
        doc.removePage(i - 1);
      }
    });
  }

  function exportPdf() {
    setErr("");
    if (!bytes) return;
    const blob = new Blob([bytes], { type: "application/pdf" });
    const name = `${baseName(file?.name)}.pdf`;
    downloadBlob(blob, name);
  }

  async function saveToFiles() {
    setErr("");
    if (!auth?.isAuthenticated) {
      setErr("Sign in to save files.");
      return;
    }
    if (!bytes) return;

    setSaving(true);
    try {
      const name = `${baseName(file?.name)}.pdf`;
      const blob = new Blob([bytes], { type: "application/pdf" });
      const f = new File([blob], name, { type: "application/pdf" });
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
    setBytes(null);
    setPageCount(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold font-headline text-on-surface">PDF Editor</h1>
        <p className="text-sm text-on-surface-variant">
          Simple edits in your browser: rotate pages, add a watermark, delete a page range.
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
            <h2 className="font-bold text-on-surface">Pick a PDF</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              {file ? `${file.name} · ${pageCount} pages` : "No file selected"}
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
          accept="application/pdf"
          className="mt-4 block w-full text-sm"
          onChange={(e) => onPick(e.target.files?.[0] || null)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">Rotate</h3>
          <p className="text-sm text-on-surface-variant mb-4">Rotates all pages.</p>
          <div className="flex gap-3">
            <button
              disabled={!canEdit}
              onClick={() => rotateAll(-90)}
              className="flex-1 px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Rotate left
            </button>
            <button
              disabled={!canEdit}
              onClick={() => rotateAll(90)}
              className="flex-1 px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Rotate right
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">Watermark</h3>
          <p className="text-sm text-on-surface-variant mb-4">Adds a light diagonal watermark to all pages.</p>
          <input
            value={watermarkText}
            onChange={(e) => setWatermarkText(e.target.value)}
            placeholder="Watermark text"
            className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm focus:outline-2 focus:outline-primary focus:-outline-offset-1"
          />
          <button
            disabled={!canEdit}
            onClick={applyWatermark}
            className="mt-4 w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Working…" : "Apply watermark"}
          </button>
        </section>

        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">Delete pages</h3>
          <p className="text-sm text-on-surface-variant mb-4">Delete a range of pages (1-indexed).</p>
          <div className="grid grid-cols-2 gap-3">
            <input
              value={deleteFrom || ""}
              type="number"
              min={1}
              onChange={(e) => setDeleteFrom(Number(e.target.value || 0))}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
              placeholder="From"
            />
            <input
              value={deleteTo || ""}
              type="number"
              min={1}
              onChange={(e) => setDeleteTo(Number(e.target.value || 0))}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
              placeholder="To"
            />
          </div>
          <button
            disabled={!canEdit}
            onClick={deleteRange}
            className="mt-4 w-full px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Working…" : "Delete range"}
          </button>
        </section>

        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">Export</h3>
          <p className="text-sm text-on-surface-variant mb-4">Downloads the edited PDF locally.</p>
          <button
            disabled={!bytes}
            onClick={exportPdf}
            className="w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Export PDF
          </button>
          {auth?.isAuthenticated ? (
            <button
              disabled={!bytes || saving}
              onClick={saveToFiles}
              className="mt-3 w-full px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save to Files"}
            </button>
          ) : null}
          <p className="text-xs text-on-surface-variant mt-3">
            Saved files count toward the 10-document limit and expire after 7 days.
          </p>
        </section>
      </div>
    </div>
  );
}
