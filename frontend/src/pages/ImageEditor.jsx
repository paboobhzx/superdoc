import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api"
import { fabric } from "fabric";
import { downloadBlob } from "../lib/download";

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


export function ImageEditor() {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const fileRef = useRef(null);

  const [fileName, setFileName] = useState("");
  const [draw, setDraw] = useState(false);
  const [exportFmt, setExportFmt] = useState("png");
  const [err, setErr] = useState("");
  const { loadingKey, keyError } = useKeyFileLoader((loaded) => {
    loadFile(loaded).catch(() => {})
  })

  const exportMime = useMemo(() => {
    if (exportFmt === "jpg") return "image/jpeg";
    if (exportFmt === "webp") return "image/webp";
    return "image/png";
  }, [exportFmt]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const c = new fabric.Canvas(el, {
      backgroundColor: "#ffffff",
      preserveObjectStacking: true,
    });
    c.setWidth(900);
    c.setHeight(550);
    fabricRef.current = c;
    return () => {
      c.dispose();
      fabricRef.current = null;
    };
  }, []);

  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    c.isDrawingMode = draw;
    if (draw) {
      c.freeDrawingBrush.width = 3;
      c.freeDrawingBrush.color = "#0078d4";
    }
  }, [draw]);

  async function loadFile(file) {
    setErr("");
    setFileName(file?.name || "");
    const c = fabricRef.current;
    if (!c || !file) return;

    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        fabric.Image.fromURL(
          url,
          (o) => (o ? resolve(o) : reject(new Error("Failed to load image"))),
          { crossOrigin: "anonymous" }
        );
      });

      c.clear();
      c.setBackgroundColor("#ffffff", () => {});

      const cw = c.getWidth();
      const ch = c.getHeight();
      const scale = Math.min(cw / img.width, ch / img.height, 1);
      img.set({
        left: cw / 2,
        top: ch / 2,
        originX: "center",
        originY: "center",
        selectable: true,
      });
      img.scale(scale);
      c.add(img);
      c.setActiveObject(img);
      c.renderAll();
    } catch (e) {
      setErr(e?.message || "Failed to load image");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function addText() {
    const c = fabricRef.current;
    if (!c) return;
    const t = new fabric.Textbox("Text", {
      left: 60,
      top: 60,
      fontSize: 42,
      fill: "#111111",
      fontFamily: "Arial",
      fontWeight: "bold",
    });
    c.add(t);
    c.setActiveObject(t);
    c.renderAll();
  }

  function rotate90() {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!c || !obj) return;
    obj.rotate(((obj.angle || 0) + 90) % 360);
    c.renderAll();
  }

  function removeSelected() {
    const c = fabricRef.current;
    const obj = c?.getActiveObject();
    if (!c || !obj) return;
    c.remove(obj);
    c.discardActiveObject();
    c.renderAll();
  }

  function exportImage() {
    const c = fabricRef.current;
    if (!c) return;
    const dataUrl = c.toDataURL({ format: exportFmt === "jpg" ? "jpeg" : exportFmt, quality: 0.92 });
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const base = (fileName || "edited").replace(/\.[^.]+$/, "");
        downloadBlob(blob, `${base}.${exportFmt}`);
      })
      .catch(() => setErr("Export failed"));
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-headline text-on-surface">Image Editor</h1>
        <p className="text-sm text-on-surface-variant">Simple edits: draw, add text, rotate, export.</p>
      </div>

      {err && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container mb-6">
          <span className="material-symbols-outlined text-error text-[20px]">warning</span>
          <span className="text-sm font-medium">{err}</span>
        </div>
      )}

      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-5 mb-6">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => loadFile(e.target.files?.[0] || null)}
            className="text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setDraw((d) => !d)}
              className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors"
            >
              {draw ? "Stop drawing" : "Draw"}
            </button>
            <button
              onClick={addText}
              className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors"
            >
              Add text
            </button>
            <button
              onClick={rotate90}
              className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors"
            >
              Rotate 90°
            </button>
            <button
              onClick={removeSelected}
              className="px-4 py-2 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors"
            >
              Delete
            </button>
            <select
              value={exportFmt}
              onChange={(e) => setExportFmt(e.target.value)}
              className="px-4 py-2 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
            >
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="webp">WEBP</option>
            </select>
            <button
              onClick={exportImage}
              className="px-4 py-2 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity"
            >
              Export
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-4 overflow-hidden">
        <canvas ref={canvasRef} />
      </div>

      <p className="text-xs text-on-surface-variant mt-4">
        Exports locally in your browser ({exportMime}). For GIF frame editing, this MVP supports conversion-only via the Image Convert tool.
      </p>
    </div>
  );
}
