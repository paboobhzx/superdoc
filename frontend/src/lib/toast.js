// frontend/src/lib/toast.js
//
// Thin wrapper over sonner. Exposes notify.success / notify.error with an
// API shaped for this project: errors carry a user-facing message, optional
// HTTP code, and an optional `technical` blob shown as the description.
//
// Callers don't depend on sonner directly — if we swap the library later,
// we update this file and nothing else.

import { toast } from "sonner"


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

    // Build a plain-string description so sonner can render it as a ReactNode.
    // (Passing a DOM element or a function returning one breaks React rendering.)
    const parts = []
    if (httpCode !== null && httpCode !== undefined) parts.push(`HTTP ${httpCode}`)
    if (technical) parts.push(technical)
    const description = parts.length > 0 ? parts.join(" — ") : undefined

    toast.error(message || "Something went wrong", {
      description,
      duration: 8000,
    })
  },
}
