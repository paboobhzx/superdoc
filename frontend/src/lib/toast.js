// frontend/src/lib/toast.js
//
// Thin wrapper over sonner. Exposes notify.success / notify.error with an
// API shaped for this project: errors carry a user-facing message, optional
// HTTP code, and an optional `technical` blob that collapses behind a
// "Technical details" disclosure with Copy-to-clipboard.
//
// Callers don't depend on sonner directly — if we swap the library later,
// we update this file and nothing else.

import { toast } from "sonner"


function copyToClipboard(text) {
  // Fall back to execCommand for non-secure contexts (dev http:// etc).
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.style.position = "fixed"
  ta.style.opacity = "0"
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand("copy")
  } finally {
    document.body.removeChild(ta)
  }
  return Promise.resolve()
}


function ErrorToastBody({ message, httpCode, technical, id }) {
  const details = []
  if (httpCode !== undefined && httpCode !== null) {
    details.push(`HTTP ${httpCode}`)
  }
  if (technical) {
    details.push(technical)
  }
  const detailsText = details.join("\n")

  const userFriendly = message || "Something went wrong"

  // Sonner lets us pass a function returning JSX-like; but to stay zero-JSX
  // in this file we build a plain DOM node. This avoids needing JSX build
  // rules for .js files.
  const root = document.createElement("div")
  root.style.display = "flex"
  root.style.flexDirection = "column"
  root.style.gap = "8px"

  const msg = document.createElement("div")
  msg.style.fontWeight = "600"
  msg.textContent = userFriendly
  root.appendChild(msg)

  if (detailsText) {
    const det = document.createElement("details")
    det.style.fontSize = "12px"
    det.style.opacity = "0.8"
    const sum = document.createElement("summary")
    sum.textContent = "Technical details"
    sum.style.cursor = "pointer"
    det.appendChild(sum)

    const pre = document.createElement("pre")
    pre.style.margin = "6px 0 0 0"
    pre.style.whiteSpace = "pre-wrap"
    pre.style.fontFamily = "ui-monospace, SFMono-Regular, monospace"
    pre.textContent = detailsText
    det.appendChild(pre)

    const btn = document.createElement("button")
    btn.textContent = "Copy"
    btn.style.marginTop = "4px"
    btn.style.padding = "2px 10px"
    btn.style.fontSize = "11px"
    btn.style.borderRadius = "6px"
    btn.style.border = "1px solid currentColor"
    btn.style.background = "transparent"
    btn.style.cursor = "pointer"
    btn.onclick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      copyToClipboard(`${userFriendly}\n${detailsText}`).then(() => {
        btn.textContent = "Copied"
        setTimeout(() => { btn.textContent = "Copy" }, 1200)
      })
    }
    det.appendChild(btn)

    root.appendChild(det)
  }

  return root
}


export const notify = {
  success(message) {
    toast.success(message)
  },

  info(message) {
    toast.info(message)
  },

  warning(message) {
    toast.warning(message)
  },

  /**
   * Show an error toast.
   *   notify.error("Upload failed")                                 // shorthand
   *   notify.error({ message, httpCode, technical })               // structured
   */
  error(arg) {
    let message = ""
    let httpCode = null
    let technical = ""
    if (typeof arg === "string") {
      message = arg
    } else if (arg && typeof arg === "object") {
      message = arg.message || ""
      httpCode = arg.httpCode !== undefined ? arg.httpCode : null
      technical = arg.technical || ""
    }
    toast.error(message || "Something went wrong", {
      description: (t) => ErrorToastBody({ message, httpCode, technical, id: t }),
      duration: 8000,
    })
  },
}
