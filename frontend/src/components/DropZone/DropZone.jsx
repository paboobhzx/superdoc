import { useState, useRef, useCallback } from "react";
import styles from "./DropZone.module.css";

const SUPPORTED_FORMATS = ["PDF", "DOCX", "XLSX", "JPG", "PNG", "MP4", "WEBP", "GIF"];

const ACCEPT = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm",
].join(",");

export function DropZone({ onFile, disabled = false }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file || disabled) return;
    onFile(file);
  }, [onFile, disabled]);

  const onDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };

  const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  return (
    <div
      className={`${styles.zone} ${dragging ? styles.dragging : ""} ${disabled ? styles.disabled : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="Drop a file or click to browse"
      onKeyDown={(e) => e.key === "Enter" && !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onChange}
        className={styles.hiddenInput}
        aria-hidden="true"
      />

      <div className={styles.icon}>📂</div>
      <p className={styles.title}>
        {dragging ? "Release to upload" : "Drop any file here"}
      </p>
      <p className={styles.subtitle}>or click to browse</p>

      <div className={styles.formats}>
        {SUPPORTED_FORMATS.map((fmt) => (
          <span key={fmt} className={styles.formatPill}>{fmt}</span>
        ))}
      </div>

      <button
        className={styles.browseBtn}
        onClick={(e) => { e.stopPropagation(); !disabled && inputRef.current?.click(); }}
        disabled={disabled}
        type="button"
      >
        Browse files
      </button>
    </div>
  );
}
