import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { downloadBlob } from "../lib/download";
import { api } from "../lib/api";
import { getSessionId } from "../lib/session";

const MAX_BYTES = 10 * 1024 * 1024;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdownToHtml(value) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  let code = [];
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${inlineMarkdownToHtml(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      html.push(`<h${heading[1].length}>${inlineMarkdownToHtml(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote><p>${inlineMarkdownToHtml(quote[1])}</p></blockquote>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (ordered || bullet) {
      flushParagraph();
      const type = ordered ? "ol" : "ul";
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((ordered || bullet)[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  if (inCode) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return html.join("") || "<p></p>";
}

function textOf(node) {
  return Array.from(node.childNodes || []).map((child) => {
    if (child.nodeType === Node.TEXT_NODE) return child.textContent || "";
    if (child.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = child.tagName.toLowerCase();
    const inner = textOf(child);
    if (tag === "strong" || tag === "b") return `**${inner}**`;
    if (tag === "em" || tag === "i") return `*${inner}*`;
    if (tag === "code") return `\`${inner}\``;
    if (tag === "a") return `[${inner}](${child.getAttribute("href") || ""})`;
    return inner;
  }).join("");
}

function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(`<main>${html || ""}</main>`, "text/html");
  const blocks = Array.from(doc.body.firstElementChild?.children || []);
  const lines = [];

  for (const block of blocks) {
    const tag = block.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      lines.push(`${"#".repeat(Number(tag.slice(1)))} ${textOf(block)}`);
    } else if (tag === "ul" || tag === "ol") {
      Array.from(block.children).forEach((item, index) => {
        lines.push(`${tag === "ol" ? `${index + 1}.` : "-"} ${textOf(item)}`);
      });
    } else if (tag === "blockquote") {
      lines.push(`> ${textOf(block)}`);
    } else if (tag === "pre") {
      lines.push("```");
      lines.push(block.textContent || "");
      lines.push("```");
    } else {
      const text = textOf(block).trim();
      if (text) lines.push(text);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function baseName(name) {
  return (name || "document").replace(/\.[^.]+$/, "");
}

function ToolbarButton({ onClick, active, disabled, title, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 py-1.5 rounded-lg text-sm font-semibold transition-colors active:scale-95 ${
        active ? "bg-primary/10 text-primary" : "text-on-surface-variant hover:bg-surface-container"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }) {
  if (!editor) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-outline-variant/10 bg-surface-container-lowest px-3 py-2">
      <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo">
        <span className="material-symbols-outlined text-[18px]">undo</span>
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo">
        <span className="material-symbols-outlined text-[18px]">redo</span>
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-outline-variant/30" />
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold">B</ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic">I</ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Code">
        <span className="material-symbols-outlined text-[18px]">code</span>
      </ToolbarButton>
      <div className="mx-1 h-5 w-px bg-outline-variant/30" />
      {[1, 2, 3].map((level) => (
        <ToolbarButton
          key={level}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          active={editor.isActive("heading", { level })}
          title={`Heading ${level}`}
        >
          H{level}
        </ToolbarButton>
      ))}
      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">
        <span className="material-symbols-outlined text-[18px]">format_list_bulleted</span>
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list">
        <span className="material-symbols-outlined text-[18px]">format_list_numbered</span>
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote">
        <span className="material-symbols-outlined text-[18px]">format_quote</span>
      </ToolbarButton>
    </div>
  );
}

export function MarkdownEditor() {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingKey, setLoadingKey] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false, autolink: true })],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-[420px] px-4 py-3 focus:outline-none",
      },
    },
  });

  const loadMarkdown = useCallback(async (next) => {
    setErr("");
    setFile(next || null);
    if (!next) {
      editor?.commands.setContent("");
      return;
    }
    if (next.size > MAX_BYTES) {
      setErr("File too large. Max 10MB.");
      return;
    }
    setBusy(true);
    try {
      const text = await next.text();
      editor?.commands.setContent(markdownToHtml(text));
    } catch (e) {
      setErr(e?.message || "Failed to open Markdown.");
    } finally {
      setBusy(false);
    }
  }, [editor]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    const name = params.get("name") || "document.md";
    if (!key || !editor) return undefined;

    let cancelled = false;
    setLoadingKey(true);
    api.getPresignedDownload(key, getSessionId())
      .then((data) => fetch(data.url))
      .then((resp) => {
        if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
        return resp.blob();
      })
      .then((blob) => {
        if (!cancelled) return loadMarkdown(new File([blob], name, { type: blob.type || "text/markdown" }));
      })
      .catch((e) => {
        if (!cancelled) setErr(e?.message || "Could not load file from link.");
      })
      .finally(() => {
        if (!cancelled) setLoadingKey(false);
      });
    return () => { cancelled = true; };
  }, [editor, loadMarkdown]);

  const canExport = useMemo(() => Boolean(editor && !busy && editor.getText().trim()), [busy, editor]);

  function exportMarkdown() {
    if (!editor) return;
    const markdown = htmlToMarkdown(editor.getHTML());
    downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${baseName(file?.name)}.md`);
  }

  function reset() {
    setErr("");
    setFile(null);
    editor?.commands.setContent("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8">
        <h1 className="font-headline text-2xl font-bold text-on-surface">Markdown Editor</h1>
        <p className="text-sm text-on-surface-variant">Edit Markdown with formatting, then export clean .md.</p>
      </div>

      {(err || loadingKey) && (
        <div className={`mb-6 flex items-center gap-3 rounded-xl border px-4 py-3 ${
          err ? "border-error/20 bg-error-container/20 text-on-error-container" : "border-primary/10 bg-primary/5 text-primary"
        }`} aria-live="polite">
          <span className="material-symbols-outlined text-[20px]">{err ? "warning" : "hourglass_top"}</span>
          <span className="text-sm font-medium">{err || "Loading file from link..."}</span>
        </div>
      )}

      <div className="mb-6 rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-on-surface">Pick Markdown</h2>
            <p className="mt-1 text-xs text-on-surface-variant">{file ? file.name : "No file selected"}</p>
          </div>
          {file && (
            <button type="button" onClick={reset} className="rounded-xl border border-outline-variant/20 px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container">
              Clear
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="mt-4 block w-full text-sm"
          onChange={(e) => loadMarkdown(e.target.files?.[0] || null)}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-lowest">
        <div className="flex items-center justify-between gap-4 border-b border-outline-variant/10 px-6 py-4">
          <h3 className="font-bold text-on-surface">Document</h3>
          <button
            type="button"
            disabled={!canExport}
            onClick={exportMarkdown}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary transition-opacity active:scale-95 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Working..." : "Export Markdown"}
          </button>
        </div>
        <Toolbar editor={editor} />
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
