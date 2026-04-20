// frontend/src/pages/DocxEditor.jsx
//
// WYSIWYG DOCX editor. Replaces the previous text-only editor (which used
// mammoth.extractRawText + a plain <textarea>).
//
// Pipeline:
//   1. Load DOCX -> mammoth.convertToHtml -> HTML string with formatting
//   2. TipTap renders the HTML with a toolbar (bold, italic, headings,
//      lists, link, undo/redo)
//   3. Export: editor.getHTML() -> docxFromHtml -> Blob -> download
//
// Auto-load via ?key=<s3_key> preserved from Round 3a-3.

import { useEffect, useMemo, useRef, useState } from "react";
import mammoth from "mammoth/mammoth.browser";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { downloadBlob } from "../lib/download";
import { htmlToDocxBlob } from "../lib/docxFromHtml";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { useNavigate } from "react-router-dom";


// Auto-load from ?key=<s3_key>. Same shape as the other editors — kept
// duplicated across files rather than imported, because it reads
// window.location directly and couples differently per editor (DocxEditor
// needs to then parse mammoth HTML, PdfEditor needs raw bytes, etc).
function useKeyFileLoader(onFileLoaded) {
  const [loadingKey, setLoadingKey] = useState(false);
  const [keyError, setKeyError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    const name = params.get("name") || "document";
    if (!key) return;

    let cancelled = false;
    setLoadingKey(true);
    setKeyError("");

    api.getPresignedDownload(key)
      .then((data) => fetch(data.url))
      .then((resp) => {
        if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
        return resp.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const file = new File([blob], name, { type: blob.type });
        onFileLoaded(file);
      })
      .catch((e) => {
        if (!cancelled) setKeyError(e.message || "Could not load file from link");
      })
      .finally(() => {
        if (!cancelled) setLoadingKey(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { loadingKey, keyError };
}


const MAX_BYTES = 100 * 1024 * 1024;


function baseName(name) {
  return (name || "edited").replace(/\.[^.]+$/, "");
}


// Toolbar buttons — each toggles a mark/node on the TipTap editor. The
// `active` prop drives the visual state so the user can see which formatting
// is applied to the current selection.
function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
        active
          ? "bg-primary/10 text-primary"
          : "text-on-surface-variant hover:bg-surface-container"
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}


function Toolbar({ editor }) {
  if (!editor) return null;

  const promptForLink = () => {
    const previous = editor.getAttributes("link").href;
    const url = window.prompt("Link URL (leave empty to remove)", previous || "https://");
    if (url === null) return;  // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-outline-variant/10 bg-surface-container-lowest rounded-t-xl">
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <span className="material-symbols-outlined text-[18px]">undo</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Shift+Z)"
      >
        <span className="material-symbols-outlined text-[18px]">redo</span>
      </ToolbarButton>

      <div className="w-px h-5 bg-outline-variant/30 mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold (Ctrl+B)"
      >
        <span className="material-symbols-outlined text-[18px]">format_bold</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic (Ctrl+I)"
      >
        <span className="material-symbols-outlined text-[18px]">format_italic</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        title="Strikethrough"
      >
        <span className="material-symbols-outlined text-[18px]">strikethrough_s</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code"
      >
        <span className="material-symbols-outlined text-[18px]">code</span>
      </ToolbarButton>

      <div className="w-px h-5 bg-outline-variant/30 mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        H3
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setParagraph().run()}
        active={editor.isActive("paragraph")}
        title="Normal paragraph"
      >
        ¶
      </ToolbarButton>

      <div className="w-px h-5 bg-outline-variant/30 mx-1" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <span className="material-symbols-outlined text-[18px]">format_list_bulleted</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered list"
      >
        <span className="material-symbols-outlined text-[18px]">format_list_numbered</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Quote"
      >
        <span className="material-symbols-outlined text-[18px]">format_quote</span>
      </ToolbarButton>

      <div className="w-px h-5 bg-outline-variant/30 mx-1" />

      <ToolbarButton
        onClick={promptForLink}
        active={editor.isActive("link")}
        title="Insert/edit link"
      >
        <span className="material-symbols-outlined text-[18px]">link</span>
      </ToolbarButton>
    </div>
  );
}


export function DocxEditor() {
  const auth = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[400px] px-4 py-3",
      },
    },
  });

  // Destroy the editor on unmount to free ProseMirror's subscriptions.
  useEffect(() => {
    return () => { editor?.destroy(); };
  }, [editor]);

  const { loadingKey, keyError } = useKeyFileLoader((loaded) => {
    setFile(loaded);
    loadDocx(loaded).catch(() => {});
  });

  async function loadDocx(next) {
    setErr("");
    setFile(next || null);
    if (!next) {
      if (editor) editor.commands.setContent("");
      return;
    }
    if (next.size > MAX_BYTES) {
      setErr("File too large. Max 100MB.");
      return;
    }
    setBusy(true);
    try {
      const ab = await next.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: ab });
      const html = (result && result.value) || "";
      if (editor) editor.commands.setContent(html || "<p></p>");
      if (!html) {
        setErr("No content found in this DOCX.");
      }
    } catch (e) {
      setErr(e?.message || "Failed to open DOCX.");
    } finally {
      setBusy(false);
    }
  }

  async function exportDocx() {
    if (!editor) return;
    setErr("");
    setBusy(true);
    try {
      const html = editor.getHTML();
      const blob = await htmlToDocxBlob(html);
      const name = `${baseName(file?.name)}.docx`;
      downloadBlob(blob, name);
    } catch (e) {
      setErr(e?.message || "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToFiles() {
    if (!editor) return;
    setErr("");
    if (!auth?.isAuthenticated) {
      setErr("Sign in to save files.");
      return;
    }
    setSaving(true);
    try {
      const html = editor.getHTML();
      const blob = await htmlToDocxBlob(html);
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
    if (editor) editor.commands.setContent("");
    if (fileRef.current) fileRef.current.value = "";
  }

  const canExport = useMemo(() => {
    if (busy) return false;
    if (!editor) return false;
    const text = editor.getText();
    return text.length > 0;
  }, [busy, editor]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold font-headline text-on-surface">DOCX Editor</h1>
        <p className="text-sm text-on-surface-variant">
          Edit content with formatting. Export back to .docx — most formatting is preserved.
        </p>
      </div>

      {loadingKey ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/5 border border-primary/10 text-primary mb-6">
          <span className="material-symbols-outlined text-[20px]">hourglass_top</span>
          <span className="text-sm font-medium">Loading file from link…</span>
        </div>
      ) : null}

      {err || keyError ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-error-container/20 border border-error/20 text-on-error-container mb-6">
          <span className="material-symbols-outlined text-error text-[20px]">warning</span>
          <span className="text-sm font-medium">{err || keyError}</span>
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
          onChange={(e) => loadDocx(e.target.files?.[0] || null)}
        />
      </div>

      <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/10 overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-outline-variant/10">
          <h3 className="font-bold text-on-surface">Document</h3>
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
        <Toolbar editor={editor} />
        <EditorContent editor={editor} />
        <p className="text-xs text-on-surface-variant px-6 py-3 border-t border-outline-variant/10">
          Note: some advanced Word features (page breaks, custom fonts, comments) may simplify on export.
        </p>
      </div>
    </div>
  );
}
