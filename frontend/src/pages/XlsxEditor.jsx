import { useMemo, useRef, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { downloadBlob } from "../lib/download";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { getSessionId } from "../lib/session";
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

    api.getPresignedDownload(key, getSessionId())
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

export function XlsxEditor() {
  const auth = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const { loadingKey, keyError } = useKeyFileLoader((loaded) => {
    setFile(loaded)
    onPick(loaded).catch(() => {})
  })

  const [workbook, setWorkbook] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [grid, setGrid] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [cellAddr, setCellAddr] = useState("A1");
  const [cellValue, setCellValue] = useState("");

  const sheetNames = useMemo(() => workbook?.SheetNames || [], [workbook]);

  const canExport = useMemo(() => Boolean(workbook) && !busy, [workbook, busy]);

  function readGrid(wb, name) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    const maxRows = Math.min(rows.length || 0, 30);
    const maxCols = Math.min(
      rows.reduce((m, r) => Math.max(m, (r || []).length), 0) || 0,
      12
    );
    const view = [];
    for (let r = 0; r < maxRows; r += 1) {
      const row = rows[r] || [];
      const line = [];
      for (let c = 0; c < maxCols; c += 1) {
        line.push(row[c] ?? "");
      }
      view.push(line);
    }
    return view;
  }

  function setActiveCell(wb, name, addr) {
    const sheet = wb.Sheets[name];
    const cell = sheet?.[addr];
    const v = cell ? cell.v : "";
    setCellAddr(addr);
    setCellValue(v === undefined || v === null ? "" : String(v));
  }

  async function onPick(next) {
    setErr("");
    setFile(next || null);
    setWorkbook(null);
    setSheetName("");
    setGrid([]);
    setCellAddr("A1");
    setCellValue("");

    if (!next) return;
    if (next.size > MAX_BYTES) {
      setErr("File too large. Max 100MB.");
      return;
    }

    setBusy(true);
    try {
      const ab = await next.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array" });
      if (!wb.SheetNames?.length) throw new Error("No sheets found.");
      const name = wb.SheetNames[0];
      setWorkbook(wb);
      setSheetName(name);
      setGrid(readGrid(wb, name));
      setActiveCell(wb, name, "A1");
    } catch (e) {
      setErr(e?.message || "Failed to open XLSX.");
    } finally {
      setBusy(false);
    }
  }

  function onChangeSheet(nextName) {
    setErr("");
    if (!workbook) return;
    setSheetName(nextName);
    setGrid(readGrid(workbook, nextName));
    setActiveCell(workbook, nextName, "A1");
  }

  function applyCell() {
    setErr("");
    if (!workbook || !sheetName) return;

    const addr = String(cellAddr || "").toUpperCase().trim();
    if (!/^[A-Z]+[1-9][0-9]*$/.test(addr)) {
      setErr("Invalid cell address (example: A1, B2).");
      return;
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    XLSX.utils.sheet_add_aoa(sheet, [[cellValue]], { origin: addr });
    setGrid(readGrid(workbook, sheetName));
  }

  function onClickCell(rIdx, cIdx) {
    if (!workbook || !sheetName) return;
    const col = XLSX.utils.encode_col(cIdx);
    const row = XLSX.utils.encode_row(rIdx);
    const addr = `${col}${row}`;
    setActiveCell(workbook, sheetName, addr);
  }

  function exportXlsx() {
    setErr("");
    if (!workbook) return;
    const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    downloadBlob(blob, `${baseName(file?.name)}.xlsx`);
  }

  async function saveToFiles() {
    setErr("");
    if (!auth?.isAuthenticated) {
      setErr("Sign in to save files.");
      return;
    }
    if (!workbook) return;

    setSaving(true);
    try {
      const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const blob = new Blob([out], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const name = `${baseName(file?.name)}.xlsx`;
      const f = new File([blob], name, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
    setWorkbook(null);
    setSheetName("");
    setGrid([]);
    setCellAddr("A1");
    setCellValue("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold font-headline text-on-surface">XLSX Editor</h1>
        <p className="text-sm text-on-surface-variant">
          Simple cell edits in your browser. Export downloads locally.
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
            <h2 className="font-bold text-on-surface">Pick an XLSX</h2>
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
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="mt-4 block w-full text-sm"
          onChange={(e) => onPick(e.target.files?.[0] || null)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6 overflow-auto">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-bold text-on-surface">Preview</h3>
            {sheetNames.length > 0 ? (
              <select
                value={sheetName}
                onChange={(e) => onChangeSheet(e.target.value)}
                className="px-3 py-2 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
              >
                {sheetNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {grid.length === 0 ? (
            <div className="text-sm text-on-surface-variant">Open an XLSX to preview cells.</div>
          ) : (
            <table className="min-w-full border-separate border-spacing-0">
              <tbody>
                {grid.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {row.map((v, cIdx) => (
                      <td
                        key={cIdx}
                        onClick={() => onClickCell(rIdx, cIdx)}
                        className="border border-outline-variant/10 px-2 py-1 text-xs text-on-surface cursor-pointer hover:bg-surface-container"
                        title="Click to edit"
                      >
                        {String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-on-surface-variant mt-3">
            Preview shows up to 30 rows × 12 columns.
          </p>
        </section>

        <section className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 p-6">
          <h3 className="font-bold text-on-surface mb-1">Edit cell</h3>
          <p className="text-sm text-on-surface-variant mb-4">Set a value at an address (A1 format).</p>

          <div className="grid grid-cols-2 gap-3">
            <input
              value={cellAddr}
              onChange={(e) => setCellAddr(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
              placeholder="A1"
            />
            <input
              value={cellValue}
              onChange={(e) => setCellValue(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-surface-container border border-outline-variant/20 text-on-surface text-sm"
              placeholder="Value"
            />
          </div>

          <button
            disabled={!workbook || busy}
            onClick={applyCell}
            className="mt-4 w-full px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Apply
          </button>

          <button
            disabled={!canExport}
            onClick={exportXlsx}
            className="mt-3 w-full px-5 py-3 rounded-xl bg-primary text-on-primary font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Export XLSX
          </button>
          {auth?.isAuthenticated ? (
            <button
              disabled={!canExport || saving}
              onClick={saveToFiles}
              className="mt-3 w-full px-5 py-3 rounded-xl border border-outline-variant/20 text-on-surface font-semibold text-sm hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save to Files"}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
